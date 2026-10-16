/* honeybee personalization engine
 * ---------------------------------------------------------------
 * Framework-agnostic, dependency-free. Exposes `window.HBE`.
 * Designed to be reusable outside this app (e.g. Weven).
 *
 * The published JSON is user-agnostic. Everything personal happens here,
 * in the browser. No accounts, no server, no data leaves the machine.
 */
(function (global) {
  "use strict";

  /* ---------- asset type -> human skill surface ---------- */

  var SURFACE_BY_TYPE = {
    WILDCARD: "web",
    URL: "web",
    CIDR: "network",
    API: "api",
    APPLE_STORE_APP_ID: "mobile",
    GOOGLE_PLAY_APP_ID: "mobile",
    OTHER_APK: "mobile",
    OTHER_IPA: "mobile",
    WINDOWS_APP_STORE_APP_ID: "mobile",
    TESTFLIGHT: "mobile",
    SOURCE_CODE: "source",
    DOWNLOADABLE_EXECUTABLES: "source",
    HARDWARE: "hardware",
    SMART_CONTRACT: "smart_contract",
    AI_MODEL: "ai",
    OTHER: "other",
  };

  var SURFACES = [
    "web", "api", "mobile", "cloud", "network",
    "source", "hardware", "smart_contract", "ai", "other",
  ];

  var BASE_WEIGHTS = {
    novelty: 0.22,
    inverse_crowd: 0.22,
    payout_reliability: 0.22,
    value_per_competition: 0.16,
    triage_quality: 0.11,
    scope_breadth: 0.07,
  };

  var STACK_WEIGHT = 0.15; // share of the score handed to personal fit

  function emptyProfile() {
    var surfaces = {};
    SURFACES.forEach(function (s) { surfaces[s] = 0; });
    return {
      version: 1,
      capability: {
        years: 1,
        bugs_found: 0,
        surfaces: surfaces,
      },
      constraints: {
        hours_per_week: 10,
        session_hours: 3,
        tools: { burp_pro: false, collaborator: false, mobile_proxy: false, vps: false },
      },
      preferences: {
        goal: "first_bounty",
        variance_tolerance: 0.3,
      },
      outcomes: [],
    };
  }

  function hasProfile(profile) {
    if (!profile || !profile.capability) return false;
    var s = profile.capability.surfaces || {};
    return SURFACES.some(function (k) { return (s[k] || 0) > 0; });
  }

  /* ---------- scope analysis ---------- */

  function surfaceCounts(scope) {
    var counts = {};
    (scope || []).forEach(function (asset) {
      var surface = SURFACE_BY_TYPE[asset.type] || "other";
      counts[surface] = (counts[surface] || 0) + 1;
    });
    return counts;
  }

  /** 0..1 — how much of this program's surface the user is equipped for. */
  function stackMatch(program, profile) {
    if (!hasProfile(profile)) return 0.5;

    var counts = surfaceCounts(program.scope);
    var total = 0;
    var weighted = 0;

    Object.keys(counts).forEach(function (surface) {
      var share = counts[surface];
      total += share;
      var proficiency = (profile.capability.surfaces[surface] || 0) / 5;
      weighted += share * proficiency;
    });

    if (total === 0) return 0.5;
    return weighted / total;
  }

  /** Which surfaces dominate, e.g. { web: 301, mobile: 12 } */
  function dominantSurface(program) {
    var counts = surfaceCounts(program.scope);
    var best = null;
    var bestN = -1;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > bestN) { best = k; bestN = counts[k]; }
    });
    return best;
  }

  /* ---------- weights ---------- */

  function weightsFor(profile) {
    var weights = {};
    Object.keys(BASE_WEIGHTS).forEach(function (k) { weights[k] = BASE_WEIGHTS[k]; });

    if (!hasProfile(profile)) {
      weights.stack_match = 0;
      return weights;
    }

    var prefs = profile.preferences || {};
    var goal = prefs.goal || "first_bounty";

    if (goal === "income") {
      weights.payout_reliability *= 1.45;
      weights.inverse_crowd *= 1.10;
    } else if (goal === "first_bounty") {
      weights.inverse_crowd *= 1.35;
      weights.scope_breadth *= 0.65;
      weights.value_per_competition *= 0.85;
    } else if (goal === "learning") {
      weights.value_per_competition *= 0.80;
      weights.triage_quality *= 1.10;
    }

    var variance = typeof prefs.variance_tolerance === "number" ? prefs.variance_tolerance : 0.3;
    weights.value_per_competition *= 0.80 + variance * 0.60;

    // Renormalise the population part, then hand STACK_WEIGHT to personal fit.
    var sum = 0;
    Object.keys(weights).forEach(function (k) { sum += weights[k]; });
    Object.keys(weights).forEach(function (k) {
      weights[k] = (weights[k] / sum) * (1 - STACK_WEIGHT);
    });
    weights.stack_match = STACK_WEIGHT;

    return weights;
  }

  /* ---------- scoring ---------- */

  function curatedScore(program, profile) {
    var parts = {};
    var source = program.score && program.score.parts ? program.score.parts : {};
    Object.keys(source).forEach(function (k) { parts[k] = source[k]; });

    parts.stack_match = stackMatch(program, profile);

    var weights = weightsFor(profile);
    var total = 0;
    Object.keys(weights).forEach(function (k) {
      total += weights[k] * (parts[k] || 0);
    });
    total *= 100;

    var penalty = 0;
    (program.score && program.score.penalties ? program.score.penalties : []).forEach(function (p) {
      penalty += p.points;
    });

    // A program with no web/API surface for a web-only hunter is a bad fit.
    if (hasProfile(profile)) {
      var surface = dominantSurface(program);
      if (surface && surface !== "other") {
        var prof = profile.capability.surfaces[surface] || 0;
        if (prof === 0) total -= 18;
        else if (prof === 1) total -= 8;
      }
    }

    return Math.max(0, Math.min(100, total + penalty));
  }

  /** Re-rank programmes for a profile. Returns a new array. */
  function rescore(programs, profile) {
    var personalised = hasProfile(profile);
    var out = programs.map(function (program, index) {
      var score = personalised ? curatedScore(program, profile) : program.score.total;
      return { program: program, score: score, index: index };
    });

    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

    var total = out.length;
    return out.map(function (row, position) {
      row.rank = position + 1;
      row.percentile = total ? Math.round((1 - position / total) * 1000) / 10 : 0;
      row.personalised = personalised;
      return row;
    });
  }

  /** Per-component contribution, for the "why" panel. */
  function explain(program, profile) {
    var parts = program.score && program.score.parts ? program.score.parts : {};
    var weights = weightsFor(profile);
    var rows = [];

    Object.keys(weights).forEach(function (key) {
      if (!weights[key]) return;
      var value = key === "stack_match" ? stackMatch(program, profile) : (parts[key] || 0);
      rows.push({
        key: key,
        label: key.replace(/_/g, " "),
        value: value,
        weight: weights[key],
        contribution: value * weights[key] * 100,
      });
    });

    rows.sort(function (a, b) { return b.contribution - a.contribution; });
    return rows;
  }

  global.HBE = {
    SURFACES: SURFACES,
    SURFACE_BY_TYPE: SURFACE_BY_TYPE,
    emptyProfile: emptyProfile,
    hasProfile: hasProfile,
    stackMatch: stackMatch,
    surfaceCounts: surfaceCounts,
    dominantSurface: dominantSurface,
    weightsFor: weightsFor,
    rescore: rescore,
    explain: explain,
  };
})(typeof window !== "undefined" ? window : globalThis);
