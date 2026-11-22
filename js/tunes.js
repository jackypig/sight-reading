/* tunes.js — a small library of real melodies he will recognise, and the code
 * that turns one into the same kind of exercise object the generator makes.
 *
 * Everything here is public domain: traditional songs and classical themes old
 * enough to be out of copyright. Modern pop and film music is not, so it cannot
 * be reproduced as notation — that is the only reason it is missing.
 *
 * Melodies are stored at CONCERT pitch. Clarinet mode transposes them up a major
 * 2nd into written pitch, and every tune is shifted by whole octaves to sit
 * inside the current instrument's range.
 *
 * Notation format: bars separated by "|", notes separated by spaces.
 *   c4q      C natural, octave 4, quarter note
 *   f#5e     F sharp, octave 5, eighth note
 *   bb3h     B flat, octave 3, half note
 *   g4q.     dotted quarter
 *   rq       quarter rest
 * Durations: w whole, h half, q quarter, e eighth, s sixteenth.
 * A short first bar is treated as a pickup and rendered as one.
 */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var T = SR.theory;

  var BEATS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
  var CODES = { w: 'w', h: 'h', q: 'q', e: '8', s: '16' };

  var TUNES = [
    {
      id: 'ode-to-joy', title: 'Ode to Joy', by: 'Beethoven',
      blurb: 'the big tune from the Ninth Symphony',
      key: 'C', time: '4/4', level: 1,
      music: 'e4q e4q f4q g4q | g4q f4q e4q d4q | c4q c4q d4q e4q | e4q. d4e d4h'
    },
    {
      id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', by: 'Traditional',
      blurb: 'also the alphabet song, and Baa Baa Black Sheep',
      key: 'C', time: '4/4', level: 1,
      music: 'c4q c4q g4q g4q | a4q a4q g4h | f4q f4q e4q e4q | d4q d4q c4h'
    },
    {
      id: 'mary-lamb', title: 'Mary Had a Little Lamb', by: 'Traditional',
      blurb: 'the first tune almost everyone learns',
      key: 'C', time: '4/4', level: 1,
      music: 'e4q d4q c4q d4q | e4q e4q e4h | d4q d4q d4h | e4q g4q g4h'
    },
    {
      id: 'jingle-bells', title: 'Jingle Bells', by: 'James Pierpont',
      blurb: 'the chorus',
      key: 'C', time: '4/4', level: 1,
      music: 'e4q e4q e4h | e4q e4q e4h | e4q g4q c4q. d4e | e4w'
    },
    {
      id: 'old-macdonald', title: 'Old MacDonald Had a Farm', by: 'Traditional',
      blurb: 'E-I-E-I-O',
      key: 'C', time: '4/4', level: 2,
      music: 'c4q c4q c4q g3q | a3q a3q g3h | e4q e4q d4q d4q | c4w'
    },
    {
      id: 'yankee-doodle', title: 'Yankee Doodle', by: 'Traditional',
      blurb: 'stuck a feather in his cap',
      key: 'C', time: '4/4', level: 2,
      music: 'c4q c4q d4q e4q | c4q e4q d4q g3q | c4q c4q d4q e4q | c4h b3h'
    },
    {
      id: 'ode-to-joy-full', title: 'Ode to Joy', by: 'Beethoven',
      blurb: 'the whole theme this time, all eight bars',
      key: 'C', time: '4/4', level: 2,
      music: 'e4q e4q f4q g4q | g4q f4q e4q d4q | c4q c4q d4q e4q | e4q. d4e d4h | ' +
             'e4q e4q f4q g4q | g4q f4q e4q d4q | c4q c4q d4q e4q | d4q. c4e c4h'
    },
    {
      id: 'frere-jacques', title: 'Frère Jacques', by: 'Traditional',
      blurb: 'the round — try it against the playback',
      key: 'C', time: '4/4', level: 3,
      music: 'c4q d4q e4q c4q | c4q d4q e4q c4q | e4q f4q g4h | e4q f4q g4h | ' +
             'g4e a4e g4e f4e e4q c4q | g4e a4e g4e f4e e4q c4q | c4q g3q c4h | c4q g3q c4h'
    },
    {
      id: 'three-blind-mice', title: 'Three Blind Mice', by: 'Traditional',
      blurb: 'see how they run',
      key: 'C', time: '4/4', level: 3,
      music: 'e4q d4q c4h | e4q d4q c4h | g4q f4e f4e e4h | g4q f4e f4e e4h'
    },
    {
      id: 'happy-birthday', title: 'Happy Birthday to You', by: 'Patty & Mildred Hill',
      blurb: 'useful to have in your fingers',
      key: 'C', time: '3/4', level: 4,
      music: 'g3e g3e | a3q g3q c4q | b3h g3e g3e | a3q g3q d4q | c4h g4e g4e | ' +
             'e4q c4q b3q | a3h f4e f4e | e4q c4q d4q | c4h.'
    },
    {
      id: 'beethoven-5', title: 'Symphony No. 5', by: 'Beethoven',
      blurb: 'da-da-da-DUM — the most famous four notes in music',
      key: 'Eb', time: '2/4', level: 4,
      music: 're g4e g4e g4e | eb4h | re f4e f4e f4e | d4h'
    }
  ];

  /* ---------- parsing ---------- */

  function parseToken(tok) {
    var rest = /^r([whqes])(\.?)$/.exec(tok);
    if (rest) {
      return { rest: true, note: null, letter: null, dur: rest[1], dotted: !!rest[2] };
    }
    var m = /^([a-g])([#b]?)(-?\d)([whqes])(\.?)$/.exec(tok);
    if (!m) return null;
    return {
      rest: false,
      note: T.makeNote(m[1], m[2], parseInt(m[3], 10)),
      dur: m[4],
      dotted: !!m[5]
    };
  }

  function parseMusic(music) {
    var bars = String(music).split('|');
    var measures = [];
    var bad = [];
    bars.forEach(function (barText, barIndex) {
      var tokens = barText.trim().split(/\s+/).filter(Boolean);
      var items = [];
      tokens.forEach(function (tok) {
        var parsed = parseToken(tok);
        if (!parsed) { bad.push(tok); return; }
        var beats = BEATS[parsed.dur] * (parsed.dotted ? 1.5 : 1);
        items.push({
          note: parsed.note,
          rest: parsed.rest,
          durCode: CODES[parsed.dur],
          dots: parsed.dotted ? 1 : 0,
          beats: beats,
          startBeat: 0,
          bar: barIndex
        });
      });
      measures.push(items);
    });
    return { measures: measures, bad: bad };
  }

  /* ---------- transposing and octave fitting ---------- */

  // Move a note by a number of letter steps and semitones, keeping the spelling
  // sensible: up a major 2nd is one letter step and two semitones.
  function transposeNote(note, letterSteps, semitones) {
    var li = T.LETTERS.indexOf(note.letter) + letterSteps;
    var octave = note.octave + Math.floor(li / 7);
    var letter = T.LETTERS[((li % 7) + 7) % 7];
    var target = note.midi + semitones;
    var diff = target - T.midiOf(letter, '', octave);
    var acc = diff === 0 ? '' : diff === 1 ? '#' : diff === -1 ? 'b' : null;
    if (acc === null) return T.makeNote(note.letter, note.acc, note.octave + Math.round(semitones / 12));
    return T.makeNote(letter, acc, octave);
  }

  function mapNotes(measures, fn) {
    measures.forEach(function (items) {
      items.forEach(function (item) {
        if (item.note) item.note = fn(item.note);
      });
    });
  }

  function extent(measures) {
    var low = Infinity, high = -Infinity;
    measures.forEach(function (items) {
      items.forEach(function (item) {
        if (!item.note) return;
        low = Math.min(low, item.note.midi);
        high = Math.max(high, item.note.midi);
      });
    });
    return { low: low, high: high };
  }

  // Shift the whole tune by octaves so that it sits inside the playable range,
  // and — among the octaves that fit — where it reads best: centred on the
  // staff rather than hanging off the bottom on ledger lines.
  function octaveShift(measures, range) {
    var e = extent(measures);
    if (!isFinite(e.low)) return 0;
    var middle = (range.low + range.high) / 2;
    var best = 0, bestCost = Infinity;
    for (var shift = -3; shift <= 3; shift++) {
      var low = e.low + shift * 12;
      var high = e.high + shift * 12;
      var outside = Math.max(0, range.low - low) + Math.max(0, high - range.high);
      var offCentre = Math.abs((low + high) / 2 - middle);
      var cost = outside * 5 + offCentre + Math.abs(shift) * 0.5;
      if (cost < bestCost) { bestCost = cost; best = shift; }
    }
    if (best !== 0) {
      mapNotes(measures, function (n) { return T.makeNote(n.letter, n.acc, n.octave + best); });
    }
    return best;
  }

  /* ---------- building an exercise ---------- */

  var KEY_BY_PC = { 0: 'C', 2: 'D', 3: 'Eb', 5: 'F', 7: 'G', 9: 'A', 10: 'Bb' };

  function transposeKeyUpMajorSecond(keyName) {
    var tonicLetter = T.KEYS[keyName].tonic;
    var tonicAcc = T.KEYS[keyName].map[tonicLetter];
    var pc = (T.midiOf(tonicLetter, tonicAcc, 4) + 2) % 12;
    return KEY_BY_PC[pc] || keyName;
  }

  /** Turn a tune into the same shape generator.generate() produces. */
  function buildExercise(tune, settings) {
    var parsed = parseMusic(tune.music);
    var measures = parsed.measures;
    var instrument = settings.instrument;
    var inst = T.INSTRUMENTS[instrument];

    // Tunes are a single melody line, so the grand staff falls back to treble,
    // and an instrument that reads alto clef gets them in alto clef.
    var clef = inst.clefs.indexOf('alto') !== -1 ? 'alto'
      : (instrument === 'piano' && settings.clef === 'bass') ? 'bass' : 'treble';
    var keyName = tune.key;

    // A transposing instrument reads a different key from the one that sounds.
    if (inst.writtenShift) {
      mapNotes(measures, function (n) {
        return transposeNote(n, inst.writtenShift.letters, inst.writtenShift.semitones);
      });
      keyName = transposeKeyUpMajorSecond(tune.key);
    }

    var range = (instrument === 'piano' && clef === 'bass')
      ? T.bassRangeFor('piano', settings.level)
      : T.rangeFor(instrument, settings.level, clef);
    octaveShift(measures, range);

    var parts = tune.time.split('/');
    var timeSig = { num: parseInt(parts[0], 10), den: parseInt(parts[1], 10) };
    var beatsPerBar = timeSig.num * (4 / timeSig.den);

    var cursor = 0;
    measures.forEach(function (items, barIndex) {
      items.forEach(function (item) {
        item.startBeat = cursor;
        item.bar = barIndex;
        cursor += item.beats;
      });
    });

    return {
      instrument: instrument,
      level: settings.level,
      clef: clef,
      key: keyName,
      keySpec: T.KEYS[keyName] ? T.KEYS[keyName].spec : 'C',
      keyLabel: T.KEYS[keyName] ? T.KEYS[keyName].label : keyName,
      timeSig: timeSig,
      beatsPerBar: beatsPerBar,
      bars: measures.length,
      totalBeats: cursor,
      voices: [{ clef: clef, measures: measures }],
      transpose: T.INSTRUMENTS[instrument].transpose,
      timbre: T.INSTRUMENTS[instrument].timbre,
      tune: { id: tune.id, title: tune.title, by: tune.by, blurb: tune.blurb, level: tune.level }
    };
  }

  /** A tune at or below the current level, preferring one he has not just had. */
  function pick(settings, lastId) {
    var eligible = TUNES.filter(function (t) { return t.level <= settings.level; });
    if (!eligible.length) eligible = TUNES.slice();
    var fresh = eligible.filter(function (t) { return t.id !== lastId; });
    var pool = fresh.length ? fresh : eligible;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function countFor(level) {
    return TUNES.filter(function (t) { return t.level <= level; }).length;
  }

  /** Checks every bar adds up — catches typos in the library at load time. */
  function validate() {
    var problems = [];
    TUNES.forEach(function (tune) {
      var parsed = parseMusic(tune.music);
      if (parsed.bad.length) problems.push(tune.id + ': unreadable "' + parsed.bad.join('", "') + '"');
      var parts = tune.time.split('/');
      var perBar = parseInt(parts[0], 10) * (4 / parseInt(parts[1], 10));
      parsed.measures.forEach(function (items, i) {
        var sum = items.reduce(function (s, it) { return s + it.beats; }, 0);
        var pickup = (i === 0 && sum < perBar);          // anacrusis is allowed
        if (!pickup && Math.abs(sum - perBar) > 0.001) {
          problems.push(tune.id + ': bar ' + (i + 1) + ' has ' + sum + ' beats, expected ' + perBar);
        }
      });
    });
    return problems;
  }

  SR.tunes = {
    all: TUNES,
    pick: pick,
    buildExercise: buildExercise,
    countFor: countFor,
    validate: validate,
    parseMusic: parseMusic
  };
})(window);
