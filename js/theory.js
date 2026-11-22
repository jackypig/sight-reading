/* theory.js — notes, keys, ranges and transposition.
 * Plain browser script (no modules) so the app runs straight off the file system.
 * Everything hangs off window.SR.
 */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  // Pitch class of each natural letter.
  var LETTER_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  var LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

  // Major keys we use. `map` is letter -> accidental in that key signature.
  // `spec` is the VexFlow key-signature name.
  var KEYS = {
    C:  { spec: 'C',  label: 'C major',  tonic: 'c',  map: { c: '', d: '', e: '', f: '',  g: '', a: '', b: ''  } },
    G:  { spec: 'G',  label: 'G major',  tonic: 'g',  map: { c: '', d: '', e: '', f: '#', g: '', a: '', b: ''  } },
    D:  { spec: 'D',  label: 'D major',  tonic: 'd',  map: { c: '#', d: '', e: '', f: '#', g: '', a: '', b: '' } },
    A:  { spec: 'A',  label: 'A major',  tonic: 'a',  map: { c: '#', d: '', e: '', f: '#', g: '#', a: '', b: '' } },
    F:  { spec: 'F',  label: 'F major',  tonic: 'f',  map: { c: '', d: '', e: '', f: '',  g: '', a: '', b: 'b' } },
    Bb: { spec: 'Bb', label: 'B♭ major', tonic: 'b',  map: { c: '', d: '', e: 'b', f: '', g: '', a: '', b: 'b' } },
    Eb: { spec: 'Eb', label: 'E♭ major', tonic: 'e',  map: { c: '', d: '', e: 'b', f: '', g: '', a: 'b', b: 'b' } }
  };

  // A minor-key piece carries its relative major's key signature, so a tune can
  // say mode:'minor' and be labelled the way a musician would name it.
  var RELATIVE_MINOR = { C: 'A', G: 'E', D: 'B', A: 'F♯', F: 'D', Bb: 'G', Eb: 'C' };

  function minorLabel(keyName) {
    var tonic = RELATIVE_MINOR[keyName];
    return tonic ? tonic + ' minor' : (KEYS[keyName] ? KEYS[keyName].label : keyName);
  }

  // Display name for a note, e.g. {letter:'f', acc:'#'} -> "F♯"
  function prettyName(letter, acc) {
    return letter.toUpperCase() + (acc === '#' ? '♯' : acc === 'b' ? '♭' : '');
  }

  function midiOf(letter, acc, octave) {
    var pc = LETTER_PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0);
    return 12 * (octave + 1) + pc;
  }

  // Build a note object used everywhere else in the app.
  function makeNote(letter, acc, octave) {
    return {
      letter: letter,
      acc: acc || '',
      octave: octave,
      midi: midiOf(letter, acc, octave),
      // VexFlow key string, e.g. "f#/4"
      vexKey: letter + (acc || '') + '/' + octave,
      name: prettyName(letter, acc)
    };
  }

  // Parse "f#/4" or "F#4" into a note object.
  function parseNote(str) {
    var m = /^([a-gA-G])([#b]?)\/?(-?\d)$/.exec(String(str).trim());
    if (!m) return null;
    return makeNote(m[1].toLowerCase(), m[2], parseInt(m[3], 10));
  }

  // All notes of `key` between two midi values (inclusive), low to high.
  function scaleNotesInRange(keyName, lowMidi, highMidi) {
    var key = KEYS[keyName] || KEYS.C;
    var out = [];
    for (var oct = 0; oct <= 8; oct++) {
      for (var i = 0; i < LETTERS.length; i++) {
        var letter = LETTERS[i];
        var acc = key.map[letter];
        var n = makeNote(letter, acc, oct);
        if (n.midi >= lowMidi && n.midi <= highMidi) out.push(n);
      }
    }
    out.sort(function (a, b) { return a.midi - b.midi; });
    return out;
  }

  // Raise or lower a note by a chromatic semitone, keeping the letter.
  // Returns null when that would need a double accidental.
  function chromaticNeighbour(note, direction) {
    var acc = note.acc;
    if (direction > 0) {
      if (acc === 'b') return makeNote(note.letter, '', note.octave);
      if (acc === '') return makeNote(note.letter, '#', note.octave);
      return null;
    }
    if (acc === '#') return makeNote(note.letter, '', note.octave);
    if (acc === '') return makeNote(note.letter, 'b', note.octave);
    return null;
  }

  /* ---------- instruments ---------- */

  // Written ranges, by instrument + level. Clarinet notation is always treble
  // clef and sounds a major 2nd (2 semitones) lower than written.
  var INSTRUMENTS = {
    clarinet: {
      label: 'Clarinet',
      clefs: ['treble'],
      transpose: -2,           // written -> concert
      timbre: 'clarinet',
      // Written keys that show up in real band music for a Bb instrument.
      keysByLevel: {
        1: ['C', 'F'],
        2: ['C', 'G', 'F'],
        3: ['C', 'G', 'D', 'F'],
        4: ['C', 'G', 'D', 'F', 'Bb'],
        5: ['C', 'G', 'D', 'F', 'Bb', 'A']
      },
      rangeByLevel: {
        1: ['c/4', 'g/5'],
        2: ['a/3', 'a/5'],
        3: ['g/3', 'c/6'],
        4: ['f/3', 'c/6'],
        5: ['e/3', 'c/6']
      },
      // Written pitch is a major 2nd above concert: one letter step, two semitones.
      writtenShift: { letters: 1, semitones: 2 },
      note: 'Written pitch — your clarinet sounds a major 2nd lower.'
    },
    viola: {
      label: 'Viola',
      clefs: ['alto'],
      transpose: 0,
      timbre: 'viola',
      // Strings favour sharp keys; B♭ and E♭ turn up far less than in a band book.
      keysByLevel: {
        1: ['C', 'G'],
        2: ['C', 'G', 'D'],
        3: ['C', 'G', 'D', 'F'],
        4: ['C', 'G', 'D', 'A', 'F'],
        5: ['C', 'G', 'D', 'A', 'F', 'Bb']
      },
      // Open strings are C3, G3, D4 and A4; first position tops out near D5.
      rangeByLevel: {
        1: ['c/4', 'a/4'],
        2: ['g/3', 'a/4'],
        3: ['g/3', 'd/5'],
        4: ['c/3', 'd/5'],
        5: ['c/3', 'a/5']
      },
      note: 'Alto clef — the middle line is middle C. Sounds exactly as written.'
    },
    piano: {
      label: 'Piano',
      clefs: ['treble', 'bass', 'grand'],
      transpose: 0,
      timbre: 'piano',
      keysByLevel: {
        1: ['C', 'F'],
        2: ['C', 'G', 'F'],
        3: ['C', 'G', 'D', 'F'],
        4: ['C', 'G', 'D', 'F', 'Bb'],
        5: ['C', 'G', 'D', 'F', 'Bb', 'Eb']
      },
      rangeByLevel: {
        1: { treble: ['c/4', 'c/5'], bass: ['c/3', 'c/4'], grand: ['c/4', 'c/5'] },
        2: { treble: ['a/3', 'e/5'], bass: ['a/2', 'e/4'], grand: ['c/4', 'e/5'] },
        3: { treble: ['g/3', 'g/5'], bass: ['f/2', 'g/4'], grand: ['c/4', 'g/5'] },
        4: { treble: ['f/3', 'c/6'], bass: ['e/2', 'a/4'], grand: ['c/4', 'c/6'] },
        5: { treble: ['e/3', 'e/6'], bass: ['c/2', 'c/5'], grand: ['c/4', 'e/6'] }
      },
      // For grand staff the bass hand gets its own range.
      bassRangeByLevel: {
        1: ['c/3', 'c/4'],
        2: ['a/2', 'e/4'],
        3: ['f/2', 'g/4'],
        4: ['e/2', 'a/4'],
        5: ['c/2', 'c/5']
      },
      note: 'Sounds exactly as written.'
    }
  };

  // Five steps rather than three, so progress feels steady over months.
  var LEVELS = [
    { n: 1, name: 'Start', blurb: 'whole, half and quarter notes' },
    { n: 2, name: 'Easy', blurb: 'adds dotted halves and a wider range' },
    { n: 3, name: 'Steady', blurb: 'adds eighth notes and two more keys' },
    { n: 4, name: 'Push', blurb: 'adds dotted quarters and B♭' },
    { n: 5, name: 'Challenge', blurb: 'adds sixteenths and the full range' }
  ];

  var MAX_LEVEL = LEVELS.length;

  function rangeFor(instrumentName, level, clef) {
    var inst = INSTRUMENTS[instrumentName];
    var r = inst.rangeByLevel[level];
    if (Array.isArray(r)) return { low: parseNote(r[0]).midi, high: parseNote(r[1]).midi };
    var pair = r[clef] || r.treble;
    return { low: parseNote(pair[0]).midi, high: parseNote(pair[1]).midi };
  }

  function bassRangeFor(instrumentName, level) {
    var inst = INSTRUMENTS[instrumentName];
    var pair = (inst.bassRangeByLevel && inst.bassRangeByLevel[level]) || ['c/3', 'c/4'];
    return { low: parseNote(pair[0]).midi, high: parseNote(pair[1]).midi };
  }

  function keysFor(instrumentName, level) {
    return INSTRUMENTS[instrumentName].keysByLevel[level].slice();
  }

  /* ---------- rhythm vocabularies ---------- */

  // Durations are {code, beats} where beats are quarter notes.
  // `code` is a VexFlow duration string; "d" suffix means dotted.
  // `code` is the plain VexFlow duration; the renderer appends the dot itself,
  // so it must not be carried here as well.
  var DUR = {
    w:   { code: 'w',  beats: 4,   dots: 0 },
    hd:  { code: 'h',  beats: 3,   dots: 1 },
    h:   { code: 'h',  beats: 2,   dots: 0 },
    qd:  { code: 'q',  beats: 1.5, dots: 1 },
    q:   { code: 'q',  beats: 1,   dots: 0 },
    e:   { code: '8',  beats: 0.5, dots: 0 },
    s:   { code: '16', beats: 0.25, dots: 0 }
  };

  var RHYTHM_LEVELS = {
    1: ['w', 'h', 'q'],
    2: ['w', 'hd', 'h', 'q'],
    3: ['w', 'hd', 'h', 'q', 'e'],
    4: ['hd', 'h', 'qd', 'q', 'e'],
    5: ['hd', 'h', 'qd', 'q', 'e', 's']
  };

  // One line under the level buttons, so it is obvious what each step means.
  function describeLevel(instrumentName, level, clef) {
    var lv = LEVELS[Math.max(0, Math.min(MAX_LEVEL - 1, level - 1))];
    var r = instrumentName === 'piano' && clef === 'bass'
      ? bassRangeFor('piano', level)
      : rangeFor(instrumentName, level, clef);
    return lv.name + ' — ' + SR.theory.midiToName(r.low) + '–' + SR.theory.midiToName(r.high) +
      ', keys ' + keysFor(instrumentName, level).map(function (k) {
        return KEYS[k].label.replace(' major', '');
      }).join(' ') + ', ' + lv.blurb + '.';
  }

  SR.theory = {
    KEYS: KEYS,
    LETTERS: LETTERS,
    LETTER_PC: LETTER_PC,
    INSTRUMENTS: INSTRUMENTS,
    LEVELS: LEVELS,
    MAX_LEVEL: MAX_LEVEL,
    describeLevel: describeLevel,
    DUR: DUR,
    RHYTHM_LEVELS: RHYTHM_LEVELS,
    RELATIVE_MINOR: RELATIVE_MINOR,
    minorLabel: minorLabel,
    makeNote: makeNote,
    parseNote: parseNote,
    prettyName: prettyName,
    midiOf: midiOf,
    scaleNotesInRange: scaleNotesInRange,
    chromaticNeighbour: chromaticNeighbour,
    rangeFor: rangeFor,
    bassRangeFor: bassRangeFor,
    keysFor: keysFor,
    midiToName: function (midi) {
      var sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
      return sharpNames[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    }
  };
})(window);
