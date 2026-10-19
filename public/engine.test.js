/* honeybe engine test harness — run: node engine.test.js
 * Pure fixtures, no data dependency. Guards the v2 guarantees:
 * bounded influence, monotonicity, cold start, ramp, migration. */

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var code = fs.readFileSync(path.join(__dirname, "engine.js"), "utf8");
var sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
var HBE = sandbox.window.HBE;

var failures = 0;
function assert(name, cond) {
  if (cond) console.log("ok   " + name);
  else {
    failures++;
    console.log("FAIL " + name);
  }
}

/* ---------- fixtures ---------- */

function mkProgram(id, score, scope, signals, derived) {
  return {
    id: id,
    name: id,
    url: "#",
    signals: Object.assign(
      {
        scope_count: scope.length,
        reports_90d: 100,
        response_efficiency: 90,
        paid_90d: 5000,
        age_months: 24,
      },
      signals || {},
    ),
    derived: Object.assign(
      { crowding_per_asset_month: 0.5, slop_risk: 0.02 },
      derived || {},
    ),
    score: score,
    badges: {
      will_pay: { tier: "green", label: "Pays reliably", why: "test" },
      slop: { risk: 0.02, label: "none", experimental: true },
    },
    scope: scope,
    reasons: [],
  };
}

var parts = {
  novelty: 0.5,
  inverse_crowd: 0.5,
  payout_reliability: 0.9,
  value_per_competition: 0.5,
  triage_quality: 0.9,
  scope_breadth: 0.9,
};
var webHeavy = mkProgram(
  "webheavy",
  { total: 70, parts: parts, penalties: [], weights: {} },
  [
    { asset: "a.com", type: "URL" },
    { asset: "b.com", type: "URL" },
    { asset: "c.com", type: "URL" },
    { asset: "d.com", type: "API" },
  ],
);
var mobileHeavy = mkProgram(
  "mobileheavy",
  { total: 70, parts: parts, penalties: [], weights: {} },
  [
    { asset: "app1", type: "OTHER_APK" },
    { asset: "app2", type: "GOOGLE_PLAY_APP_ID" },
  ],
);
var mixed = mkProgram(
  "mixed",
  { total: 60, parts: parts, penalties: [], weights: {} },
  [
    { asset: "web.com", type: "URL" },
    { asset: "app", type: "OTHER_APK" },
  ],
);
var noScope = mkProgram(
  "noscope",
  { total: 50, parts: parts, penalties: [], weights: {} },
  [],
);
var punished = mkProgram(
  "punished",
  {
    total: 40,
    parts: parts,
    penalties: [{ reason: "missing response targets", points: -10 }],
    weights: {},
  },
  [{ asset: "x.com", type: "URL" }],
);

var programs = [webHeavy, mobileHeavy, mixed, noScope, punished];

/* ---------- profile schema ---------- */

var empty = HBE.emptyProfile(1);
assert("emptyProfile v2 has level", empty.capability.level === 1);
assert("emptyProfile v2 has version", empty.version === 2);
assert(
  "surfaces clamped 0..5",
  HBE.emptyProfile(3).capability.surfaces.web === 4,
);

var migrated = HBE.migrateProfile({
  version: 1,
  capability: { surfaces: { web: 9, mobile: -3 } },
  constraints: {
    hours_per_week: 999,
    session_hours: 0,
    tools: { burp_pro: true },
  },
  preferences: { goal: "nonsense" },
});
assert("migration adds level", migrated.capability.level === 2);
assert(
  "migration clamps surfaces",
  migrated.capability.surfaces.web === 5 &&
    migrated.capability.surfaces.mobile === 0,
);
assert(
  "migration clamps time",
  migrated.constraints.hours_per_week === 40 &&
    migrated.constraints.session_hours === 1,
);
assert("migration fixes goal", migrated.preferences.goal === "first_bounty");
assert("migrateProfile(null) is null", HBE.migrateProfile(null) === null);
assert("corrupt JSON tolerated", HBE.migrateProfile("junk") === null);

/* ---------- cold start ---------- */

var cold = HBE.rescore(programs, null);
assert(
  "no profile -> population scores exactly",
  cold.every(function (r) {
    return r.score === r.program.score.total;
  }),
);

/* ---------- monotonicity + bounds ---------- */

var p1 = HBE.emptyProfile(2);
p1.capability.surfaces.web = 1;
var p2 = HBE.emptyProfile(2);
p2.capability.surfaces.web = 5;
p2.preferences.goal = "income"; // extra shifts, still must be monotonic on web
p2.constraints.session_hours = 2; // triggers time gate, still monotonic
var s1 = HBE.curatedScore(webHeavy, p1);
var s2 = HBE.curatedScore(webHeavy, p2);
assert("raising dominant surface never lowers score", s2 >= s1);

var maxSwing = 0;
var full = HBE.emptyProfile(3);
full.capability.surfaces = {
  web: 5,
  mobile: 5,
  api: 5,
  cloud: 5,
  network: 5,
  source: 5,
  hardware: 5,
  smart_contract: 5,
  ai: 5,
  other: 5,
};
full.preferences.goal = "income";
full.constraints.session_hours = 8;
full.constraints.tools = {
  burp_pro: true,
  collaborator: true,
  mobile_proxy: true,
  vps: true,
};
programs.forEach(function (prog) {
  var delta = Math.abs(HBE.curatedScore(prog, full) - prog.score.total);
  if (delta > maxSwing) maxSwing = delta;
});
assert(
  "influence bounded at MAX_DELTA (" + maxSwing.toFixed(2) + " pts)",
  maxSwing <= HBE.MAX_DELTA + 0.001,
);

var zero = HBE.emptyProfile(3);
zero.capability.surfaces = { web: 0, api: 0, mobile: 0 };
var worst = HBE.curatedScore(webHeavy, zero);
assert("all-zero surfaces cannot crash score", worst >= 0 && worst <= 100);

/* ---------- completeness ramp ---------- */

var partial = HBE.emptyProfile(2);
partial.preferences = {}; // no goal, no time, no tools, just surfaces
assert(
  "partial profile ramps below full",
  HBE.completeness(partial) < HBE.completeness(full),
);

var rampWeightsPartial = HBE.weightsFor(
  partial,
  HBE.STACK_WEIGHT * HBE.completeness(partial),
).stack_match;
var rampWeightsFull = HBE.weightsFor(
  full,
  HBE.STACK_WEIGHT * HBE.completeness(full),
).stack_match;
assert(
  "ramped personal weight below full weight",
  rampWeightsPartial < rampWeightsFull,
);

/* ---------- tools amplify, never create ---------- */

var noWeb = HBE.emptyProfile(3);
noWeb.capability.surfaces = { web: 0, mobile: 0 };
noWeb.constraints.tools.burp_pro = true;
var eff = HBE.effectiveSurfaces(noWeb);
assert("burp_pro does not create web skill from zero", eff.web === 0);

var someWeb = HBE.emptyProfile(3);
someWeb.capability.surfaces = { web: 2 };
someWeb.constraints.tools.burp_pro = true;
var eff2 = HBE.effectiveSurfaces(someWeb);
assert("burp_pro amplifies existing web skill", eff2.web === 2 * 1.0 + 1);

/* ---------- level factor ---------- */

var beg = HBE.emptyProfile(1);
beg.capability.surfaces.web = 5;
assert(
  "beginner self-assessment is discounted",
  HBE.effectiveSurfaces(beg).web === 2.5,
);

/* ---------- match breakdown ---------- */

var breakdown = HBE.matchBreakdown(mixed, HBE.emptyProfile(2));
var sum = breakdown.matched + breakdown.partial + breakdown.unmatched;
assert("breakdown shares sum to ~1", Math.abs(sum - 1) < 0.001);
assert(
  "breakdown lists surfaces sorted by share",
  breakdown.surfaces.length === 2 &&
    breakdown.surfaces[0].share >= breakdown.surfaces[1].share,
);

/* ---------- skill gap ---------- */

var learner = HBE.emptyProfile(1);
learner.capability.surfaces = { web: 3 };
var gaps = HBE.skillGap(programs, learner);
assert(
  "skill gap ignores practiced surface",
  gaps.every(function (g) {
    return g.surface !== "web";
  }),
);
assert("skill gap returns array of opportunities", Array.isArray(gaps));

var noProfileGaps = HBE.skillGap(programs, null);
assert("skill gap needs a profile", noProfileGaps.length === 0);

/* ---------- beginner guard ---------- */

var beginner = HBE.emptyProfile(1);
assert(
  "crowded flag fires for beginner on elite program",
  HBE.crowdedForBeginner(
    mkProgram(
      "elite",
      { total: 60, parts: parts, penalties: [], weights: {} },
      [{ asset: "x.com", type: "URL" }],
      { reports_90d: 959 },
    ),
    beginner,
  ) === true,
);
assert(
  "crowded flag silent for intermediate",
  HBE.crowdedForBeginner(webHeavy, HBE.emptyProfile(2)) === false,
);
assert(
  "crowded flag quiet on average program",
  HBE.crowdedForBeginner(webHeavy, beginner) === false,
);

/* ---------- time gate ---------- */

var shortSession = HBE.emptyProfile(1);
shortSession.constraints.session_hours = 2;
var longSession = HBE.emptyProfile(3);
longSession.constraints.session_hours = 8;
var bigScope = mkProgram(
  "big",
  { total: 65, parts: parts, penalties: [], weights: {} },
  Array.from({ length: 500 }, function (_, i) {
    return { asset: "x" + i + ".com", type: "URL" };
  }),
);
assert(
  "short session gates huge scope",
  HBE.timeGateFactor(shortSession, bigScope) <
    HBE.timeGateFactor(longSession, bigScope),
);

/* ---------- explain ---------- */

var ex = HBE.explain(webHeavy, full);
assert("explain covers all components", ex.length >= 6);
assert(
  "explain contributions sorted desc",
  ex[0].contribution >= ex[1].contribution,
);

console.log(
  failures === 0 ? "\nall checks passed" : "\n" + failures + " check(s) failed",
);
process.exit(failures === 0 ? 0 : 1);
