/* pitch.js — optional microphone listening for the Read screen.
 *
 * Monophonic pitch detection using McLeod's normalised square difference
 * function (the NSDF behind the "MPM" algorithm). It is autocorrelation
 * scaled into -1..1 so that peaks from different lags can be compared
 * directly, which is what makes the octave decisions below possible.
 *
 * Two instrument-specific problems shape this code:
 *
 *   - A clarinet is nearly all odd harmonics, and the 3rd harmonic — the
 *     twelfth the instrument overblows — is often as strong as the
 *     fundamental. Plain autocorrelation locks onto that shorter period and
 *     reports a note a twelfth too high. So after the first strong peak is
 *     chosen, the longer periods (x2, x3) are tested and the detector only
 *     moves down when a longer period genuinely explains the waveform better.
 *   - Piano notes are slightly inharmonic and decay quickly, so voicing has
 *     to be judged on peak clarity rather than loudness alone.
 *
 * Plain browser script, no modules and no dependencies: window.SR.pitch.
 */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  var DEFAULTS = {
    fmin: 70,            // a little under C2 on a piano
    fmax: 1400,          // a little over the top note the app ever writes
    k: 0.9,              // MPM: accept the first peak within this of the best
    octaveMargin: 0.04,  // a longer period must beat the short one by this much
    clarityMin: 0.70,    // below this the frame counts as "nothing musical"
    rmsMin: 0.0025,      // below this the room is simply quiet
    searchHeadroom: 3,   // also look this far above fmax, to spot clicks
    intervalMs: 55,      // how often the live loop analyses a frame
    smoothing: 5         // frames kept for the median shown on screen
  };

  /* ============================ maths ============================ */

  var work = null;      // DC-removed copy of the analysis window
  var nsdf = null;      // normalised square difference, indexed by lag

  function scratch(name, size) {
    if (name === 'work') {
      if (!work || work.length < size) work = new Float32Array(size);
      return work;
    }
    if (!nsdf || nsdf.length < size) nsdf = new Float32Array(size);
    return nsdf;
  }

  function midiFromFreq(freq) { return 69 + 12 * Math.log(freq / 440) / Math.LN2; }
  function freqFromMidi(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  var NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  function noteLabel(midi) {
    if (midi === null || midi === undefined || !isFinite(midi)) return '—';
    var m = Math.round(midi);
    return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  function withDefaults(options) {
    var o = {};
    Object.keys(DEFAULTS).forEach(function (key) { o[key] = DEFAULTS[key]; });
    if (options) Object.keys(options).forEach(function (key) {
      if (options[key] !== undefined && options[key] !== null) o[key] = options[key];
    });
    if (o.fmax <= o.fmin * 1.2) o.fmax = o.fmin * 1.2;
    return o;
  }

  function blank(rms) {
    return {
      voiced: false, frequency: 0, midi: null, midiExact: null,
      cents: 0, clarity: 0, confidence: 0, rms: rms || 0, name: '—'
    };
  }

  /**
   * Detect the pitch of one buffer of samples.
   * Returns {voiced, frequency, midi, midiExact, cents, clarity, confidence, rms, name}.
   * `voiced` is false when the frame is too quiet or too noisy to call.
   */
  function detect(samples, sampleRate, options) {
    var o = withDefaults(options);
    var n = samples.length;
    if (!n || !sampleRate) return blank(0);

    // Pitches are only reported inside [fmin, fmax], but the search goes
    // higher: if the frame is better explained by something above the
    // instrument's range — a metronome click, a squeak, a tapped key — then the
    // right answer is "that was not a note", not its subharmonic.
    var reportMinLag = Math.max(2, Math.floor(sampleRate / o.fmax));
    var minLag = Math.max(2, Math.floor(sampleRate / (o.fmax * o.searchHeadroom)));
    var maxLag = Math.min(Math.ceil(sampleRate / o.fmin) + 1, Math.floor(n / 2));
    if (maxLag < reportMinLag + 3) return blank(0);

    // Four periods of the lowest note we look for is plenty of evidence, and
    // keeping the window no longer than that keeps the cost down on a tablet.
    var W = Math.min(n, 4 * maxLag);

    var i, sum = 0;
    for (i = 0; i < W; i++) sum += samples[i];
    var mean = sum / W;

    var x = scratch('work', W);
    var energy = 0;
    for (i = 0; i < W; i++) {
      var v = samples[i] - mean;
      x[i] = v;
      energy += v * v;
    }
    var rms = Math.sqrt(energy / W);
    if (rms < o.rmsMin) return blank(rms);

    var d = scratch('nsdf', maxLag + 2);
    var lag, j, count;
    for (lag = minLag; lag <= maxLag; lag++) {
      var ac = 0, sq = 0;
      count = W - lag;
      for (j = 0; j < count; j++) {
        var a = x[j], b = x[j + lag];
        ac += a * b;
        sq += a * a + b * b;
      }
      d[lag] = sq > 0 ? (2 * ac) / sq : 0;
    }

    // Every local maximum is a period the waveform might have, refined to
    // sub-sample precision so the cents reading is usable.
    var peaks = [];
    for (lag = minLag + 1; lag < maxLag; lag++) {
      if (d[lag] <= 0) continue;
      if (d[lag] > d[lag - 1] && d[lag] >= d[lag + 1]) {
        peaks.push({ lag: refine(d, lag), value: d[lag], index: lag });
      }
    }
    if (!peaks.length) return blank(rms);

    var best = peaks[0];
    for (i = 1; i < peaks.length; i++) if (peaks[i].value > best.value) best = peaks[i];

    // MPM: the shortest period that is nearly as good as the best one. This is
    // what keeps a strong 2nd harmonic from halving the pitch.
    var threshold = o.k * best.value;
    var chosen = best;
    for (i = 0; i < peaks.length; i++) {
      if (peaks[i].value >= threshold) { chosen = peaks[i]; break; }
    }

    // ...and the other half of the problem: a clarinet's 3rd harmonic can look
    // like the real period. Only accept a longer period when it fits the
    // waveform strictly better, so a genuine note is never dragged an octave
    // down.
    for (var round = 0; round < 2; round++) {
      var improved = null;
      for (var mult = 2; mult <= 3; mult++) {
        var target = chosen.lag * mult;
        if (target > maxLag) break;
        var cand = peakNear(peaks, target, 0.05);
        if (cand && cand.value > chosen.value + o.octaveMargin &&
            (!improved || cand.value > improved.value)) improved = cand;
      }
      if (!improved) break;
      chosen = improved;
    }

    // The best explanation is above the range we were asked about, so this
    // frame is noise of some kind rather than a note he played.
    if (chosen.lag < reportMinLag) return blank(rms);

    var frequency = sampleRate / chosen.lag;
    if (!isFinite(frequency) || frequency <= 0) return blank(rms);

    var clarity = Math.max(0, Math.min(1, chosen.value));
    var exact = midiFromFreq(frequency);
    var nearest = Math.round(exact);
    var confidence = Math.max(0, Math.min(1, (clarity - 0.45) / 0.45)) *
      Math.max(0.3, Math.min(1, rms / 0.02));

    return {
      voiced: clarity >= o.clarityMin,
      frequency: frequency,
      midi: nearest,
      midiExact: exact,
      cents: Math.round((exact - nearest) * 100),
      clarity: clarity,
      confidence: confidence,
      rms: rms,
      name: noteLabel(nearest)
    };
  }

  // Parabolic interpolation through a peak and its neighbours.
  function refine(d, lag) {
    var y1 = d[lag - 1], y2 = d[lag], y3 = d[lag + 1];
    var denom = y1 - 2 * y2 + y3;
    if (!denom) return lag;
    var delta = 0.5 * (y1 - y3) / denom;
    if (!isFinite(delta) || Math.abs(delta) > 1) return lag;
    return lag + delta;
  }

  function peakNear(peaks, target, tolerance) {
    var out = null;
    var window = target * tolerance;
    for (var i = 0; i < peaks.length; i++) {
      if (Math.abs(peaks[i].lag - target) <= window) {
        if (!out || peaks[i].value > out.value) out = peaks[i];
      }
    }
    return out;
  }

  /* ============================ capture ============================ */

  var session = null;

  function isSupported() {
    return !!(global.navigator && global.navigator.mediaDevices &&
      global.navigator.mediaDevices.getUserMedia &&
      (global.AudioContext || global.webkitAudioContext));
  }

  /** Why listening cannot work here at all, or null when it should. */
  function unavailableReason() {
    if (!isSupported()) {
      return {
        code: 'unsupported',
        message: 'This browser cannot listen through the microphone.'
      };
    }
    if (global.isSecureContext === false) {
      return {
        code: 'insecure',
        message: 'Browsers only allow the microphone on https:// or on localhost. ' +
          'Open the app on this computer, or serve it with serve.ps1 -Https.'
      };
    }
    return null;
  }

  function friendlyError(err) {
    var name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return {
        code: 'denied',
        message: 'The microphone is blocked. Allow it for this page in the ' +
          'browser’s address bar, then try again.'
      };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return { code: 'no-device', message: 'No microphone found on this device.' };
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return { code: 'busy', message: 'Something else is using the microphone.' };
    }
    return { code: 'failed', message: 'The microphone could not start' + (err && err.message ? ': ' + err.message : '.') };
  }

  function audioContext() {
    if (SR.audio && SR.audio.context) {
      var shared = SR.audio.context();
      if (shared) return shared;
    }
    var AC = global.AudioContext || global.webkitAudioContext;
    return AC ? new AC() : null;
  }

  /**
   * Start listening. Resolves once pitch frames are flowing.
   * opts: {onResult(result), onError(err), fmin, fmax, intervalMs, smoothing}
   * Rejects with {code, message} — never with a raw DOM exception.
   */
  function start(opts) {
    opts = opts || {};
    if (session) { stop(); }

    var reason = unavailableReason();
    if (reason) return Promise.reject(reason);

    var ctx = audioContext();
    if (!ctx) return Promise.reject({ code: 'unsupported', message: 'This browser has no Web Audio.' });

    var constraints = {
      audio: {
        echoCancellation: false,   // all three would fight the pitch detector
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      },
      video: false
    };

    return global.navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();

      var source = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;         // 4096 time-domain samples to work with
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);        // deliberately not connected to output

      var buffer = new Float32Array(analyser.fftSize);
      var options = {
        fmin: opts.fmin, fmax: opts.fmax,
        clarityMin: opts.clarityMin, rmsMin: opts.rmsMin
      };
      var recent = [];
      var smoothing = opts.smoothing || DEFAULTS.smoothing;

      var interval = opts.intervalMs || DEFAULTS.intervalMs;
      var live = {
        stream: stream, source: source, analyser: analyser,
        timer: null, options: options, onResult: opts.onResult, onError: opts.onError,
        // How far behind the moment a frame describes: the middle of the
        // analysis window, plus half the gap between frames.
        lagSec: (analyser.fftSize / 2) / ctx.sampleRate + interval / 2000
      };

      function tick() {
        if (!session || session !== live) return;
        var result;
        try {
          analyser.getFloatTimeDomainData(buffer);
          result = detect(buffer, ctx.sampleRate, live.options);
        } catch (err) {
          // A failure here must never take the practice screen with it.
          stop();
          if (live.onError) live.onError({ code: 'failed', message: 'Listening stopped: ' + err.message });
          return;
        }

        // A short median filter: steadier on screen, and it shrugs off the
        // odd frame that lands on a key click or a chair creak.
        recent.push(result.voiced ? result.midi : null);
        if (recent.length > smoothing) recent.shift();
        var voicedRecent = recent.filter(function (m) { return m !== null; }).sort(function (a, b) { return a - b; });
        result.steadyMidi = voicedRecent.length >= Math.min(3, smoothing)
          ? voicedRecent[Math.floor(voicedRecent.length / 2)]
          : null;
        result.steadyName = result.steadyMidi === null ? '—' : noteLabel(result.steadyMidi);

        if (live.onResult) live.onResult(result);
      }

      stream.getAudioTracks().forEach(function (track) {
        track.addEventListener('ended', function () {
          if (session !== live) return;
          stop();
          if (live.onError) live.onError({ code: 'lost', message: 'The microphone was disconnected.' });
        });
      });

      live.timer = global.setInterval(tick, interval);
      session = live;
      return true;
    }, function (err) {
      throw friendlyError(err);
    });
  }

  function stop() {
    if (!session) return;
    var live = session;
    session = null;
    if (live.timer) global.clearInterval(live.timer);
    try { live.source.disconnect(); } catch (e) { /* already gone */ }
    try {
      live.stream.getTracks().forEach(function (track) { track.stop(); });
    } catch (e) { /* already gone */ }
  }

  /** Narrow the search to the notes an exercise can actually contain. */
  function setRange(fmin, fmax) {
    if (!session) return;
    if (fmin) session.options.fmin = fmin;
    if (fmax) session.options.fmax = fmax;
  }

  SR.pitch = {
    detect: detect,
    start: start,
    stop: stop,
    setRange: setRange,
    isRunning: function () { return !!session; },
    // Seconds between a sound happening and the frame that describes it.
    lagSeconds: function () { return session ? session.lagSec : 0.1; },
    isSupported: isSupported,
    unavailableReason: unavailableReason,
    midiFromFreq: midiFromFreq,
    freqFromMidi: freqFromMidi,
    noteLabel: noteLabel,
    DEFAULTS: DEFAULTS
  };
})(window);
