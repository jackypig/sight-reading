/* notation.js — draws exercises with VexFlow and reports note positions
 * so the practice view can slide a highlight across the music.
 */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var VF = null;

  function flow() {
    if (!VF) {
      if (!global.Vex || !global.Vex.Flow) throw new Error('VexFlow failed to load (vendor/vexflow.js)');
      VF = global.Vex.Flow;
    }
    return VF;
  }

  function restKeyFor(clef) { return clef === 'bass' ? 'd/3' : 'b/4'; }

  function buildStaveNotes(measureItems, clef) {
    var F = flow();
    return measureItems.map(function (item) {
      var isRest = item.rest || !item.note;
      var duration = item.durCode + (item.dots ? 'd' : '') + (isRest ? 'r' : '');
      var note = new F.StaveNote({
        keys: [isRest ? restKeyFor(clef) : item.note.vexKey],
        duration: duration,
        clef: clef,
        auto_stem: true
      });
      if (item.dots) F.Dot.buildAndAttach([note], { all: true });
      item._vf = note;
      return note;
    });
  }

  function pickScale(width) {
    if (width >= 1000) return 1.7;
    if (width >= 800) return 1.5;
    if (width >= 620) return 1.3;
    if (width >= 460) return 1.1;
    return 0.95;
  }

  /**
   * Draw a whole exercise.
   * Returns {layout: [{startBeat, beats, x, y, h, width}], width, height, scale}
   */
  function renderExercise(container, ex, opts) {
    var F = flow();
    opts = opts || {};
    container.innerHTML = '';

    var cssWidth = Math.max(300, container.clientWidth || 700);
    var scale = opts.scale || pickScale(cssWidth);
    var logicalWidth = cssWidth / scale;

    var grand = ex.voices.length > 1;
    var perLine;
    if (logicalWidth >= 600) perLine = 4;
    else if (logicalWidth >= 360) perLine = 2;
    else perLine = 1;
    perLine = Math.min(perLine, ex.bars);
    if (grand) perLine = Math.min(perLine, logicalWidth >= 600 ? 2 : 1);

    var lines = [];
    for (var b = 0; b < ex.bars; b += perLine) {
      lines.push({ from: b, to: Math.min(b + perLine, ex.bars) });
    }

    var leftPad = 8;
    var staffGap = grand ? 100 : 0;
    var lineHeight = grand ? 190 : 125;
    var logicalHeight = lines.length * lineHeight + 25;

    var renderer = new F.Renderer(container, F.Renderer.Backends.SVG);
    renderer.resize(Math.round(cssWidth), Math.round(logicalHeight * scale));
    var ctx = renderer.getContext();
    ctx.scale(scale, scale);
    ctx.setFont('Arial', 10);

    // Pass 1: build the music for every measure and ask VexFlow how much room
    // it wants, so that busy measures get more width than a bar of whole notes.
    var built = [];
    for (var m = 0; m < ex.bars; m++) {
      var vfVoices = [];
      var beamSets = [];
      ex.voices.forEach(function (voice) {
        var notes = buildStaveNotes(voice.measures[m], voice.clef);
        var v = new F.Voice({ num_beats: ex.timeSig.num, beat_value: ex.timeSig.den }).setStrict(false);
        v.addTickables(notes);
        vfVoices.push(v);
        beamSets.push(F.Beam.generateBeams(notes));
      });
      try { F.Accidental.applyAccidentals(vfVoices, ex.keySpec); } catch (e) { /* non-fatal */ }
      var minWidth = 120;
      try {
        var pre = new F.Formatter();
        pre.joinVoices(vfVoices);
        minWidth = pre.preCalculateMinTotalWidth(vfVoices) + 25;
      } catch (e) { /* fall back to the default */ }
      built.push({ voices: vfVoices, beams: beamSets, minWidth: Math.max(90, minWidth) });
    }

    var layout = [];
    var firstMeasureOverall = true;

    lines.forEach(function (line, li) {
      var yTop = 38 + li * lineHeight;
      var avail = logicalWidth - leftPad * 2;
      // The first measure of a line carries the clef (and key signature).
      var extra = 54 + (ex.keySpec !== 'C' ? 28 : 0) + (firstMeasureOverall ? 30 : 0);
      var mins = 0;
      for (var q = line.from; q < line.to; q++) mins += built[q].minWidth;
      var spare = Math.max(line.to - line.from, avail - extra);
      var x = leftPad;

      for (var m2 = line.from; m2 < line.to; m2++) {
        var isLineStart = (m2 === line.from);
        var width = (built[m2].minWidth / mins) * spare + (isLineStart ? extra : 0);
        var stavePair = [];

        ex.voices.forEach(function (voice, vi) {
          var y = yTop + vi * staffGap;
          var stave = new F.Stave(x, y, width);
          if (isLineStart) {
            stave.addClef(voice.clef);
            if (ex.keySpec !== 'C') stave.addKeySignature(ex.keySpec);
            if (firstMeasureOverall) stave.addTimeSignature(ex.timeSig.num + '/' + ex.timeSig.den);
          }
          if (m2 === ex.bars - 1) stave.setEndBarType(F.Barline.type.END);
          stave.setContext(ctx).draw();
          stavePair.push(stave);
        });

        if (grand && isLineStart) {
          new F.StaveConnector(stavePair[0], stavePair[1])
            .setType(F.StaveConnector.type.BRACE).setContext(ctx).draw();
          new F.StaveConnector(stavePair[0], stavePair[1])
            .setType(F.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        }
        if (grand) {
          new F.StaveConnector(stavePair[0], stavePair[1])
            .setType(m2 === ex.bars - 1 ? F.StaveConnector.type.BOLD_DOUBLE_RIGHT : F.StaveConnector.type.SINGLE_RIGHT)
            .setContext(ctx).draw();
        }

        var pack = built[m2];
        var noteStart = stavePair[0].getNoteStartX() - stavePair[0].getX();
        new F.Formatter().joinVoices(pack.voices)
          .format(pack.voices, Math.max(60, width - noteStart - 16));

        pack.voices.forEach(function (v, vi) { v.draw(ctx, stavePair[vi]); });
        pack.beams.forEach(function (beams) {
          beams.forEach(function (beam) { beam.setContext(ctx).draw(); });
        });

        // Record positions for the moving highlight (top staff only).
        ex.voices[0].measures[m2].forEach(function (item) {
          if (!item._vf) return;
          layout.push({
            startBeat: item.startBeat,
            beats: item.beats,
            // A Stave's y is the top of the space above the lines; the lines
            // themselves start 40 lower, so the highlight is offset to match.
            x: item._vf.getAbsoluteX() * scale,
            y: (yTop + 14) * scale,
            h: ((grand ? staffGap + 92 : 92)) * scale,
            width: Math.max(14, item.beats * 26) * scale
          });
        });

        x += width;
        firstMeasureOverall = false;
      }
    });

    layout.sort(function (a, b) { return a.startBeat - b.startBeat; });
    return { layout: layout, width: cssWidth, height: logicalHeight * scale, scale: scale };
  }

  /** Draw one big note for the recognition drill. */
  function renderSingleNote(container, q, opts) {
    var F = flow();
    opts = opts || {};
    container.innerHTML = '';
    var cssWidth = Math.max(260, Math.min(container.clientWidth || 360, 460));
    var scale = opts.scale || (cssWidth >= 400 ? 2.0 : 1.7);
    var logicalWidth = cssWidth / scale;
    var logicalHeight = 138;   // room for ledger lines above and below

    var renderer = new F.Renderer(container, F.Renderer.Backends.SVG);
    renderer.resize(Math.round(cssWidth), Math.round(logicalHeight * scale));
    var ctx = renderer.getContext();
    ctx.scale(scale, scale);

    var stave = new F.Stave(4, 18, logicalWidth - 10);
    stave.addClef(q.clef);
    if (q.keySpec && q.keySpec !== 'C') stave.addKeySignature(q.keySpec);
    stave.setContext(ctx).draw();

    var note = new F.StaveNote({ keys: [q.note.vexKey], duration: 'q', clef: q.clef, auto_stem: true });
    var voice = new F.Voice({ num_beats: 1, beat_value: 4 }).setStrict(false);
    voice.addTickables([note]);
    try { F.Accidental.applyAccidentals([voice], q.keySpec || 'C'); } catch (e) { /* non-fatal */ }
    new F.Formatter().joinVoices([voice]).format([voice], Math.max(40, logicalWidth - 90));
    voice.draw(ctx, stave);
  }

  /** Flatten an exercise into playable events (concert pitch). */
  function playbackEvents(ex) {
    var events = [];
    ex.voices.forEach(function (voice, vi) {
      voice.measures.forEach(function (items) {
        items.forEach(function (item) {
          if (item.rest || !item.note) return;
          events.push({
            midi: item.note.midi + (ex.transpose || 0),
            startBeat: item.startBeat,
            beats: item.beats,
            voice: vi
          });
        });
      });
    });
    events.sort(function (a, b) { return a.startBeat - b.startBeat; });
    return events;
  }

  SR.notation = {
    renderExercise: renderExercise,
    renderSingleNote: renderSingleNote,
    playbackEvents: playbackEvents,
    isReady: function () { return !!(global.Vex && global.Vex.Flow); }
  };
})(window);
