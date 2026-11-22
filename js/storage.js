/* storage.js — progress + settings in localStorage, one set per player.
 *
 * Two children share this app, so everything that counts practice lives inside
 * a profile: its own streak, minutes, accuracy and its own settings (instrument,
 * level, tempo). Switching player swaps the lot.
 *
 * Every read and write is wrapped: on a locked-down browser the app still runs,
 * it just forgets between sessions.
 */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});
  var KEY = 'sightReading.v2';
  var LEGACY_KEY = 'sightReading.v1';     // kept as a backup, never deleted

  function blankProfile(id, name) {
    return {
      id: id,
      name: name,
      created: Date.now(),
      days: {},
      practice: { exercises: 0, byKey: {} },
      drill: { byNote: {}, byKey: {}, byClef: {}, rounds: 0, best: { streak: 0, roundPct: 0, fastestMs: null } },
      // Tunes this player wrote themselves. They stay on this device and are
      // never part of the shipped library, which is public domain only.
      customTunes: [],
      settings: null
    };
  }

  function blankRoot(firstName) {
    var first = blankProfile('p1', firstName || 'Player 1');
    return { v: 2, active: 'p1', order: ['p1'], profiles: { p1: first } };
  }

  var root = blankRoot();
  var ok = true;

  function cur() {
    var p = root.profiles[root.active];
    if (!p) {
      root.active = root.order[0];
      p = root.profiles[root.active];
    }
    if (!p) {                              // nothing survived: start clean
      root = blankRoot();
      p = root.profiles[root.active];
    }
    return p;
  }

  var saveTimer = null;
  function save() {
    if (!ok) return;
    if (saveTimer) global.clearTimeout(saveTimer);
    saveTimer = global.setTimeout(function () {
      try { global.localStorage.setItem(KEY, JSON.stringify(root)); } catch (e) { ok = false; }
    }, 250);
  }

  function saveNow() {
    if (!ok) return;
    if (saveTimer) { global.clearTimeout(saveTimer); saveTimer = null; }
    try { global.localStorage.setItem(KEY, JSON.stringify(root)); } catch (e) { ok = false; }
  }

  // Fill in anything a stored profile is missing, so older saves still work.
  function repair(p, id) {
    var fresh = blankProfile(id, p.name || 'Player');
    Object.keys(fresh).forEach(function (k) {
      if (p[k] === undefined || p[k] === null) p[k] = fresh[k];
    });
    p.id = id;
    if (!p.drill.best) p.drill.best = fresh.drill.best;
    return p;
  }

  function read() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.v === 2 && parsed.profiles) {
          root = parsed;
          if (!Array.isArray(root.order) || !root.order.length) root.order = Object.keys(root.profiles);
          root.order = root.order.filter(function (id) { return !!root.profiles[id]; });
          root.order.forEach(function (id) { repair(root.profiles[id], id); });
          if (!root.profiles[root.active]) root.active = root.order[0];
          return;
        }
      }
      // First run after the update: everything recorded so far becomes player one.
      var legacy = global.localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        var old = JSON.parse(legacy);
        if (old && old.v === 1) {
          root = blankRoot();
          var p = root.profiles.p1;
          if (old.days) p.days = old.days;
          if (old.practice) p.practice = old.practice;
          if (old.drill) p.drill = old.drill;
          if (old.settings) p.settings = old.settings;
          repair(p, 'p1');
          saveNow();
          return;
        }
      }
      root = blankRoot();
    } catch (e) {
      ok = false;
      root = blankRoot();
    }
  }

  function dayKey(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function today() {
    var p = cur();
    var k = dayKey();
    if (!p.days[k]) p.days[k] = { seconds: 0, exercises: 0, drillQ: 0, drillCorrect: 0 };
    return p.days[k];
  }

  function addSeconds(n) { today().seconds += n; save(); }

  function recordExercise(ex) {
    var p = cur();
    today().exercises++;
    p.practice.exercises++;
    var k = p.practice.byKey[ex.key] || (p.practice.byKey[ex.key] = { count: 0 });
    k.count++;
    save();
  }

  function bucket(obj, name) {
    return obj[name] || (obj[name] = { asked: 0, correct: 0, msTotal: 0 });
  }

  function recordDrillAnswer(a) {
    var p = cur();
    var t = today();
    t.drillQ++;
    if (a.correct) t.drillCorrect++;

    var n = bucket(p.drill.byNote, a.noteLabel);
    n.asked++; if (a.correct) { n.correct++; n.msTotal += a.ms; }
    var k = bucket(p.drill.byKey, a.key);
    k.asked++; if (a.correct) k.correct++;
    var c = bucket(p.drill.byClef, a.clef);
    c.asked++; if (a.correct) c.correct++;

    if (a.correct) {
      var best = p.drill.best;
      if (best.fastestMs == null || a.ms < best.fastestMs) best.fastestMs = a.ms;
    }
    save();
  }

  function recordStreak(streak) {
    var best = cur().drill.best;
    if (streak > best.streak) { best.streak = streak; save(); }
  }

  function recordRound(correct, total) {
    var p = cur();
    p.drill.rounds++;
    var pct = total ? Math.round((correct / total) * 100) : 0;
    if (pct > p.drill.best.roundPct) p.drill.best.roundPct = pct;
    save();
  }

  function activeOn(k, profile) {
    var d = (profile || cur()).days[k];
    return !!d && (d.seconds >= 30 || d.exercises > 0 || d.drillQ > 0);
  }

  function dayStreak(profile) {
    var p = profile || cur();
    var d = new Date();
    if (!activeOn(dayKey(d), p)) {
      d.setDate(d.getDate() - 1);
      if (!activeOn(dayKey(d), p)) return 0;
    }
    var streak = 0;
    while (activeOn(dayKey(d), p)) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function totals(profile) {
    var p = profile || cur();
    var secs = 0, q = 0, correct = 0, ex = 0, daysActive = 0;
    Object.keys(p.days).forEach(function (k) {
      var d = p.days[k];
      secs += d.seconds; q += d.drillQ; correct += d.drillCorrect; ex += d.exercises;
      if (activeOn(k, p)) daysActive++;
    });
    return { seconds: secs, drillQ: q, drillCorrect: correct, exercises: ex, daysActive: daysActive };
  }

  function weakest(n) {
    var byNote = cur().drill.byNote;
    return Object.keys(byNote)
      .map(function (label) {
        var b = byNote[label];
        return { label: label, asked: b.asked, correct: b.correct, pct: b.asked ? b.correct / b.asked : 1 };
      })
      .filter(function (r) { return r.asked >= 3; })
      .sort(function (a, b) { return a.pct - b.pct || b.asked - a.asked; })
      .slice(0, n || 5);
  }

  function last7Days() {
    var p = cur();
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var k = dayKey(d);
      var day = p.days[k] || { seconds: 0, exercises: 0, drillQ: 0, drillCorrect: 0 };
      out.push({ key: k, date: d, minutes: Math.round(day.seconds / 60), day: day });
    }
    return out;
  }

  /* ---------- players ---------- */

  function nextId() {
    var n = 1;
    while (root.profiles['p' + n]) n++;
    return 'p' + n;
  }

  function cleanName(name, fallback) {
    var trimmed = String(name == null ? '' : name).trim().slice(0, 20);
    return trimmed || fallback;
  }

  function listProfiles() {
    return root.order.map(function (id) {
      var p = root.profiles[id];
      var t = totals(p);
      return {
        id: id,
        name: p.name,
        active: id === root.active,
        streak: dayStreak(p),
        seconds: t.seconds,
        exercises: t.exercises,
        drillQ: t.drillQ
      };
    });
  }

  function addProfile(name) {
    var id = nextId();
    root.profiles[id] = blankProfile(id, cleanName(name, 'Player ' + (root.order.length + 1)));
    root.order.push(id);
    saveNow();
    return id;
  }

  function switchTo(id) {
    if (!root.profiles[id]) return false;
    root.active = id;
    saveNow();
    return true;
  }

  function renameProfile(id, name) {
    var p = root.profiles[id];
    if (!p) return false;
    p.name = cleanName(name, p.name);
    saveNow();
    return true;
  }

  // Removing a player throws away their practice history, so the UI confirms
  // first. The last remaining player cannot be removed.
  function removeProfile(id) {
    if (!root.profiles[id] || root.order.length < 2) return false;
    delete root.profiles[id];
    root.order = root.order.filter(function (other) { return other !== id; });
    if (root.active === id) root.active = root.order[0];
    saveNow();
    return true;
  }

  read();

  SR.store = {
    get data() { return cur(); },
    available: function () { return ok; },
    save: save,
    addSeconds: addSeconds,
    recordExercise: recordExercise,
    recordDrillAnswer: recordDrillAnswer,
    recordStreak: recordStreak,
    recordRound: recordRound,
    todayStats: function () { return today(); },
    dayStreak: function () { return dayStreak(); },
    totals: function () { return totals(); },
    weakest: weakest,
    last7Days: last7Days,
    byKeyStats: function () { return cur().drill.byKey; },
    // Deep copies both ways: the caller keeps one live settings object and
    // mutates it, so holding a reference here would let one player's settings
    // overwrite another's the moment that object changed.
    saveSettings: function (s) {
      try { cur().settings = JSON.parse(JSON.stringify(s)); } catch (e) { cur().settings = null; }
      save();
    },
    loadSettings: function () {
      var s = cur().settings;
      if (!s) return null;
      try { return JSON.parse(JSON.stringify(s)); } catch (e) { return null; }
    },

    customTunes: function () {
      var list = cur().customTunes;
      return Array.isArray(list) ? list : (cur().customTunes = []);
    },
    addCustomTune: function (tune) {
      var list = this.customTunes();
      var copy = JSON.parse(JSON.stringify(tune));
      copy.id = 'ct' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
      copy.custom = true;
      copy.created = Date.now();
      list.push(copy);
      saveNow();
      return copy.id;
    },
    removeCustomTune: function (id) {
      var list = this.customTunes();
      var before = list.length;
      cur().customTunes = list.filter(function (t) { return t.id !== id; });
      saveNow();
      return cur().customTunes.length < before;
    },

    profiles: listProfiles,
    activeProfile: function () {
      var p = cur();
      return { id: p.id, name: p.name };
    },
    addProfile: addProfile,
    switchTo: switchTo,
    renameProfile: renameProfile,
    removeProfile: removeProfile,
    canRemove: function () { return root.order.length > 1; },

    // Wipes this player's history only, leaving the other players alone.
    reset: function () {
      var p = cur();
      var fresh = blankProfile(p.id, p.name);
      fresh.settings = p.settings;        // keep their instrument and level
      root.profiles[p.id] = fresh;
      saveNow();
    }
  };
})(window);
