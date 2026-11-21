/* audio.js — Web Audio metronome and a small synth for clarinet/piano playback,
 * plus a transport that schedules a whole exercise and reports the beat position.
 */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  var ctx = null;
  var master = null;
  var volume = 0.7;
  var live = [];   // nodes still sounding, so we can cut them off

  function ensure() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  }

  function midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  function track(nodes) {
    live.push(nodes);
    if (live.length > 400) live.splice(0, 200);
  }

  function click(time, strong) {
    if (!ensure()) return;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = strong ? 1760 : 1200;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(strong ? 0.45 : 0.26, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, time + 0.055);
    osc.connect(g);
    g.connect(master);
    osc.start(time);
    osc.stop(time + 0.08);
    track([osc, g]);
  }

  function playNote(midi, time, durSec, timbre) {
    if (!ensure()) return;
    var freq = midiToHz(midi);
    var out = ctx.createGain();
    out.connect(master);

    if (timbre === 'clarinet') {
      // Hollow, mostly odd harmonics: square through a gentle low-pass.
      var osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      var filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = Math.min(4200, freq * 6 + 600);
      filt.Q.value = 0.6;
      var breath = ctx.createOscillator();      // slow vibrato
      var breathGain = ctx.createGain();
      breath.frequency.value = 5.2;
      breathGain.gain.value = freq * 0.004;
      breath.connect(breathGain);
      breathGain.connect(osc.frequency);

      var hold = Math.max(0.12, durSec * 0.92);
      out.gain.setValueAtTime(0, time);
      out.gain.linearRampToValueAtTime(0.26, time + 0.035);
      out.gain.setValueAtTime(0.26, time + hold);
      out.gain.exponentialRampToValueAtTime(0.0008, time + hold + 0.08);

      osc.connect(filt);
      filt.connect(out);
      osc.start(time);
      breath.start(time);
      osc.stop(time + hold + 0.12);
      breath.stop(time + hold + 0.12);
      track([osc, breath, out]);
    } else {
      // Piano-ish: triangle body + soft octave, exponential decay.
      var body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.value = freq;
      var upper = ctx.createOscillator();
      upper.type = 'sine';
      upper.frequency.value = freq * 2;
      var upperGain = ctx.createGain();
      upperGain.gain.value = 0.22;

      var decay = Math.max(0.6, Math.min(2.6, durSec * 1.25));
      out.gain.setValueAtTime(0, time);
      out.gain.linearRampToValueAtTime(0.34, time + 0.008);
      out.gain.exponentialRampToValueAtTime(0.0008, time + decay);

      body.connect(out);
      upper.connect(upperGain);
      upperGain.connect(out);
      body.start(time);
      upper.start(time);
      body.stop(time + decay + 0.05);
      upper.stop(time + decay + 0.05);
      track([body, upper, out, upperGain]);
    }
  }

  function stopAll() {
    if (!ctx) return;
    var t = ctx.currentTime;
    live.forEach(function (nodes) {
      nodes.forEach(function (n) {
        try {
          if (n.gain) { n.gain.cancelScheduledValues(t); n.gain.setTargetAtTime(0, t, 0.01); }
          else if (n.stop) n.stop(t + 0.05);
        } catch (e) { /* already stopped */ }
      });
    });
    live = [];
  }

  /**
   * Schedule a run-through.
   * opts: {tempo, beatsPerBar, totalBeats, countInBars, events, clickMode, timbre,
   *        playNotes, onTick(beat), onEnd()}
   * clickMode: 'all' | 'countin' | 'off'
   */
  function startTransport(opts) {
    if (!ensure()) return null;
    var spb = 60 / opts.tempo;                     // seconds per beat
    var countBeats = (opts.countInBars || 0) * opts.beatsPerBar;
    var startClick = ctx.currentTime + 0.15;       // count-in starts here
    var t0 = startClick + countBeats * spb;        // bar 1, beat 1 lands here
    var totalBeats = opts.totalBeats;
    var i;

    if (opts.clickMode !== 'off') {
      for (i = 0; i < countBeats; i++) {
        click(startClick + i * spb, i % opts.beatsPerBar === 0);
      }
      if (opts.clickMode === 'all') {
        for (i = 0; i < totalBeats; i++) click(t0 + i * spb, i % opts.beatsPerBar === 0);
      }
    }

    if (opts.playNotes) {
      (opts.events || []).forEach(function (ev) {
        playNote(ev.midi, t0 + ev.startBeat * spb, ev.beats * spb, opts.timbre);
      });
    }

    var stopped = false;
    var raf = null;
    function frame() {
      if (stopped) return;
      var beat = (ctx.currentTime - t0) / spb;
      if (opts.onTick) opts.onTick(beat, -countBeats);
      if (beat >= totalBeats + 0.4) {
        stopped = true;
        if (opts.onEnd) opts.onEnd();
        return;
      }
      raf = global.requestAnimationFrame(frame);
    }
    raf = global.requestAnimationFrame(frame);

    return {
      stop: function () {
        if (stopped) return;
        stopped = true;
        if (raf) global.cancelAnimationFrame(raf);
        stopAll();
      },
      // The beat right now, straight off the audio clock. onTick only fires as
      // often as requestAnimationFrame does, which the browser throttles when
      // the page is not in front, so anything that has to know where the beat
      // is — the microphone, for one — should ask here instead.
      beatNow: function () { return (ctx.currentTime - t0) / spb; },
      isRunning: function () { return !stopped; },
      durationSec: (countBeats + totalBeats) * spb
    };
  }

  /** Plain metronome that keeps clicking until stopped. */
  function startMetronome(tempo, beatsPerBar) {
    if (!ensure()) return null;
    var spb = 60 / tempo;
    var beat = 0;
    var next = ctx.currentTime + 0.15;
    var timer = global.setInterval(function () {
      while (next < ctx.currentTime + 0.3) {
        click(next, beat % beatsPerBar === 0);
        next += spb;
        beat++;
      }
    }, 60);
    return {
      stop: function () { global.clearInterval(timer); stopAll(); },
      isRunning: function () { return true; }
    };
  }

  SR.audio = {
    ensure: ensure,
    setVolume: setVolume,
    getVolume: function () { return volume; },
    click: click,
    playNote: playNote,
    stopAll: stopAll,
    startTransport: startTransport,
    startMetronome: startMetronome,
    now: function () { return ctx ? ctx.currentTime : 0; },
    // The microphone shares this context so the app only ever has one.
    context: function () { return ensure(); },
    available: function () { return !!(global.AudioContext || global.webkitAudioContext); }
  };
})(window);
