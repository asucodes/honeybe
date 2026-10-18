/* honeybee personalization engine, v2
 * ---------------------------------------------------------------
 * Framework-agnostic, dependency-free. Exposes `window.HBE`.
 * Designed for reuse outside this app (e.g. Weven).
 *
 * Design rules, in order of importance:
 *  1. Honest. Missing data never becomes a good score. A weak or
 *  partial profile weakens the personalization instead of guessing.
 *  2. Bounded. Personalization can move a program by at most
 *  MAX_DELTA points in either direction. It reorders opinions,
 *  it cannot fabricate a winner.
 *  3. Explainable. Every personal component can be broken down into
 *  per-surface shares and proficiency, in plain numbers.
 *  4. Monotonic. Raising your proficiency in a program's dominant
 *  surface never lowers that program's score.
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
    "web",
    "api",
    "mobile",
    "cloud",
    "network",
    "source",
    "hardware",
    "smart_contract",
    "ai",
    "other",
  ];

  var LEVEL_LABELS = { 1: "Beginner", 2: "Intermediate", 3: "Advanced" };

  var LEVEL_FACTORS = { 1: 0.5, 2: 0.85, 3: 1.0 };

  /* Tools amplify skills you already have; they never create them. */
  var TOOL_BUMPS = {
    burp_pro: { web: 1, api: 1 },
    collaborator: { network: 1, other: 1 },
    mobile_proxy: { mobile: 1 },
    vps: { cloud: 1, network: 1 },
  };

  var BASE_WEIGHTS = {
    novelty: 0.22,
    inverse_crowd: 0.22,
    payout_reliability: 0.22,
    value_per_competition: 0.16,
    triage_quality: 0.11,
    scope_breadth: 0.07,
  };

  var SCHEMA_VERSION = 2;
  var STACK_WEIGHT = 0.15; // maximum share handed to personal fit
  var MAX_DELTA = 12; // hard bound on personalization influence, points

  function clamp(v, lo, hi) {
    if (typeof v !== "number" || isNaN(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
  }

  /* ---------- profile ---------- */

  function emptyProfile(level) {
    var lvl = clamp(Number(level) || 2, 1, 3);
    var surfaces = {};
    var defaults = { web: lvl === 1 ? 2 : lvl === 2 ? 3 : 4 };
    SURFACES.forEach(function (s) {
      surfaces[s] = defaults[s] || 0;
    });
    return {
      version: SCHEMA_VERSION,
      capability: {
        level: lvl,
        years: lvl === 1 ? 0.5 : lvl === 2 ? 2 : 5,
        bugs_found: lvl === 1 ? 0 : lvl === 2 ? 3 : 20,
        surfaces: surfaces,
      },
      constraints: {
        hours_per_week: lvl === 1 ? 5 : lvl === 2 ? 10 : 15,
        session_hours: lvl === 1 ? 2 : 3,
        tools: {
          burp_pro: false,
          collaborator: false,
          mobile_proxy: false,
          vps: false,
        },
      },
      preferences: {
        goal: "first_bounty",
        variance_tolerance: 0.3,
      },
      outcomes: [],
    };
  }

  /* Parse anything out of localStorage into a valid v2 profile, or null. */
  function migrateProfile(raw) {
    if (!raw || typeof raw !== "object") return null;
    var p = JSON.parse(JSON.stringify(raw));
    p.version = SCHEMA_VERSION;

    p.capability = p.capability || {};
    p.capability.level = clamp(Number(p.capability.level) || 2, 1, 3);
    p.capability.surfaces = p.capability.surfaces || {};
    SURFACES.forEach(function (s) {
      p.capability.surfaces[s] = clamp(
        Math.round(Number(p.capability.surfaces[s]) || 0),
        0,
        5,
      );
    });

    p.constraints = p.constraints || {};
    var hw = Number(p.constraints.hours_per_week);
    p.constraints.hours_per_week = clamp(isNaN(hw) ? 10 : hw, 2, 40);
    var sh = Number(p.constraints.session_hours);
    p.constraints.session_hours = clamp(isNaN(sh) ? 3 : sh, 1, 8);
    p.constraints.tools = p.constraints.tools || {};
    ["burp_pro", "collaborator", "mobile_proxy", "vps"].forEach(function (t) {
      p.constraints.tools[t] = !!p.constraints.tools[t];
    });

    p.preferences = p.preferences || {};
    if (
      ["first_bounty", "income", "learning"].indexOf(p.preferences.goal) === -1
    ) {
      p.preferences.goal = "first_bounty";
    }
    p.preferences.variance_tolerance = clamp(
      Number(p.preferences.variance_tolerance) == null
        ? 0.3
        : Number(p.preferences.variance_tolerance),
      0,
      1,
    );

    p.outcomes = Array.isArray(p.outcomes) ? p.outcomes : [];
    return p;
  }

  /* ---------- profile strength ---------- */

  /** 0..1. A half-filled profile applies half-strength personalization. */
  function completeness(profile) {
    if (!profile || !profile.capability) return 0;
    var s = profile.capability.surfaces || {};
    var hasSurface = SURFACES.some(function (k) {
      return (s[k] || 0) > 0;
    })
      ? 1
      : 0;
    var hasGoal = profile.preferences && profile.preferences.goal ? 1 : 0;
    var hasTime =
      profile.constraints &&
      Number(profile.constraints.hours_per_week) > 0 &&
      Number(profile.constraints.session_hours) > 0
        ? 1
        : 0;
    var hasTools =
      profile.constraints &&
      profile.constraints.tools &&
      Object.keys(profile.constraints.tools).some(function (k) {
        return profile.constraints.tools[k];
      })
        ? 1
        : 0;
    return 0.3 * hasSurface + 0.25 * hasGoal + 0.25 * hasTime + 0.2 * hasTools;
  }

  function hasProfile(profile) {
    if (!profile || !profile.capability) return false;
    var s = profile.capability.surfaces || {};
    return SURFACES.some(function (k) {
      return (s[k] || 0) > 0;
    });
  }

  /* ---------- effective skill ---------- */

  /**
   * Self-assessed sliders, adjusted for stated experience level and tools.
   * Tools only amplify a surface the user already practices (slider > 0),
   * and everything is clamped to 0..5.
   */
  function effectiveSurfaces(profile) {
    var out = {};
    var base =
      profile && profile.capability ? profile.capability.surfaces || {} : {};
    var lvl =
      profile && profile.capability
        ? clamp(Number(profile.capability.level) || 2, 1, 3)
        : 2;
    var factor = LEVEL_FACTORS[lvl];
    var tools =
      profile && profile.constraints ? profile.constraints.tools || {} : {};

    SURFACES.forEach(function (s) {
      var b = clamp(Math.round(Number(base[s]) || 0), 0, 5);
      var eff = b * factor;
      Object.keys(TOOL_BUMPS).forEach(function (t) {
        if (tools[t] && TOOL_BUMPS[t][s] && b > 0) eff += TOOL_BUMPS[t][s];
      });
      out[s] = clamp(eff, 0, 5);
    });
    return out;
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

  function dominantSurface(program) {
    var counts = surfaceCounts(program.scope);
    var best = null,
      bestN = -1;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > bestN) {
        best = k;
        bestN = counts[k];
      }
    });
    return best;
  }

  /* ---------- time gating ---------- */

  /**
   * Short sessions cannot sweep huge scopes. A small, monotonic discount on
   * the scope-breadth component for low-time hunters on very large programs.
   */
  function timeGateFactor(profile, program) {
    if (!profile || !profile.constraints) return 1;
    var session = Number(profile.constraints.session_hours) || 3;
    var assets = (program.signals && program.signals.scope_count) || 0;
    if (session <= 2 && assets >= 200) return 0.75;
    if (session <= 3 && assets >= 400) return 0.85;
    return 1;
  }

  /* ---------- match ---------- */

  /** 0..1 - share-weighted effective proficiency across the program's scope. */
  function stackMatch(program, profile) {
    if (!hasProfile(profile)) return 0.5;
    var eff = effectiveSurfaces(profile);
    var counts = surfaceCounts(program.scope);
    var total = 0,
      weighted = 0;
    Object.keys(counts).forEach(function (surface) {
      var share = counts[surface];
      total += share;
      weighted += share * (eff[surface] / 5);
    });
    if (total === 0) return 0.5;
    return weighted / total;
  }

  /**
   * Per-surface explanation for a program. Shares always sum to ~1.
   * matched: effective proficiency >= 4. partial: 2..3. unmatched: <= 1.
   */
  function matchBreakdown(program, profile) {
    var counts = surfaceCounts(program.scope);
    var eff = effectiveSurfaces(profile);
    var base =
      profile && profile.capability ? profile.capability.surfaces || {} : {};
    var total = 0;
    Object.keys(counts).forEach(function (s) {
      total += counts[s];
    });
    if (total === 0)
      return { matched: 0, partial: 0, unmatched: 0, surfaces: [], total: 0 };

    var surfaces = Object.keys(counts)
      .map(function (s) {
        return {
          surface: s,
          share: counts[s] / total,
          base: clamp(Math.round(Number(base[s]) || 0), 0, 5),
          eff: eff[s],
        };
      })
      .sort(function (a, b) {
        return b.share - a.share;
      });

    var sum = { matched: 0, partial: 0, unmatched: 0 };
    surfaces.forEach(function (s) {
      if (s.eff >= 4) sum.matched += s.share;
      else if (s.eff >= 2) sum.partial += s.share;
      else sum.unmatched += s.share;
    });
    sum.total = total;
    sum.surfaces = surfaces;
    return sum;
  }

  /* ---------- penalties ---------- */

  /**
   * Share-weighted mismatch penalty over the top 2 surfaces. A program that
   * is half web, half mobile still pays for the mobile half.
   */
  function mismatchPenalty(program, profile) {
    if (!hasProfile(profile)) return 0;
    var eff = effectiveSurfaces(profile);
    var counts = surfaceCounts(program.scope);
    var keys = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a];
    });
    var penalty = 0;
    keys.slice(0, 2).forEach(function (s, i) {
      var share =
        counts[s] /
        Math.max(
          1,
          Object.keys(counts).reduce(function (n, k) {
            return n + counts[k];
          }, 0),
        );
      var weight = i === 0 ? 1 : 0.5; // dominant surface matters most
      if (eff[s] <= 1) penalty -= 18 * share * weight;
      else if (eff[s] === 2) penalty -= 8 * share * weight;
    });
    return penalty;
  }

  /* ---------- weights ---------- */

  function weightsFor(profile, personalWeight) {
    var weights = {};
    Object.keys(BASE_WEIGHTS).forEach(function (k) {
      weights[k] = BASE_WEIGHTS[k];
    });

    if (!hasProfile(profile)) {
      weights.stack_match = 0;
      return weights;
    }

    var prefs = profile.preferences || {};
    var goal = prefs.goal || "first_bounty";

    if (goal === "income") {
      weights.payout_reliability *= 1.45;
      weights.inverse_crowd *= 1.1;
    } else if (goal === "first_bounty") {
      weights.inverse_crowd *= 1.35;
      weights.scope_breadth *= 0.65;
      weights.value_per_competition *= 0.85;
    } else if (goal === "learning") {
      weights.value_per_competition *= 0.8;
      weights.triage_quality *= 1.1;
    }

    var variance =
      typeof prefs.variance_tolerance === "number"
        ? clamp(prefs.variance_tolerance, 0, 1)
        : 0.3;
    weights.value_per_competition *= 0.8 + variance * 0.6;

    var pw = clamp(Number(personalWeight) || STACK_WEIGHT, 0, STACK_WEIGHT);
    var sum = 0;
    Object.keys(weights).forEach(function (k) {
      sum += weights[k];
    });
    Object.keys(weights).forEach(function (k) {
      weights[k] = (weights[k] / sum) * (1 - pw);
    });
    weights.stack_match = pw;
    return weights;
  }

  /* ---------- scoring ---------- */

  function populationScore(program) {
    return program.score && typeof program.score.total === "number"
      ? program.score.total
      : 0;
  }

  function curatedScore(program, profile) {
    var population = populationScore(program);
    if (!hasProfile(profile)) return population;

    var c = completeness(profile);
    var weights = weightsFor(profile, STACK_WEIGHT * c);
    var parts = {};
    var source =
      program.score && program.score.parts ? program.score.parts : {};
    Object.keys(source).forEach(function (k) {
      parts[k] = source[k];
    });

    parts.stack_match = stackMatch(program, profile);
    parts.scope_breadth =
      (parts.scope_breadth || 0) * timeGateFactor(profile, program);

    var total = 0;
    Object.keys(weights).forEach(function (k) {
      total += weights[k] * (parts[k] || 0);
    });
    total *= 100;

    (program.score && program.score.penalties
      ? program.score.penalties
      : []
    ).forEach(function (p) {
      total += p.points;
    });
    total += mismatchPenalty(program, profile);

    // Bounded influence: personalization can only move a program so far.
    var delta = clamp(total - population, -MAX_DELTA, MAX_DELTA);
    return clamp(population + delta, 0, 100);
  }

  /** Re-rank programs for a profile. Returns a new array. */
  function rescore(programs, profile) {
    var personalised = hasProfile(profile);
    var out = programs.map(function (program, index) {
      var score = personalised
        ? curatedScore(program, profile)
        : populationScore(program);
      return { program: program, score: score, index: index };
    });

    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

    var total = out.length;
    return out.map(function (row, position) {
      row.rank = position + 1;
      row.percentile = total
        ? Math.round((1 - position / total) * 1000) / 10
        : 0;
      row.personalised = personalised;
      return row;
    });
  }

  /** Per-component contribution, for the "why" panel. */
  function explain(program, profile) {
    var parts = program.score && program.score.parts ? program.score.parts : {};
    var c = hasProfile(profile) ? completeness(profile) : 0;
    var weights = weightsFor(profile, STACK_WEIGHT * c);
    var rows = [];

    Object.keys(weights).forEach(function (key) {
      if (!weights[key]) return;
      var value =
        key === "stack_match" ? stackMatch(program, profile) : parts[key] || 0;
      rows.push({
        key: key,
        label: key.replace(/_/g, " "),
        value: value,
        weight: weights[key],
        contribution: value * weights[key] * 100,
      });
    });

    rows.sort(function (a, b) {
      return b.contribution - a.contribution;
    });
    return rows;
  }

  /* ---------- beginner guard ---------- */

  /**
   * UI-level warning, not a score change: very crowded programs are hard for
   * beginners regardless of surface. Flags roughly the top third of programs
   * by competition (crowding/asset/month >= 5 or >= 900 reports in 90 days),
   * which is where the elite-report programs like Stripe and GitHub sit.
   */
  function crowdedForBeginner(program, profile) {
    if (
      !profile ||
      !profile.capability ||
      Number(profile.capability.level) !== 1
    )
      return false;
    var s = program.signals || {};
    var d = program.derived || {};
    return d.crowding_per_asset_month >= 5 || s.reports_90d >= 900;
  }

  /* ---------- skill gap analysis ---------- */

  /**
   * For each weak surface (base <= 1): if the user practiced it to 3/5,
   * how many new programs would enter their top 50, and at what median?
   * This turns the ranking into a learning roadmap.
   */
  function skillGap(programs, profile) {
    if (!hasProfile(profile)) return [];
    var baseline = {};
    rescore(programs, profile)
      .slice(0, 50)
      .forEach(function (r) {
        baseline[r.program.id] = true;
      });

    var weak = SURFACES.filter(function (s) {
      return (profile.capability.surfaces[s] || 0) <= 1;
    });

    var gaps = weak.map(function (surface) {
      var clone = JSON.parse(JSON.stringify(profile));
      clone.capability.surfaces[surface] = 3;
      var gained = rescore(programs, clone).filter(function (r) {
        return !baseline[r.program.id] && r.rank <= 50;
      });
      var median = 0;
      if (gained.length) {
        var scores = gained
          .map(function (r) {
            return r.score;
          })
          .sort(function (a, b) {
            return a - b;
          });
        median = scores[Math.floor(scores.length / 2)];
      }
      return {
        surface: surface,
        count: gained.length,
        median: median,
        example: gained.length ? gained[0].program : null,
      };
    });

    gaps.sort(function (a, b) {
      return b.count - a.count;
    });
    return gaps
      .filter(function (g) {
        return g.count > 0;
      })
      .slice(0, 3);
  }

  global.HBE = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STACK_WEIGHT: STACK_WEIGHT,
    MAX_DELTA: MAX_DELTA,
    LEVEL_LABELS: LEVEL_LABELS,
    LEVEL_FACTORS: LEVEL_FACTORS,
    SURFACES: SURFACES,
    SURFACE_BY_TYPE: SURFACE_BY_TYPE,
    emptyProfile: emptyProfile,
    migrateProfile: migrateProfile,
    completeness: completeness,
    hasProfile: hasProfile,
    effectiveSurfaces: effectiveSurfaces,
    stackMatch: stackMatch,
    surfaceCounts: surfaceCounts,
    dominantSurface: dominantSurface,
    matchBreakdown: matchBreakdown,
    timeGateFactor: timeGateFactor,
    mismatchPenalty: mismatchPenalty,
    weightsFor: weightsFor,
    curatedScore: curatedScore,
    rescore: rescore,
    explain: explain,
    crowdedForBeginner: crowdedForBeginner,
    skillGap: skillGap,
  };
})(typeof window !== "undefined" ? window : globalThis);
