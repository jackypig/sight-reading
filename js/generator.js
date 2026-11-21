/* generator.js — builds random sight-reading exercises.
 * Produces beat-aligned, readable rhythms and a stepwise-ish melody that
 * starts and ends on a stable note of the key.
 */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var T = SR.theory;

  function randInt(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[randInt(arr.length)]; }
  function chance(p) { return Math.random() < p; }

  /* ---------- rhythm ---------- */

  // Fill one bar with beat-aligned groups. Returns [{durKey, beats}].
  function makeBarRhythm(beatsPerBar, allowed, opts) {
    opts = opts || {};
    var items = [];
    var remaining = beatsPerBar;
    var guard = 0;
    var has = function (k) { return allowed.indexOf(k) !== -1; };

    while (remaining > 0.001 && guard++ < 64) {
      var options = [];
      var atBarStart = items.length === 0;

      if (has('w') && atBarStart && Math.abs(remaining - 4) < 0.001) options.push({ w: 2, groups: [['w', 4]] });
      if (has('hd') && Math.abs(remaining - 3) < 0.001) options.push({ w: 3, groups: [['hd', 3]] });
      if (has('h') && remaining >= 2) options.push({ w: 4, groups: [['h', 2]] });
      if (has('qd') && remaining >= 2 && has('e')) options.push({ w: 3, groups: [['qd', 1.5], ['e', 0.5]] });
      if (has('e') && remaining >= 1) options.push({ w: opts.eighthWeight || 5, groups: [['e', 0.5], ['e', 0.5]] });
      if (has('s') && remaining >= 1) options.push({ w: 2, groups: [['s', 0.25], ['s', 0.25], ['s', 0.25], ['s', 0.25]] });
      if (has('s') && has('e') && remaining >= 1) options.push({ w: 2, groups: [['e', 0.5], ['s', 0.25], ['s', 0.25]] });
      if (has('q') && remaining >= 1) options.push({ w: 8, groups: [['q', 1]] });

      if (!options.length) {
        // Tidy up whatever sliver is left.
        if (remaining >= 1) options.push({ w: 1, groups: [['q', 1]] });
        else if (remaining >= 0.5) options.push({ w: 1, groups: [['e', 0.5]] });
        else options.push({ w: 1, groups: [['s', 0.25]] });
      }

      var total = options.reduce(function (s, o) { return s + o.w; }, 0);
      var r = Math.random() * total;
      var choice = options[options.length - 1];
      for (var i = 0; i < options.length; i++) {
        r -= options[i].w;
        if (r <= 0) { choice = options[i]; break; }
      }
      for (var g = 0; g < choice.groups.length; g++) {
        items.push({ durKey: choice.groups[g][0], beats: choice.groups[g][1] });
        remaining -= choice.groups[g][1];
      }
    }
    return items;
  }

  /* ---------- melody ---------- */

  function nearestIndex(notes, midi) {
    var best = 0, bestDist = Infinity;
    for (var i = 0; i < notes.length; i++) {
      var d = Math.abs(notes[i].midi - midi);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  // Indexes in `notes` whose letter is the tonic of the key.
  function stableIndexes(notes, keyName) {
    var tonic = T.KEYS[keyName].tonic;
    var out = [];
    for (var i = 0; i < notes.length; i++) if (notes[i].letter === tonic) out.push(i);
    return out;
  }

  function makeMelody(count, notes, keyName, level) {
    var mid = Math.floor(notes.length / 2);
    var stables = stableIndexes(notes, keyName);
    var startIdx = stables.length
      ? stables[nearestIndex(stables.map(function (i) { return notes[i]; }), notes[mid].midi)]
      : mid;

    var seq = [];
    var idx = startIdx;
    var dir = chance(0.5) ? 1 : -1;

    for (var n = 0; n < count; n++) {
      if (n > 0) {
        var r = Math.random();
        var step = r < 0.55 ? 1 : r < 0.8 ? 2 : r < 0.95 ? 3 : 0;
        if (chance(0.3)) dir = -dir;                         // change of contour
        if (idx <= 1) dir = 1;                                // bounce off the edges
        if (idx >= notes.length - 2) dir = -1;
        var next = idx + dir * step;
        if (next < 0 || next > notes.length - 1) next = idx - dir * step;
        idx = Math.max(0, Math.min(notes.length - 1, next));
      }
      var note = notes[idx];
      // Occasional chromatic colour at the hardest levels.
      if (level >= 4 && n > 0 && n < count - 1 && chance(0.07)) {
        var alt = T.chromaticNeighbour(note, chance(0.5) ? 1 : -1);
        if (alt && alt.midi >= notes[0].midi && alt.midi <= notes[notes.length - 1].midi) note = alt;
      }
      seq.push(note);
    }

    // Land on a stable note.
    if (stables.length && seq.length > 1) {
      var endIdx = stables.reduce(function (bestI, i) {
        return Math.abs(notes[i].midi - seq[seq.length - 1].midi) <
               Math.abs(notes[bestI].midi - seq[seq.length - 1].midi) ? i : bestI;
      }, stables[0]);
      seq[seq.length - 1] = notes[endIdx];
    }
    return seq;
  }

  /* ---------- one staff line ---------- */

  function buildVoice(opts) {
    // opts: {clef, keyName, level, bars, beatsPerBar, range, allowedRhythms, restChance, hand}
    var measures = [];
    var rhythms = [];
    var totalNotes = 0;
    var b;
    for (b = 0; b < opts.bars; b++) {
      var bar = makeBarRhythm(opts.beatsPerBar, opts.allowedRhythms, { eighthWeight: opts.eighthWeight });
      rhythms.push(bar);
      totalNotes += bar.length;
    }

    var scale = T.scaleNotesInRange(opts.keyName, opts.range.low, opts.range.high);
    if (!scale.length) scale = T.scaleNotesInRange('C', 60, 72);
    var melody = makeMelody(totalNotes, scale, opts.keyName, opts.level);

    var k = 0;
    var beatCursor = 0;
    for (b = 0; b < rhythms.length; b++) {
      var items = [];
      var restsThisBar = 0;
      for (var j = 0; j < rhythms[b].length; j++) {
        var r = rhythms[b][j];
        var isLast = (b === rhythms.length - 1) && (j === rhythms[b].length - 1);
        var isFirst = (b === 0 && j === 0);
        // At most one rest per bar, so the music still sounds like a melody,
        // and only on plain values — a dotted rest reads oddly at this level.
        var rest = !isFirst && !isLast && restsThisBar === 0 &&
          T.DUR[r.durKey].dots === 0 && r.beats >= 0.5 && r.beats <= 2 &&
          chance(opts.restChance || 0);
        if (rest) restsThisBar++;
        items.push({
          note: rest ? null : melody[k],
          rest: rest,
          durKey: r.durKey,
          durCode: T.DUR[r.durKey].code,
          dots: T.DUR[r.durKey].dots,
          beats: r.beats,
          startBeat: beatCursor,
          bar: b
        });
        k++;
        beatCursor += r.beats;
      }
      measures.push(items);
    }
    return { clef: opts.clef, measures: measures };
  }

  /* ---------- public ---------- */

  // settings: {instrument, level, clef, key ('auto' or name), bars, timeSig:'4/4'|'3/4', rests, accidentals}
  function generate(settings) {
    var level = settings.level;
    var instrument = settings.instrument;
    var clef = settings.clef || 'treble';
    var keyName = settings.key && settings.key !== 'auto'
      ? settings.key
      : pick(T.keysFor(instrument, level));

    var tsParts = (settings.timeSig || '4/4').split('/');
    var timeSig = { num: parseInt(tsParts[0], 10), den: parseInt(tsParts[1], 10) };
    var beatsPerBar = timeSig.num * (4 / timeSig.den);

    var allowed = (T.RHYTHM_LEVELS[level] || T.RHYTHM_LEVELS[1]).slice();
    if (settings.sixteenths === false) allowed = allowed.filter(function (d) { return d !== 's'; });
    var restChance = settings.rests ? (level <= 2 ? 0.08 : level === 3 ? 0.12 : 0.16) : 0;
    var effLevel = settings.accidentals ? level : Math.min(level, 3);

    var bars = settings.bars || 4;
    var voices = [];

    if (instrument === 'piano' && clef === 'grand') {
      voices.push(buildVoice({
        clef: 'treble', keyName: keyName, level: effLevel, bars: bars, beatsPerBar: beatsPerBar,
        range: T.rangeFor('piano', level, 'grand'), allowedRhythms: allowed, restChance: restChance
      }));
      // Left hand: calmer rhythm, lower range.
      var bassAllowed = level === 1 ? ['w', 'h'] : ['w', 'hd', 'h', 'q'];
      voices.push(buildVoice({
        clef: 'bass', keyName: keyName, level: Math.min(effLevel, 2), bars: bars, beatsPerBar: beatsPerBar,
        range: T.bassRangeFor('piano', level), allowedRhythms: bassAllowed, restChance: 0, eighthWeight: 1
      }));
    } else {
      voices.push(buildVoice({
        clef: clef === 'grand' ? 'treble' : clef,
        keyName: keyName, level: effLevel, bars: bars, beatsPerBar: beatsPerBar,
        range: T.rangeFor(instrument, level, clef), allowedRhythms: allowed, restChance: restChance
      }));
    }

    return {
      instrument: instrument,
      level: level,
      clef: clef,
      key: keyName,
      keySpec: T.KEYS[keyName].spec,
      keyLabel: T.KEYS[keyName].label,
      timeSig: timeSig,
      beatsPerBar: beatsPerBar,
      bars: bars,
      totalBeats: bars * beatsPerBar,
      voices: voices,
      transpose: T.INSTRUMENTS[instrument].transpose,
      timbre: T.INSTRUMENTS[instrument].timbre
    };
  }

  // One random note for the recognition drill.
  function randomDrillNote(settings) {
    var instrument = settings.instrument;
    var clef = settings.clef === 'grand' ? (chance(0.5) ? 'treble' : 'bass') : (settings.clef || 'treble');
    var keyName = settings.key && settings.key !== 'auto'
      ? settings.key
      : pick(T.keysFor(instrument, settings.level));
    var range = instrument === 'piano' && clef === 'bass'
      ? T.bassRangeFor('piano', settings.level)
      : T.rangeFor(instrument, settings.level, clef);
    var scale = T.scaleNotesInRange(keyName, range.low, range.high);
    var note = pick(scale);
    if (settings.accidentals && settings.level >= 3 && chance(0.1)) {
      var alt = T.chromaticNeighbour(note, chance(0.5) ? 1 : -1);
      if (alt) note = alt;
    }
    return { note: note, clef: clef, key: keyName, keySpec: T.KEYS[keyName].spec };
  }

  SR.generator = {
    generate: generate,
    randomDrillNote: randomDrillNote,
    makeBarRhythm: makeBarRhythm
  };
})(window);
