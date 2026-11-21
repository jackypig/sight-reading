/* storage.js — progress + settings in localStorage.
 * Every read and write is wrapped: on a locked-down browser the app still runs,
 * it just forgets between sessions.
 */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var KEY = 'sightReading.v1';

  function blank() {
    return {
      v: 1,
      days: {},
      practice: { exercises: 0, byKey: {} },
      drill: { byNote: {}, byKey: {}, byClef: {}, rounds: 0, best: { streak: 0, roundPct: 0, fastestMs: null } },
      settings: null
    };
  }

  var data = blank();
  var ok = true;

  function read() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1) data = Object.assign(blank(), parsed);
      }
    } catch (e) { ok = false; }
  }

  var saveTimer = null;
  function save() {
    if (!ok) return;
    if (saveTimer) global.clearTimeout(saveTimer);
    saveTimer = global.setTimeout(function () {
      try { global.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { ok = false; }
    }, 250);
  }

  function dayKey(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function today() {
    var k = dayKey();
    if (!data.days[k]) data.days[k] = { seconds: 0, exercises: 0, drillQ: 0, drillCorrect: 0 };
    return data.days[k];
  }

  function addSeconds(n) { today().seconds += n; save(); }

  function recordExercise(ex) {
    today().exercises++;
    data.practice.exercises++;
    var k = data.practice.byKey[ex.key] || (data.practice.byKey[ex.key] = { count: 0 });
    k.count++;
    save();
  }

  function bucket(obj, name) {
    return obj[name] || (obj[name] = { asked: 0, correct: 0, msTotal: 0 });
  }

  function recordDrillAnswer(a) {
    var t = today();
    t.drillQ++;
    if (a.correct) t.drillCorrect++;

    var n = bucket(data.drill.byNote, a.noteLabel);
    n.asked++; if (a.correct) { n.correct++; n.msTotal += a.ms; }
    var k = bucket(data.drill.byKey, a.key);
    k.asked++; if (a.correct) k.correct++;
    var c = bucket(data.drill.byClef, a.clef);
    c.asked++; if (a.correct) c.correct++;

    if (a.correct) {
      var best = data.drill.best;
      if (best.fastestMs == null || a.ms < best.fastestMs) best.fastestMs = a.ms;
    }
    save();
  }

  function recordStreak(streak) {
    if (streak > data.drill.best.streak) { data.drill.best.streak = streak; save(); }
  }

  function recordRound(correct, total) {
    data.drill.rounds++;
    var pct = total ? Math.round((correct / total) * 100) : 0;
    if (pct > data.drill.best.roundPct) data.drill.best.roundPct = pct;
    save();
  }

  function activeOn(k) {
    var d = data.days[k];
    return !!d && (d.seconds >= 30 || d.exercises > 0 || d.drillQ > 0);
  }

  function dayStreak() {
    var d = new Date();
    if (!activeOn(dayKey(d))) {
      d.setDate(d.getDate() - 1);
      if (!activeOn(dayKey(d))) return 0;
    }
    var streak = 0;
    while (activeOn(dayKey(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function totals() {
    var secs = 0, q = 0, correct = 0, ex = 0, daysActive = 0;
    Object.keys(data.days).forEach(function (k) {
      var d = data.days[k];
      secs += d.seconds; q += d.drillQ; correct += d.drillCorrect; ex += d.exercises;
      if (activeOn(k)) daysActive++;
    });
    return { seconds: secs, drillQ: q, drillCorrect: correct, exercises: ex, daysActive: daysActive };
  }

  function weakest(n) {
    return Object.keys(data.drill.byNote)
      .map(function (label) {
        var b = data.drill.byNote[label];
        return { label: label, asked: b.asked, correct: b.correct, pct: b.asked ? b.correct / b.asked : 1 };
      })
      .filter(function (r) { return r.asked >= 3; })
      .sort(function (a, b) { return a.pct - b.pct || b.asked - a.asked; })
      .slice(0, n || 5);
  }

  function last7Days() {
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var k = dayKey(d);
      var day = data.days[k] || { seconds: 0, exercises: 0, drillQ: 0, drillCorrect: 0 };
      out.push({ key: k, date: d, minutes: Math.round(day.seconds / 60), day: day });
    }
    return out;
  }

  read();

  SR.store = {
    get data() { return data; },
    available: function () { return ok; },
    save: save,
    addSeconds: addSeconds,
    recordExercise: recordExercise,
    recordDrillAnswer: recordDrillAnswer,
    recordStreak: recordStreak,
    recordRound: recordRound,
    todayStats: function () { return today(); },
    dayStreak: dayStreak,
    totals: totals,
    weakest: weakest,
    last7Days: last7Days,
    byKeyStats: function () { return data.drill.byKey; },
    saveSettings: function (s) { data.settings = s; save(); },
    loadSettings: function () { return data.settings; },
    reset: function () {
      data = blank();
      try { global.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    }
  };
})(window);
