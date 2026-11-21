/* app.js — wiring: the reading practice loop, the note-naming drill,
 * progress screens, settings and keyboard shortcuts.
 */
(function (global) {
  'use strict';

  var SR = global.SR;
  var T = SR.theory;
  var gen = SR.generator;
  var notation = SR.notation;
  var audio = SR.audio;
  var pitch = SR.pitch;
  var store = SR.store;

  var $ = function (id) { return document.getElementById(id); };
  var ROUND_LENGTH = 20;

  var settings = {
    instrument: 'clarinet',
    clef: 'treble',
    level: 2,
    key: 'auto',
    timeSig: '4/4',
    bars: 4,
    tempo: 80,
    click: 'all',
    rests: false,
    accidentals: false,
    volume: 70,
    answerMode: 'name',
    listen: false,
    source: 'random'
  };

  // Which famous tune is on screen, and whether he has been told yet.
  var mystery = { tune: null, revealed: false, lastId: null };

  var practice = { ex: null, layout: [], transport: null, mode: null };
  var drill = {
    active: false, q: null, index: 0, correct: 0, streak: 0,
    tStart: 0, timer: null, locked: false, acc: '', results: []
  };
  var lastActive = Date.now();

  /* ============================ helpers ============================ */

  function markActive() { lastActive = Date.now(); }

  function setSegment(container, value) {
    Array.prototype.forEach.call(container.querySelectorAll('button'), function (b) {
      b.classList.toggle('is-on', b.dataset.val === String(value));
    });
  }

  function onSegment(container, handler) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || !container.contains(btn)) return;
      markActive();
      setSegment(container, btn.dataset.val);
      handler(btn.dataset.val);
    });
  }

  function boot(msg) {
    var el = $('boot');
    el.textContent = msg;
    el.hidden = false;
  }

  function fmtTime(seconds) {
    var m = Math.round(seconds / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  /* ============================ settings UI ============================ */

  function fillKeySelect() {
    var sel = $('selKey');
    var current = settings.key;
    sel.innerHTML = '';
    var auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = 'Mixed (level keys)';
    sel.appendChild(auto);
    T.keysFor(settings.instrument, settings.level).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = T.KEYS[k].label + (settings.instrument === 'clarinet' ? ' (written)' : '');
      sel.appendChild(o);
    });
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === current; }) ? current : 'auto';
    settings.key = sel.value;
  }

  function syncInstrumentUI() {
    $('fieldStaff').hidden = settings.instrument !== 'piano';
    if (settings.instrument === 'clarinet') settings.clef = 'treble';
    var inst = T.INSTRUMENTS[settings.instrument];
    var range = settings.instrument === 'piano' && settings.clef === 'bass'
      ? T.bassRangeFor('piano', settings.level)
      : T.rangeFor(settings.instrument, settings.level, settings.clef);
    $('instrumentNote').textContent = inst.note + '  Range: ' +
      T.midiToName(range.low) + '–' + T.midiToName(range.high) + '.';
    // "Find it on the keys" judges written pitch, which is still useful on clarinet.
    var keysBtn = $('segAnswerMode').querySelector('[data-val="keys"]');
    keysBtn.textContent = settings.instrument === 'clarinet' ? 'Find it (written)' : 'Find it on the keys';
    $('levelNote').textContent = T.describeLevel(settings.instrument, settings.level, settings.clef);
    syncSourceUI();
    persist();
  }

  function syncSourceUI() {
    var tuneMode = settings.source === 'tune';
    var count = SR.tunes ? SR.tunes.countFor(settings.level) : 0;
    $('sourceNote').textContent = tuneMode
      ? count + ' tunes at this level — the title stays hidden until you ask.'
      : 'Fresh random music every time, built to this level.';
    // A tune brings its own key, time signature and length.
    ['selKey', 'selTime'].forEach(function (id) { $(id).disabled = tuneMode; });
    Array.prototype.forEach.call($('segBars').querySelectorAll('button'), function (b) {
      b.disabled = tuneMode;
    });
  }

  function persist() {
    store.saveSettings(settings);
  }

  function applySavedSettings() {
    var saved = store.loadSettings();
    if (saved) Object.keys(settings).forEach(function (k) {
      if (saved[k] !== undefined && saved[k] !== null) settings[k] = saved[k];
    });
    setSegment($('segInstrument'), settings.instrument);
    setSegment($('segClef'), settings.clef);
    setSegment($('segLevel'), settings.level);
    setSegment($('segBars'), settings.bars);
    setSegment($('segAnswerMode'), settings.answerMode);
    setSegment($('segSource'), settings.source);
    $('selTime').value = settings.timeSig;
    $('selClick').value = settings.click;
    $('chkRests').checked = !!settings.rests;
    $('chkAcc').checked = !!settings.accidentals;
    $('rngVol').value = settings.volume;
    $('rngTempo').value = settings.tempo;
    $('tempoOut').textContent = settings.tempo;
    audio.setVolume(settings.volume / 100);
    fillKeySelect();
    syncInstrumentUI();
    syncAnswerMode();
    syncListenUI();
  }

  /* ============================ reading practice ============================ */

  function updatePills() {
    var ex = practice.ex;
    if (!ex) return;
    $('pillKey').textContent = ex.keyLabel + (settings.instrument === 'clarinet' ? ' (written)' : '');
    $('pillTime').textContent = ex.timeSig.num + '/' + ex.timeSig.den;
    $('pillTempo').textContent = settings.tempo + ' bpm';
    syncMysteryUI();
  }

  // In tune mode the title is kept back until he asks — that is the whole point.
  function syncMysteryUI() {
    var pill = $('pillTune');
    var btn = $('btnReveal');
    var note = $('tuneNote');
    if (!mystery.tune) {
      pill.hidden = true;
      btn.hidden = true;
      note.hidden = true;
      return;
    }
    pill.hidden = false;
    if (mystery.revealed) {
      pill.textContent = '♫ ' + mystery.tune.title;
      btn.hidden = true;
      note.hidden = false;
      note.textContent = mystery.tune.by + ' — ' + mystery.tune.blurb + '.';
    } else {
      pill.textContent = '♫ Mystery tune';
      btn.hidden = false;
      note.hidden = true;
    }
  }

  function revealTune() {
    if (!mystery.tune || mystery.revealed) return;
    mystery.revealed = true;
    syncMysteryUI();
    markActive();
  }

  function renderPractice() {
    if (!practice.ex) return;
    try {
      var res = notation.renderExercise($('notation'), practice.ex, {});
      practice.layout = res.layout.map(function (entry, i, arr) {
        var next = arr[i + 1];
        var w = (next && Math.abs(next.y - entry.y) < 2) ? (next.x - entry.x) : entry.width;
        return { startBeat: entry.startBeat, beats: entry.beats, x: entry.x, y: entry.y, h: entry.h, w: Math.max(18, w) };
      });
    } catch (err) {
      boot('Could not draw the music: ' + err.message);
      throw err;
    }
    repaintMarks();
  }

  function newExercise() {
    stopTransport();
    if (settings.source === 'tune' && SR.tunes) {
      mystery.tune = SR.tunes.pick(settings, mystery.lastId);
      mystery.lastId = mystery.tune.id;
      mystery.revealed = false;
      practice.ex = SR.tunes.buildExercise(mystery.tune, settings);
    } else {
      mystery.tune = null;
      mystery.revealed = false;
      practice.ex = gen.generate(settings);
    }
    listen.targets = [];
    clearMarks();
    $('listenResult').hidden = true;
    renderPractice();
    updatePills();
    $('pillCount').textContent = '';
    $('selfCheck').hidden = true;
    if (pitch.isRunning()) {
      var range = listenRange();
      pitch.setRange(range.fmin, range.fmax);
    }
    markActive();
  }

  function setCursor(beat) {
    var cur = $('cursor');
    if (!practice.layout.length) return;
    if (beat < 0) { cur.hidden = true; return; }
    var hit = null;
    for (var i = 0; i < practice.layout.length; i++) {
      var e = practice.layout[i];
      if (beat >= e.startBeat - 0.001 && beat < e.startBeat + e.beats) { hit = e; break; }
    }
    if (!hit) { cur.hidden = true; return; }
    cur.hidden = false;
    cur.style.left = Math.round(hit.x - 9) + 'px';
    cur.style.top = Math.round(hit.y + 5) + 'px';
    cur.style.width = Math.round(hit.w) + 'px';
    cur.style.height = Math.round(hit.h) + 'px';
  }

  function totalBeats() {
    // Tunes can open with a pickup bar, so trust the music, not bars x beats.
    return practice.ex.totalBeats || practice.ex.bars * practice.ex.beatsPerBar;
  }

  function stopTransport() {
    if (practice.transport) {
      practice.transport.stop();
      practice.transport = null;
    }
    if (listen.mode === 'judge') stopListening();
    listen.beat = -99;
    practice.mode = null;
    $('cursor').hidden = true;
    $('pillCount').textContent = '';
    $('btnPlayAlong').classList.remove('is-playing');
    $('btnHear').classList.remove('is-playing');
    $('btnPlayAlong').innerHTML = '<span class="ic">&#9654;</span> Count in &amp; play along';
    $('btnHear').innerHTML = '<span class="ic">&#128266;</span> Hear it';
  }

  function run(mode) {
    if (!practice.ex) return;
    if (practice.transport) { stopTransport(); return; }
    if (listen.pending) return;
    if (!audio.available()) { boot('This browser has no Web Audio, so the metronome is unavailable.'); return; }
    audio.ensure();
    markActive();

    // Ask for the microphone before the count-in, so the permission prompt
    // never eats the first bar. Whatever happens, the play-along still runs.
    if (mode === 'play' && settings.listen && listen.mode !== 'judge') {
      listen.pending = true;
      $('btnPlayAlong').innerHTML = '<span class="ic">&#9685;</span> Starting the mic&#8230;';
      startListening('judge').then(function () {
        listen.pending = false;
        beginRun(mode);
      }, function () {
        listen.pending = false;
        beginRun(mode);
      });
      return;
    }
    beginRun(mode);
  }

  function beginRun(mode) {
    practice.mode = mode;

    if (mode === 'hear' && pitch.isRunning()) stopListening();   // don't listen to ourselves
    if (mode === 'play') {
      $('listenResult').hidden = true;
      listen.beat = -99;
      buildTargets();
      clearMarks();
    }

    var transport;
    try {
      transport = startFor(mode);
    } catch (err) {
      practice.mode = null;
      stopTransport();
      boot('Playback failed: ' + err.message);
      return;
    }
    if (!transport) { practice.mode = null; stopTransport(); return; }
    practice.transport = transport;

    var btn = mode === 'hear' ? $('btnHear') : $('btnPlayAlong');
    btn.classList.add('is-playing');
    btn.innerHTML = '<span class="ic">&#9632;</span> Stop';
  }

  function startFor(mode) {
    return audio.startTransport({
      tempo: settings.tempo,
      beatsPerBar: practice.ex.beatsPerBar,
      totalBeats: totalBeats(),
      countInBars: 1,
      events: notation.playbackEvents(practice.ex),
      clickMode: mode === 'hear' ? (settings.click === 'off' ? 'off' : 'countin') : settings.click,
      timbre: practice.ex.timbre,
      playNotes: mode === 'hear',
      onTick: function (beat) {
        listen.beat = beat;
        if (beat < 0) {
          $('pillCount').textContent = 'Ready… ' + Math.ceil(-beat);
          setCursor(-1);
        } else {
          $('pillCount').textContent = 'Bar ' + (Math.floor(beat / practice.ex.beatsPerBar) + 1) +
            ' of ' + practice.ex.bars;
          setCursor(beat);
          if (listen.mode === 'judge') judgePassedNotes(beat);
        }
      },
      onEnd: function () {
        var wasPlayAlong = practice.mode === 'play';
        if (wasPlayAlong) finishListening();
        stopTransport();
        if (wasPlayAlong) {
          store.recordExercise(practice.ex);   // counted once he has actually read it
          $('selfCheck').hidden = false;
        }
      }
    });
  }

  /* ============================ listening ============================ */

  var listen = {
    mode: null,        // 'check' while confirming the mic, 'judge' during a play-along
    pending: false,    // waiting on the permission prompt
    failed: false,     // a message is on screen that should stay there
    micMissed: false,  // the run went ahead without the microphone
    beat: -99,
    targets: []
  };

  // Only ever search the notes this exercise can contain (plus a few semitones
  // for wrong notes next door). It keeps metronome clicks and room rumble out,
  // and it makes the detector cheaper.
  function listenRange() {
    var lo = Infinity, hi = -Infinity;
    if (practice.ex) practice.ex.voices.forEach(function (voice) {
      voice.measures.forEach(function (items) {
        items.forEach(function (item) {
          if (item.rest || !item.note) return;
          var m = item.note.midi + (practice.ex.transpose || 0);
          if (m < lo) lo = m;
          if (m > hi) hi = m;
        });
      });
    });
    if (!isFinite(lo)) return { fmin: pitch.DEFAULTS.fmin, fmax: pitch.DEFAULTS.fmax };
    return { fmin: pitch.freqFromMidi(lo - 4), fmax: pitch.freqFromMidi(hi + 4) };
  }

  function setListenStatus(msg, cls) {
    var el = $('listenStatus');
    el.textContent = msg || '';
    el.className = 'hint' + (cls ? ' ' + cls : '');
  }

  function micButtonIdle() {
    $('btnMicCheck').innerHTML = '<span class="ic">&#127908;</span> Check my microphone';
  }

  function syncListenUI() {
    var box = $('chkListen');
    var reason = pitch.unavailableReason();
    if (reason) {
      settings.listen = false;
      box.checked = false;
      box.disabled = true;
      listen.failed = true;
      setListenStatus(reason.message, 'bad');
      $('btnMicCheck').disabled = true;
    } else {
      box.disabled = false;
      box.checked = !!settings.listen;
      if (box.checked && !listen.failed && !pitch.isRunning()) {
        setListenStatus(practice.ex && practice.ex.voices.length > 1
          ? 'It listens to the right hand only on a grand staff.'
          : 'Check the microphone first if you like, or just press play along.');
      }
    }
    $('listenBody').hidden = !(box.checked || listen.failed);
  }

  function paintReadout(res) {
    if ($('micReadout').hidden) return;
    var noteEl = $('micNote');
    noteEl.textContent = res.voiced ? (res.steadyMidi !== null ? res.steadyName : res.name) : '—';
    noteEl.classList.toggle('dim', !res.voiced);
    $('micCents').textContent = res.voiced
      ? (res.cents > 0 ? '+' : '') + res.cents + ' cents'
      : (res.rms > 0.012 ? 'not a clear note' : 'quiet');
    var needle = $('micNeedle');
    var cents = res.voiced ? Math.max(-50, Math.min(50, res.cents)) : 0;
    needle.style.left = (50 + cents) + '%';
    needle.classList.toggle('off', res.voiced && Math.abs(cents) > 20);
    needle.classList.toggle('quiet', !res.voiced);
    $('micLevel').style.width = Math.round(Math.max(0, Math.min(1, res.rms / 0.06)) * 100) + '%';
  }

  function onPitchFrame(res) {
    paintReadout(res);
    if (listen.mode !== 'judge' || listen.beat < 0) return;
    if (!res.voiced || res.confidence < 0.35) return;
    for (var i = 0; i < listen.targets.length; i++) {
      var t = listen.targets[i];
      // Skip the first slice of each note: that is where the click and the tail
      // of the note before it live.
      var lead = Math.min(0.3, t.beats * 0.25);
      if (listen.beat >= t.startBeat + lead && listen.beat < t.endBeat) {
        t.frames++;
        if (res.midi === t.midi) t.matched++;
        else t.heard[res.midi] = (t.heard[res.midi] || 0) + 1;
        return;
      }
    }
  }

  function buildTargets() {
    listen.targets = [];
    listen.micMissed = settings.listen && listen.mode !== 'judge';
    if (!practice.ex) return;
    // The top voice only: one microphone cannot follow two hands at once.
    practice.ex.voices[0].measures.forEach(function (items) {
      items.forEach(function (item) {
        if (item.rest || !item.note) return;
        listen.targets.push({
          startBeat: item.startBeat,
          endBeat: item.startBeat + item.beats,
          beats: item.beats,
          midi: item.note.midi + (practice.ex.transpose || 0),
          label: item.note.name + item.note.octave,
          verdict: null,
          frames: 0,
          matched: 0,
          heard: {}
        });
      });
    });
  }

  function clearMarks() { $('hitMarks').innerHTML = ''; }

  function paintMark(target) {
    var box = null;
    for (var i = 0; i < practice.layout.length; i++) {
      if (Math.abs(practice.layout[i].startBeat - target.startBeat) < 0.001) {
        box = practice.layout[i];
        break;
      }
    }
    if (!box || !target.verdict) return;
    var el = document.createElement('div');
    el.className = 'hitmark ' +
      (target.verdict === 'ok' ? 'ok' : target.verdict === 'wrong' ? 'bad' : 'miss');
    el.style.left = Math.round(box.x - 9) + 'px';
    el.style.top = Math.round(box.y + 5) + 'px';
    el.style.width = Math.round(box.w) + 'px';
    el.style.height = Math.round(box.h) + 'px';
    $('hitMarks').appendChild(el);
  }

  function repaintMarks() {
    clearMarks();
    listen.targets.forEach(function (t) { if (t.verdict) paintMark(t); });
  }

  // Name a heard note the way this key spells it, so a flat key does not come
  // back talking about A♯.
  var FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  function heardName(midi) {
    var key = practice.ex && T.KEYS[practice.ex.key];
    var flats = key && Object.keys(key.map).some(function (letter) { return key.map[letter] === 'b'; });
    if (!flats) return T.midiToName(midi);
    var m = Math.round(midi);
    return FLAT_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  function verdictFor(t) {
    var need = t.frames <= 2 ? 1 : 2;      // a sixteenth note only gets a frame or two
    if (t.matched >= need && t.matched / t.frames >= 0.4) return 'ok';
    if (t.frames >= 2) return 'wrong';
    return 'missed';
  }

  function judgePassedNotes(beat) {
    listen.targets.forEach(function (t) {
      if (t.verdict || beat < t.endBeat + 0.05) return;
      t.verdict = verdictFor(t);
      paintMark(t);
    });
  }

  function startListening(mode) {
    var range = listenRange();
    listen.failed = false;
    if (pitch.isRunning()) {
      listen.mode = mode;
      pitch.setRange(range.fmin, range.fmax);
      return Promise.resolve(true);
    }
    setListenStatus('Asking for the microphone…');
    return pitch.start({
      fmin: range.fmin,
      fmax: range.fmax,
      onResult: onPitchFrame,
      onError: handleListenError
    }).then(function () {
      listen.mode = mode;
      listen.micMissed = false;
      setListenStatus(mode === 'check'
        ? 'Play a long note — it should name it here.'
        : 'Listening…');
      return true;
    }, function (err) {
      handleListenError(err);
      throw err;
    });
  }

  function stopListening() {
    pitch.stop();
    listen.mode = null;
    $('micReadout').hidden = true;
    micButtonIdle();
  }

  function handleListenError(err) {
    pitch.stop();
    listen.mode = null;
    listen.failed = true;
    listen.micMissed = true;
    micButtonIdle();
    $('micReadout').hidden = true;
    setListenStatus(err.message, 'bad');
    // Permission and hardware problems will not fix themselves, so take the
    // toggle off rather than asking again every single run.
    if (err.code === 'denied' || err.code === 'unsupported' ||
        err.code === 'insecure' || err.code === 'no-device') {
      settings.listen = false;
      $('chkListen').checked = false;
      persist();
    }
    $('listenBody').hidden = false;
  }

  function toggleMicCheck() {
    if (pitch.isRunning() && listen.mode === 'check') {
      stopListening();
      setListenStatus('Microphone off.');
      return;
    }
    audio.ensure();
    $('micReadout').hidden = false;
    paintReadout({ voiced: false, rms: 0, cents: 0, steadyMidi: null, name: '—' });
    startListening('check').then(function () {
      $('btnMicCheck').innerHTML = '<span class="ic">&#9632;</span> Stop checking';
    }, function () { /* handleListenError already said why */ });
  }

  function onListenToggle() {
    settings.listen = $('chkListen').checked;
    listen.failed = false;
    if (!settings.listen) {
      stopListening();
      setListenStatus('');
      $('listenResult').hidden = true;
    }
    syncListenUI();
    persist();
    markActive();
  }

  function finishListening() {
    if (listen.mode !== 'judge') {
      if (listen.micMissed && settings.listen) {
        $('listenResult').hidden = false;
        $('listenResult').innerHTML = '<p class="hint bad">The microphone did not start, ' +
          'so that run was not marked.</p>';
      }
      return;
    }

    listen.targets.forEach(function (t) {
      if (!t.verdict) { t.verdict = verdictFor(t); paintMark(t); }
    });

    var transpose = practice.ex ? (practice.ex.transpose || 0) : 0;
    var ok = 0, wrong = [], missed = [];
    listen.targets.forEach(function (t) {
      if (t.verdict === 'ok') { ok++; return; }
      if (t.verdict === 'missed') { missed.push(t.label); return; }
      var top = null;
      Object.keys(t.heard).forEach(function (k) {
        if (top === null || t.heard[k] > t.heard[top]) top = k;
      });
      var detail = t.label;
      if (top !== null) {
        var heardMidi = parseInt(top, 10);
        // Named as written pitch, like the music on screen.
        detail += ' → ' + heardName(heardMidi - transpose);
        var gap = heardMidi - t.midi;
        if (gap !== 0 && gap % 12 === 0) detail += ' (an octave ' + (gap > 0 ? 'up' : 'down') + ')';
      }
      wrong.push(detail);
    });

    var total = listen.targets.length;
    var html = '<div class="big-score">' + ok + ' / ' + total + '</div>' +
      '<p>notes heard right' + (practice.ex.voices.length > 1 ? ', in the right hand' : '') + '</p>' +
      '<div class="tally"><span class="ok">' + ok + ' right</span>' +
      '<span class="bad">' + wrong.length + ' different</span>' +
      '<span class="miss">' + missed.length + ' not heard</span></div>';
    if (wrong.length) html += '<p class="hint">Came out as something else: ' + wrong.join(', ') + '.</p>';
    if (missed.length) html += '<p class="hint">Nothing heard here: ' + missed.join(', ') +
      ' — the dashed grey notes.</p>';
    if (total && !wrong.length && !missed.length) html += '<p class="hint">Every note matched. Nice.</p>';
    if (!total) html = '<p class="hint">That exercise had nothing to listen for.</p>';

    $('listenResult').hidden = false;
    $('listenResult').innerHTML = html;
    stopListening();              // give the microphone back until the next run
    setListenStatus('');
  }

  /* ============================ note drill ============================ */

  function buildNoteRow() {
    var row = $('noteRow');
    row.innerHTML = '';
    T.LETTERS.forEach(function (letter) {
      var b = document.createElement('button');
      b.className = 'note-btn';
      b.dataset.letter = letter;
      b.textContent = letter.toUpperCase();
      row.appendChild(b);
    });
    row.addEventListener('click', function (e) {
      var btn = e.target.closest('.note-btn');
      if (!btn) return;
      answerName(btn.dataset.letter, drill.acc);
    });
  }

  function buildPiano() {
    var piano = $('piano');
    piano.innerHTML = '';
    var blackAfter = { c: 1, d: 1, f: 1, g: 1, a: 1 };
    for (var oct = 3; oct <= 6; oct++) {
      for (var i = 0; i < T.LETTERS.length; i++) {
        var letter = T.LETTERS[i];
        if (oct === 6 && letter !== 'c') continue;        // stop at top C
        var white = document.createElement('div');
        white.className = 'wkey';
        white.dataset.midi = T.midiOf(letter, '', oct);
        if (letter === 'c') white.textContent = 'C' + oct;
        piano.appendChild(white);
        if (blackAfter[letter] && !(oct === 6)) {
          var black = document.createElement('div');
          black.className = 'bkey';
          black.dataset.midi = T.midiOf(letter, '#', oct);
          white.appendChild(black);
        }
      }
    }
    piano.addEventListener('click', function (e) {
      var key = e.target.closest('.bkey, .wkey');
      if (!key) return;
      answerMidi(parseInt(key.dataset.midi, 10), key);
    });
  }

  function syncAnswerMode() {
    var byName = settings.answerMode === 'name';
    $('namePad').hidden = !byName;
    $('keyPad').hidden = byName;
  }

  function drillStats() {
    $('drillScore').textContent = drill.correct + '/' + drill.index;
    $('drillStreak').textContent = drill.streak;
    $('drillLeft').textContent = Math.max(0, ROUND_LENGTH - drill.index);
  }

  function startRound() {
    audio.ensure();
    drill.active = true;
    drill.index = 0;
    drill.correct = 0;
    drill.streak = 0;
    drill.results = [];
    drill.locked = false;
    $('roundSummary').hidden = true;
    $('btnDrillSkip').disabled = false;
    $('btnDrillStart').textContent = 'Restart round';
    drillStats();
    nextQuestion();
  }

  function nextQuestion() {
    if (drill.index >= ROUND_LENGTH) return finishRound();
    drill.q = gen.randomDrillNote(settings);
    drill.locked = false;
    drill.tStart = Date.now();
    setFeedback('Which note is this?', '');
    clearKeyMarks();
    try {
      notation.renderSingleNote($('drillNotation'), drill.q, {});
    } catch (err) {
      boot('Could not draw the note: ' + err.message);
      throw err;
    }
    if (drill.timer) clearInterval(drill.timer);
    drill.timer = setInterval(function () {
      if (drill.locked) return;
      $('drillTimer').textContent = ((Date.now() - drill.tStart) / 1000).toFixed(1) + 's';
    }, 100);
    drillStats();
  }

  function setFeedback(text, cls) {
    var el = $('drillFeedback');
    el.textContent = text;
    el.className = 'feedback' + (cls ? ' ' + cls : '');
  }

  function clearKeyMarks() {
    Array.prototype.forEach.call(document.querySelectorAll('.wkey, .bkey'), function (k) {
      k.classList.remove('ok', 'bad', 'hit');
    });
  }

  function markCorrectKey() {
    var el = document.querySelector('[data-midi="' + drill.q.note.midi + '"]');
    if (el) el.classList.add('ok');
  }

  function grade(correct, chosenLabel, keyEl) {
    if (!drill.active || drill.locked) return;
    drill.locked = true;
    markActive();
    var ms = Date.now() - drill.tStart;
    drill.index++;
    var q = drill.q;

    if (correct) {
      drill.correct++;
      drill.streak++;
      store.recordStreak(drill.streak);
      setFeedback('✓ ' + q.note.name + '  ·  ' + (ms / 1000).toFixed(1) + 's', 'ok');
      if (keyEl) keyEl.classList.add('ok');
      audio.playNote(q.note.midi + (settings.instrument === 'clarinet' ? T.INSTRUMENTS.clarinet.transpose : 0),
        audio.now() + 0.01, 0.6, T.INSTRUMENTS[settings.instrument].timbre);
    } else {
      drill.streak = 0;
      setFeedback('✗ that was ' + q.note.name + (chosenLabel ? ' — you picked ' + chosenLabel : ''), 'bad');
      if (keyEl) keyEl.classList.add('bad');
      if (settings.answerMode === 'keys') markCorrectKey();
    }

    store.recordDrillAnswer({
      noteLabel: q.note.name,
      key: q.key,
      clef: q.clef,
      correct: correct,
      ms: ms
    });
    drill.results.push({ label: q.note.name, correct: correct, ms: ms });
    drillStats();
    setTimeout(nextQuestion, correct ? 700 : 1500);
  }

  function answerName(letter, acc) {
    if (!drill.active || drill.locked) return;
    var q = drill.q;
    var correct = (letter === q.note.letter) && ((acc || '') === (q.note.acc || ''));
    grade(correct, T.prettyName(letter, acc), null);
  }

  function answerMidi(midi, el) {
    if (!drill.active || drill.locked) return;
    var correct = midi === drill.q.note.midi;
    grade(correct, T.midiToName(midi), el);
  }

  function finishRound() {
    drill.active = false;
    if (drill.timer) clearInterval(drill.timer);
    $('btnDrillSkip').disabled = true;
    $('btnDrillStart').textContent = 'Start round';
    store.recordRound(drill.correct, ROUND_LENGTH);
    var pct = Math.round((drill.correct / ROUND_LENGTH) * 100);
    var times = drill.results.filter(function (r) { return r.correct; }).map(function (r) { return r.ms; });
    var avg = times.length ? (times.reduce(function (a, b) { return a + b; }, 0) / times.length / 1000) : 0;
    var missed = {};
    drill.results.forEach(function (r) { if (!r.correct) missed[r.label] = (missed[r.label] || 0) + 1; });
    var missedList = Object.keys(missed);
    $('roundSummary').hidden = false;
    $('roundSummary').innerHTML =
      '<div class="big-score">' + drill.correct + ' / ' + ROUND_LENGTH + '</div>' +
      '<p>' + (pct >= 90 ? 'Excellent reading!' : pct >= 70 ? 'Good work — keep going.' : 'Worth another round.') +
      '</p><p class="hint">Average ' + avg.toFixed(1) + 's on the ones you got right.' +
      (missedList.length ? ' Tripped on: ' + missedList.join(', ') + '.' : ' Nothing missed.') + '</p>';
    setFeedback('Round finished.', '');
    renderProgress();
  }

  /* ============================ progress ============================ */

  function renderProgress() {
    var t = store.totals();
    var today = store.todayStats();
    var acc = t.drillQ ? Math.round((t.drillCorrect / t.drillQ) * 100) : 0;
    var tiles = [
      ['Day streak', store.dayStreak(), store.dayStreak() === 1 ? 'day in a row' : 'days in a row'],
      ['Today', fmtTime(today.seconds), today.exercises + ' read · ' + today.drillQ + ' notes named'],
      ['All time', fmtTime(t.seconds), t.exercises + ' exercises · ' + t.daysActive +
        (t.daysActive === 1 ? ' day' : ' days')],
      ['Note naming', acc + '%', t.drillQ + ' answers · best streak ' + store.data.drill.best.streak]
    ];
    $('progressTiles').innerHTML = tiles.map(function (row) {
      return '<div class="tile"><small>' + row[0] + '</small><strong>' + row[1] + '</strong><small>' + row[2] + '</small></div>';
    }).join('');

    var week = store.last7Days();
    var max = Math.max(10, Math.max.apply(null, week.map(function (d) { return d.minutes; })));
    $('weekChart').innerHTML = week.map(function (d) {
      var h = Math.round((d.minutes / max) * 100);
      var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return '<div class="weekcol"><div class="val">' + (d.minutes || '') + '</div>' +
        '<div class="fill' + (d.minutes ? '' : ' empty') + '" style="height:' + Math.max(3, h) + '%"></div>' +
        '<div class="lab">' + names[d.date.getDay()] + '</div></div>';
    }).join('');

    function barRows(entries) {
      if (!entries.length) return '<p class="hint">Not enough answers yet — play a round of Name It.</p>';
      return entries.map(function (e) {
        var pct = Math.round(e.pct * 100);
        var cls = pct >= 85 ? '' : pct >= 60 ? ' mid' : ' low';
        return '<div class="bar-row"><div class="lab">' + e.label + '</div>' +
          '<div class="track"><div class="fill' + cls + '" style="width:' + pct + '%"></div></div>' +
          '<div class="num">' + pct + '% · ' + e.asked + '</div></div>';
      }).join('');
    }

    $('weakBars').innerHTML = barRows(store.weakest(6));

    var byKey = store.byKeyStats();
    $('keyBars').innerHTML = barRows(Object.keys(byKey).map(function (k) {
      var b = byKey[k];
      return { label: (T.KEYS[k] ? T.KEYS[k].label : k), asked: b.asked, pct: b.asked ? b.correct / b.asked : 0 };
    }).filter(function (r) { return r.asked >= 3; }).sort(function (a, b) { return a.pct - b.pct; }));

    $('storeNote').textContent = store.available()
      ? 'Progress is saved in this browser only.'
      : 'This browser is blocking local storage, so progress will not be remembered.';
  }

  /* ============================ views ============================ */

  function showView(name) {
    ['practice', 'drill', 'progress'].forEach(function (v) {
      $('view-' + v).hidden = v !== name;
    });
    Array.prototype.forEach.call($('tabs').querySelectorAll('.tab'), function (b) {
      b.classList.toggle('is-on', b.dataset.view === name);
    });
    document.querySelector('.setup').hidden = (name === 'progress');
    if (name === 'progress') renderProgress();
    if (name === 'practice' && practice.ex) renderPractice();
    if (name !== 'practice') stopTransport();
    markActive();
  }

  /* ============================ events ============================ */

  function wire() {
    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (b) showView(b.dataset.view);
    });

    onSegment($('segInstrument'), function (v) {
      settings.instrument = v;
      fillKeySelect();
      syncInstrumentUI();
      newExercise();
    });
    onSegment($('segClef'), function (v) {
      settings.clef = v;
      syncInstrumentUI();
      newExercise();
    });
    onSegment($('segLevel'), function (v) {
      settings.level = parseInt(v, 10);
      fillKeySelect();
      syncInstrumentUI();
      newExercise();
    });
    onSegment($('segBars'), function (v) {
      settings.bars = parseInt(v, 10);
      newExercise();
    });
    onSegment($('segSource'), function (v) {
      settings.source = v;
      syncSourceUI();
      persist();
      newExercise();
    });
    onSegment($('segAnswerMode'), function (v) {
      settings.answerMode = v;
      syncAnswerMode();
      persist();
    });
    onSegment($('segAcc'), function (v) { drill.acc = v; });

    $('selKey').addEventListener('change', function () {
      settings.key = this.value;
      newExercise();
      persist();
    });
    $('selTime').addEventListener('change', function () {
      settings.timeSig = this.value;
      newExercise();
      persist();
    });
    $('selClick').addEventListener('change', function () {
      settings.click = this.value;
      persist();
    });
    $('chkRests').addEventListener('change', function () {
      settings.rests = this.checked;
      newExercise();
      persist();
    });
    $('chkAcc').addEventListener('change', function () {
      settings.accidentals = this.checked;
      newExercise();
      persist();
    });
    $('rngVol').addEventListener('input', function () {
      settings.volume = parseInt(this.value, 10);
      audio.setVolume(settings.volume / 100);
      persist();
    });
    $('rngTempo').addEventListener('input', function () {
      settings.tempo = parseInt(this.value, 10);
      $('tempoOut').textContent = settings.tempo;
      updatePills();
      markActive();
    });
    $('rngTempo').addEventListener('change', persist);

    Array.prototype.forEach.call(document.querySelectorAll('.tempo-presets .chip'), function (chip) {
      chip.addEventListener('click', function () {
        settings.tempo = parseInt(chip.dataset.tempo, 10);
        $('rngTempo').value = settings.tempo;
        $('tempoOut').textContent = settings.tempo;
        updatePills();
        persist();
        markActive();
      });
    });

    $('chkListen').addEventListener('change', onListenToggle);
    $('btnMicCheck').addEventListener('click', toggleMicCheck);

    $('btnNew').addEventListener('click', newExercise);
    $('btnReveal').addEventListener('click', revealTune);
    $('btnPlayAlong').addEventListener('click', function () { run('play'); });
    $('btnHear').addEventListener('click', function () { run('hear'); });
    $('btnGood').addEventListener('click', function () { $('selfCheck').hidden = true; newExercise(); });
    $('btnAgain').addEventListener('click', function () { $('selfCheck').hidden = true; markActive(); });

    $('btnDrillStart').addEventListener('click', startRound);
    $('btnDrillSkip').addEventListener('click', function () {
      if (drill.active && !drill.locked) grade(false, null, null);
    });

    $('btnReset').addEventListener('click', function () {
      if (global.confirm('Clear all saved practice history? This cannot be undone.')) {
        store.reset();
        renderProgress();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input, select, textarea')) return;
      var k = e.key.toLowerCase();
      var inDrill = !$('view-drill').hidden;

      if (inDrill && drill.active) {
        if (/^[a-g]$/.test(k)) { e.preventDefault(); return answerName(k, drill.acc); }
        if (k === '#' || k === '3') { drill.acc = '#'; setSegment($('segAcc'), '#'); return; }
        if (k === 'b' || k === '-') { drill.acc = 'b'; setSegment($('segAcc'), 'b'); return; }
        if (k === '0' || k === 'n') { drill.acc = ''; setSegment($('segAcc'), ''); return; }
      }

      if (k === ' ' || k === 'spacebar') {
        e.preventDefault();
        if (inDrill) { if (!drill.active) startRound(); }
        else run('play');
        return;
      }
      if (k === 'h' && !inDrill) { run('hear'); return; }
      if (k === 'l' && !inDrill) {
        var box = $('chkListen');
        if (!box.disabled) { box.checked = !box.checked; onListenToggle(); }
        return;
      }
      if (k === 'n' && !inDrill) { newExercise(); return; }
      if (k === 'r' && !inDrill) { revealTune(); return; }
      if (/^[1-5]$/.test(k)) {
        if (!inDrill || !drill.active) {
          settings.level = parseInt(k, 10);
          setSegment($('segLevel'), settings.level);
          fillKeySelect();
          syncInstrumentUI();
          newExercise();
        }
      }
    });

    ['pointerdown', 'keydown'].forEach(function (evt) {
      document.addEventListener(evt, markActive, { passive: true });
    });

    var resizeTimer = null;
    global.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!$('view-practice').hidden && practice.ex) renderPractice();
        if (!$('view-drill').hidden && drill.q) notation.renderSingleNote($('drillNotation'), drill.q, {});
      }, 180);
    });

    // Count practice time while the tab is open and something is happening.
    setInterval(function () {
      if (document.visibilityState === 'visible' && Date.now() - lastActive < 90000) {
        store.addSeconds(10);
      }
    }, 10000);
  }

  /* ============================ start ============================ */

  function start() {
    if (!notation.isReady()) {
      boot('VexFlow did not load. Check that vendor/vexflow.js sits next to index.html.');
      return;
    }
    buildNoteRow();
    buildPiano();
    applySavedSettings();
    wire();
    newExercise();
    renderProgress();
    showView('practice');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
