/* honeybee UI — vanilla JS, no build step */
(function () {
  "use strict";

  var PROFILE_KEY = "honeybee.profile.v1";
  var MAX_COMPARE = 4;

  var state = {
    programs: [],
    meta: null,
    tab: "ranked",
    search: "",
    quick: "all",
    sort: "fit",
    profile: null,
    expanded: {},
    compare: new Set(),
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function nf(value) {
    if (value == null) return "—";
    return Number(value).toLocaleString();
  }

  function money(value) {
    if (value == null) return "—";
    if (value >= 1e6) return "$" + (value / 1e6).toFixed(1) + "M";
    if (value >= 1e3) return "$" + Math.round(value / 1e3) + "k";
    return "$" + Math.round(value);
  }

  function age(months) {
    if (months == null) return "—";
    if (months < 12) return Math.round(months) + "mo";
    return (months / 12).toFixed(1) + "y";
  }

  function pct(value) {
    return value == null ? "—" : Math.round(value) + "%";
  }

  function byId(id) {
    return state.programs.filter(function (p) { return p.id === id; })[0] || null;
  }

  /* ---------------- boot ---------------- */

  function init() {
    loadProfile();
    bindEvents();
    renderProfilePill();
    fetch("data/programs.json")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.programs = data.programs || [];
        state.meta = data;
        $("#meta").textContent = nf(state.programs.length) + " programs · " + when(data.generated_at);
        var heroCount = $("#hero-count");
        if (heroCount) heroCount.textContent = nf(state.programs.length);
        $("#count-ranked").textContent = nf(state.programs.length);
        $("#count-catalog").textContent = "soon";
        renderStats();
        renderTop10();
        render();
      })
      .catch(function (err) {
        $("#list").innerHTML =
          '<div class="empty"><h3>Could not load data</h3><p>' + esc(err.message) +
          ". Run <code>python -m pipeline.run</code> then reload.</p></div>";
        $("#meta").textContent = "offline";
      });
  }

  function when(iso) {
    if (!iso) return "unknown";
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    if (mins < 1440) return Math.round(mins / 60) + "h ago";
    return iso.slice(0, 10);
  }

  /* ---------------- profile ---------------- */

  function loadProfile() {
    try {
      var raw = localStorage.getItem(PROFILE_KEY);
      state.profile = raw ? JSON.parse(raw) : null;
    } catch (e) { state.profile = null; }
  }

  function saveProfile(profile) {
    state.profile = profile;
    try {
      if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      else localStorage.removeItem(PROFILE_KEY);
    } catch (e) { /* private mode */ }
    renderProfilePill();
  }

  function renderProfilePill() {
    var el = $("#profile-pill");
    el.innerHTML = window.HBE.hasProfile(state.profile)
      ? '<span class="profile-pill">tuned to you</span>'
      : "";
  }

  /* ---------------- stats ---------------- */

  function renderStats() {
    var rows = window.HBE.rescore(state.programs, state.profile);
    var scores = rows.map(function (r) { return r.score; });
    var median = scores[Math.floor(scores.length / 2)] || 0;

    var counts = { green: 0, yellow: 0, red: 0, unknown: 0 };
    state.programs.forEach(function (p) {
      counts[p.badges.will_pay.tier] = (counts[p.badges.will_pay.tier] || 0) + 1;
    });

    var top = rows[0];
    var stats = [
      { k: "Programs scored", v: nf(state.programs.length), s: "HackerOne · paid + open" },
      { k: "Median score", v: median.toFixed(1), s: "population, /100" },
      { k: "Pays reliably", v: counts.green, s: "response + payout proof", cls: "green" },
      { k: "Risky", v: counts.red, s: "failed or dormant", cls: "red" },
      {
        k: "Top match", v: top ? top.score.toFixed(1) : "—",
        s: top ? top.program.name.slice(0, 24) : "", cls: "accent",
      },
    ];

    $("#stats").innerHTML = stats.map(function (s) {
      return '<div class="stat ' + (s.cls || "") + '">' +
        '<div class="k">' + esc(s.k) + "</div>" +
        '<div class="v">' + esc(s.v) + "</div>" +
        '<div class="s">' + esc(s.s) + "</div></div>";
    }).join("");

    var total = state.programs.length || 1;
    var bar = $("#tierbar");
    if (bar) {
      bar.innerHTML = ["green", "yellow", "red", "unknown"].map(function (t) {
        return '<i class="t-' + t + '" style="width:' + ((counts[t] || 0) / total) * 100 + '%"></i>';
      }).join("");
    }

    var legend = $("#tierlegend");
    if (legend) {
      var meta = {
        green: ["Pays reliably", "var(--accent)"],
        yellow: ["Pays slowly / missed", "var(--marigold)"],
        red: ["Risky", "var(--danger)"],
        unknown: ["Not enough signal", "var(--rule)"],
      };
      legend.innerHTML = ["green", "yellow", "red", "unknown"].map(function (t) {
        return '<span><i style="background:' + meta[t][1] + '"></i>' + meta[t][0] + " <b>" + (counts[t] || 0) + "</b></span>";
      }).join("");
    }
  }

  /* ---------------- top 10 ---------------- */

  function renderTop10() {
    var rows = window.HBE.rescore(state.programs, state.profile).slice(0, 10);
    var personalised = window.HBE.hasProfile(state.profile);
    var note = $("#top10-note");
    if (note) {
      note.textContent = personalised
        ? "personalised · 15% stack match"
        : "population ranking · add a profile to personalise";
    }

    $("#cards").innerHTML = rows.map(function (row) {
      var p = row.program;
      var s = p.signals;
      var on = state.compare.has(p.id);
      return (
        '<article class="card' + (row.rank <= 3 ? " top" : "") + (on ? " picked" : "") + '" data-id="' + esc(p.id) + '">' +
          '<div class="card-top">' +
            '<span class="card-rank">' + String(row.rank).padStart(2, "0") + "</span>" +
            '<span class="badge ' + p.badges.will_pay.tier + '"><span class="dot"></span>' + esc(p.badges.will_pay.label) + "</span>" +
          "</div>" +
          '<h3 class="card-name"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.name) + "</a></h3>" +
          '<div class="card-sub">HackerOne · ' + age(s.age_months) + " · " + nf(s.scope_count) + " assets</div>" +
          '<div class="card-score">' +
            '<span class="card-num">' + row.score.toFixed(1) + "</span>" +
            '<span class="card-bar"><i style="width:' + Math.min(100, row.score) + '%"></i></span>' +
            '<span class="card-pct">top ' + Math.max(1, Math.round(100 - row.percentile)) + "%</span>" +
          "</div>" +
          '<div class="card-metrics">' +
            "<span><b>" + nf(s.reports_90d) + "</b> r/90d</span>" +
            "<span><b>" + pct(s.response_efficiency) + "</b> resp</span>" +
            "<span><b>" + money(s.paid_90d) + "</b> paid</span>" +
          "</div>" +
          '<div class="card-foot">' +
            '<button class="card-cmp' + (on ? " on" : "") + '" data-cmp="' + esc(p.id) + '">' +
              (on ? "Selected" : "+ Compare") + "</button>" +
            '<a class="card-open" href="' + esc(p.url) + '" target="_blank" rel="noopener">open ↗</a>' +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  /* ---------------- list ---------------- */

  function quickMatch(p, key) {
    var s = p.signals;
    switch (key) {
      case "green": return p.badges.will_pay.tier === "green";
      case "missed": return p.badges.will_pay.label === "Missed targets";
      case "red": return p.badges.will_pay.tier === "red";
      case "lowcomp": return p.derived.crowding_per_asset_month < 0.5;
      case "fresh": return (s.age_months == null ? 999 : s.age_months) < 12;
      case "bigscope": return (s.scope_count || 0) >= 100;
      default: return true;
    }
  }

  function currentRows() {
    var rows = window.HBE.rescore(state.programs, state.profile);

    rows = rows.filter(function (r) { return quickMatch(r.program, state.quick); });

    if (state.search) {
      var q = state.search.toLowerCase();
      rows = rows.filter(function (r) {
        var p = r.program;
        if (p.name.toLowerCase().indexOf(q) !== -1) return true;
        if (p.slug.indexOf(q) !== -1) return true;
        return (p.scope || []).some(function (a) { return a.asset.toLowerCase().indexOf(q) !== -1; });
      });
    }

    if (state.sort !== "fit") {
      var cmp = {
        lowcomp: function (a, b) { return a.program.derived.crowding_per_asset_month - b.program.derived.crowding_per_asset_month; },
        newest: function (a, b) { return (a.program.signals.age_months || 1e9) - (b.program.signals.age_months || 1e9); },
        payout: function (a, b) { return (b.program.signals.paid_90d || 0) - (a.program.signals.paid_90d || 0); },
        scope: function (a, b) { return (b.program.signals.scope_count || 0) - (a.program.signals.scope_count || 0); },
      }[state.sort];
      if (cmp) rows.sort(cmp);
    }

    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  function render() {
    var top10 = $("#top10");
    if (top10) top10.style.display = state.tab === "catalog" ? "none" : "";

    if (state.tab === "catalog") {
      $("#controls").style.display = "none";
      $("#quick").style.display = "none";
      $("#list").innerHTML =
        '<div class="empty"><h3>Catalog is next</h3>' +
        "<p>3,300+ programmes from lissy93, rix4uni and arkadiyt — every field we have, " +
        "with explicit gaps. Nothing here is scored.</p></div>";
      return;
    }

    $("#controls").style.display = "flex";
    $("#quick").style.display = "flex";

    var rows = currentRows();
    var countEl = $("#count-ranked");
    if (countEl) countEl.textContent = nf(rows.length) + (rows.length !== state.programs.length ? "/" + nf(state.programs.length) : "");

    if (!rows.length) {
      $("#list").innerHTML = '<div class="empty"><h3>No programmes match</h3><p>Loosen the filters or clear the search.</p></div>';
      return;
    }

    $("#list").innerHTML = rows.map(rowHtml).join("");
    $("#foot").innerHTML =
      "<b>How this ranks:</b> novelty (t<sup>−0.40</sup> decay) · inverse crowding (reports per asset) · " +
      "payout reliability · value per competition · triage quality · scope breadth. " +
      "Penalties for failed or missed triage, crowd walls, dormancy and slop risk. " +
      (window.HBE.hasProfile(state.profile)
        ? "15% of the score is your personal stack match."
        : "Add a profile to fold in your own stack match.") +
      "<br><b>Slop risk is experimental</b> — it needs a few weeks of snapshots to become a real signal.";
  }

  function rowHtml(row) {
    var p = row.program;
    var s = p.signals;
    var wp = p.badges.will_pay;
    var slop = p.badges.slop;
    var open = !!state.expanded[p.id];
    var picked = state.compare.has(p.id);

    var sub = ["HackerOne", age(s.age_months), nf(s.scope_count) + " assets",
      slop.label !== "none" ? "slop " + slop.label : null].filter(Boolean).join(" · ");

    return (
      '<div class="row' + (open ? " open" : "") + '" data-id="' + esc(p.id) + '">' +
        '<div class="row-main">' +
          '<div class="sel"><input type="checkbox" data-sel="' + esc(p.id) + '"' + (picked ? " checked" : "") + ' aria-label="Compare ' + esc(p.name) + '"></div>' +
          '<div class="rank">' + row.rank + "</div>" +
          '<div class="pname">' +
            '<div class="n"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.name) + "</a></div>" +
            '<div class="sub">' + esc(sub) + "</div>" +
          "</div>" +
          '<div class="scorecell">' +
            '<span class="num">' + row.score.toFixed(1) + "</span>" +
            '<div class="bar"><i style="width:' + Math.min(100, row.score) + '%"></i></div>' +
          "</div>" +
          '<div><span class="badge ' + wp.tier + '"><span class="dot"></span>' + esc(wp.label) + "</span></div>" +
          '<div class="metric hide-sm"><span class="lbl">reports / 90d</span><b>' + nf(s.reports_90d) + "</b></div>" +
          '<div class="metric hide-md"><span class="lbl">assets</span><b>' + nf(s.scope_count) + "</b></div>" +
          '<div class="metric hide-md"><span class="lbl">response</span><b>' + pct(s.response_efficiency) + "</b></div>" +
          '<div class="metric hide-sm"><span class="lbl">paid 90d</span><b>' + money(s.paid_90d) + "</b></div>" +
        "</div>" +
        '<div class="detail">' + detailHtml(p) + "</div>" +
      "</div>"
    );
  }

  function surfaceMix(p) {
    var counts = window.HBE.surfaceCounts(p.scope);
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 5);
    if (!keys.length) return "";
    return '<div class="mix">' + keys.map(function (k) {
      return '<span class="mixchip">' + esc(k) + " <b>" + counts[k] + "</b></span>";
    }).join("") + "</div>";
  }

  function detailHtml(p) {
    var reasons = (p.reasons || []).map(function (r) {
      return '<span class="reason ' + r.sign + '">' + esc(r.text) + "</span>";
    }).join("");

    var penalties = (p.score.penalties || []).map(function (x) {
      return '<span class="reason bad">−' + Math.abs(x.points) + " " + esc(x.reason) + "</span>";
    }).join("");

    var bars = window.HBE.explain(p, state.profile).map(function (c) {
      return '<div class="barline"><span>' + esc(c.label) + "</span>" +
        '<span class="track"><i class="' + (c.contribution >= 8 ? "hot" : "") + '" style="width:' + Math.round(c.value * 100) + '%"></i></span>' +
        '<span class="val">' + c.contribution.toFixed(1) + "</span></div>";
    }).join("");

    var scope = (p.scope || []).slice(0, 240).map(function (a) {
      return '<span class="scope-item" title="' + esc(a.asset) + '">' + esc(a.asset) +
        '<span class="t">' + esc(a.type) + "</span></span>";
    }).join("");

    var more = (p.scope || []).length > 240
      ? '<div class="reason neutral">showing 240 of ' + nf(p.scope.length) + " assets</div>" : "";

    return '<div class="reasons">' + reasons + penalties + "</div>" +
      surfaceMix(p) +
      '<div class="bars">' + bars + "</div>" +
      '<div class="scope-head"><h4>In scope</h4>' +
        '<button class="btn sm ghost" data-copy="' + esc(p.id) + '">copy scope</button>' +
        '<a class="btn sm ghost" href="' + esc(p.url) + '" target="_blank" rel="noopener">open on HackerOne</a>' +
        '<span class="reason neutral">' + esc(p.badges.will_pay.why) + "</span>" +
      "</div>" +
      '<div class="scope-grid">' + (scope || '<span class="scope-item">no scope published</span>') + "</div>" + more;
  }

  /* ---------------- compare ---------------- */

  function toggleCompare(id) {
    if (state.compare.has(id)) state.compare.delete(id);
    else {
      if (state.compare.size >= MAX_COMPARE) return flashTray("Compare up to " + MAX_COMPARE + " at once");
      state.compare.add(id);
    }
    syncSelection();
    renderTray();
  }

  function syncSelection() {
    $$("input[data-sel]").forEach(function (cb) {
      cb.checked = state.compare.has(cb.getAttribute("data-sel"));
    });
    $$(".card").forEach(function (card) {
      var id = card.getAttribute("data-id");
      var on = state.compare.has(id);
      card.classList.toggle("picked", on);
      var btn = card.querySelector(".card-cmp");
      if (btn) {
        btn.classList.toggle("on", on);
        btn.textContent = on ? "Selected" : "+ Compare";
      }
    });
  }

  function renderTray() {
    var tray = $("#tray");
    var items = Array.from(state.compare).map(byId).filter(Boolean);
    tray.classList.toggle("show", items.length > 0);
    document.body.classList.toggle("tray-open", items.length > 0);
    $("#compare-count").textContent = items.length;
    $("#tray-items").innerHTML = items.map(function (p) {
      return '<span class="tray-item">' + esc(p.name) +
        '<button data-uncmp="' + esc(p.id) + '" aria-label="Remove">×</button></span>';
    }).join("");
    $("#open-compare").disabled = items.length < 2;
  }

  /** From a top-10 card: clear filters, expand that row and scroll to it. */
  function jumpTo(id) {
    if (state.quick !== "all" || state.search) {
      state.quick = "all";
      state.search = "";
      $("#search").value = "";
      $$(".quickchip").forEach(function (c) {
        c.classList.toggle("active", c.getAttribute("data-quick") === "all");
      });
      render();
    }
    var row = document.querySelector('.row[data-id="' + id + '"]');
    if (!row) return;
    if (!state.expanded[id]) { state.expanded[id] = true; row.classList.add("open"); }
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("flash");
    setTimeout(function () { row.classList.remove("flash"); }, 1200);
  }

  function flashTray(msg) {
    var label = $(".tray-label");
    if (!label) return;
    var old = label.textContent;
    label.textContent = msg;
    label.style.color = "var(--marigold)";
    setTimeout(function () {
      label.textContent = old;
      label.style.color = "";
    }, 1800);
  }

  var COMPARE_ROWS = [
    { label: "Score", get: function (p) { return p.score.total; }, fmt: function (v) { return v.toFixed(1); }, better: "high", delta: 0.5 },
    { label: "Reports / 90d", get: function (p) { return p.signals.reports_90d; }, fmt: nf, better: "low", delta: 2 },
    { label: "Scope assets", get: function (p) { return p.signals.scope_count; }, fmt: nf, better: "high", delta: 2 },
    { label: "Response eff.", get: function (p) { return p.signals.response_efficiency; }, fmt: pct, better: "high", delta: 1 },
    { label: "Paid 90d", get: function (p) { return p.signals.paid_90d; }, fmt: money, better: "high", delta: 100 },
    { label: "Age", get: function (p) { return p.signals.age_months; }, fmt: age, better: "low", delta: 1 },
    { label: "Crowding / asset / mo", get: function (p) { return p.derived.crowding_per_asset_month; }, fmt: function (v) { return v.toFixed(2); }, better: "low", delta: 0.05 },
    { label: "Slop risk", get: function (p) { return p.badges.slop.risk; }, fmt: function (v) { return v == null ? "—" : v.toFixed(2); }, better: "low", delta: 0.05 },
  ];

  /** Winner index, but only when it beats the runner-up by a meaningful margin. */
  function bestIndex(values, better, delta) {
    var best = -1, bestVal = null, second = null;
    values.forEach(function (v, i) {
      if (v == null) return;
      if (bestVal === null || (better === "high" ? v > bestVal : v < bestVal)) {
        second = bestVal;
        bestVal = v;
        best = i;
      } else if (second === null || (better === "high" ? v > second : v < second)) {
        second = v;
      }
    });
    if (best === -1 || second === null) return -1;
    var edge = better === "high" ? bestVal - second : second - bestVal;
    return edge > (delta || 0) ? best : -1;
  }

  function renderCompare() {
    var items = Array.from(state.compare).map(byId).filter(Boolean);
    if (items.length < 2) return;

    var head = '<thead><tr><th></th>' + items.map(function (p) {
      var s = p.signals;
      return "<th><div class=\"compare-thumb\">" +
        '<span class="ct-name">' + esc(p.name) + "</span>" +
        '<span class="ct-sub">HackerOne · ' + age(s.age_months) + " · " + nf(s.scope_count) + " assets</span>" +
        '<span class="badge ' + p.badges.will_pay.tier + '" style="margin-top:6px"><span class="dot"></span>' + esc(p.badges.will_pay.label) + "</span>" +
        "</div></th>";
    }).join("") + "</tr></thead>";

    var body = COMPARE_ROWS.map(function (row) {
      var values = items.map(row.get);
      var win = values.filter(function (v) { return v != null; }).length > 1 ? bestIndex(values, row.better, row.delta) : -1;
      return "<tr><th>" + esc(row.label) + "</th>" + values.map(function (v, i) {
        var cls = i === win ? ' class="best"' : "";
        return "<td" + cls + ">" + esc(v == null ? "—" : row.fmt(v)) + "</td>";
      }).join("") + "</tr>";
    }).join("");

    var mix = "<tr><th>Surface mix</th>" + items.map(function (p) {
      var c = window.HBE.surfaceCounts(p.scope);
      var keys = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, 3);
      return "<td>" + keys.map(function (k) { return '<span class="mixchip">' + esc(k) + " " + c[k] + "</span>"; }).join(" ") + "</td>";
    }).join("") + "</tr>";

    var pen = "<tr><th>Penalties</th>" + items.map(function (p) {
      var list = (p.score.penalties || []).map(function (x) { return x.reason; });
      return "<td>" + (list.length ? esc(list.join(", ")) : "—") + "</td>";
    }).join("") + "</tr>";

    $("#compare-body").innerHTML =
      '<div class="compare-scroll"><table class="compare-table">' + head +
      "<tbody>" + body + mix + pen + "</tbody></table></div>";
  }

  function openCompare() {
    if (state.compare.size < 2) return;
    renderCompare();
    $("#compare-modal").classList.add("open");
  }

  function closeCompare() { $("#compare-modal").classList.remove("open"); }

  function exportCsv() {
    var items = Array.from(state.compare).map(byId).filter(Boolean);
    var cols = ["name", "url", "score", "will_pay", "reports_90d", "scope_assets", "response_efficiency", "paid_90d", "age_months", "crowding", "slop_risk"];
    var lines = [cols.join(",")];
    items.forEach(function (p) {
      var row = [p.name, p.url, p.score.total, p.badges.will_pay.label, p.signals.reports_90d,
        p.signals.scope_count, p.signals.response_efficiency, p.signals.paid_90d,
        p.signals.age_months == null ? "" : p.signals.age_months.toFixed(1),
        p.derived.crowding_per_asset_month, p.badges.slop.risk];
      lines.push(row.map(function (v) {
        var s = String(v == null ? "" : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "honeybee-compare.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------------- events ---------------- */

  function bindEvents() {
    $("#search").addEventListener("input", function (e) {
      state.search = e.target.value.trim();
      render();
    });

    $("#sort").addEventListener("change", function (e) {
      state.sort = e.target.value;
      render();
    });

    $("#quick").addEventListener("click", function (e) {
      var chip = e.target.closest(".quickchip");
      if (!chip) return;
      state.quick = chip.getAttribute("data-quick");
      $$(".quickchip").forEach(function (c) { c.classList.toggle("active", c === chip); });
      render();
    });

    $("#list").addEventListener("click", function (e) {
      if (e.target.closest("a")) return;
      if (e.target.closest(".sel")) return;

      var copyBtn = e.target.closest("[data-copy]");
      if (copyBtn) {
        var prog = byId(copyBtn.getAttribute("data-copy"));
        if (prog) {
          var text = (prog.scope || []).map(function (a) { return a.asset; }).join("\n");
          navigator.clipboard.writeText(text);
          copyBtn.textContent = "copied";
          setTimeout(function () { copyBtn.textContent = "copy scope"; }, 1400);
        }
        return;
      }

      var row = e.target.closest(".row");
      if (!row) return;
      var id = row.getAttribute("data-id");
      state.expanded[id] = !state.expanded[id];
      row.classList.toggle("open");
    });

    $("#list").addEventListener("change", function (e) {
      var cb = e.target.closest("input[data-sel]");
      if (!cb) return;
      toggleCompare(cb.getAttribute("data-sel"));
    });

    $("#cards").addEventListener("click", function (e) {
      var btn = e.target.closest(".card-cmp");
      if (btn) { toggleCompare(btn.getAttribute("data-cmp")); return; }
      if (e.target.closest("a")) return;
      var card = e.target.closest(".card");
      if (card) jumpTo(card.getAttribute("data-id"));
    });

    $("#tray-items").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-uncmp]");
      if (btn) toggleCompare(btn.getAttribute("data-uncmp"));
    });

    $("#clear-compare").addEventListener("click", function () {
      state.compare.clear();
      syncSelection();
      renderTray();
    });

    $("#open-compare").addEventListener("click", openCompare);
    $("#close-compare").addEventListener("click", closeCompare);
    $("#compare-bg").addEventListener("click", closeCompare);
    $("#export-csv").addEventListener("click", exportCsv);

    $$(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        $$(".tab").forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        state.tab = tab.getAttribute("data-tab");
        render();
      });
    });

    $("#tune-btn").addEventListener("click", openModal);

    $$(".nav-links a[data-tab-link]").forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        var target = link.getAttribute("data-tab-link");
        var tab = document.querySelector('.tab[data-tab="' + target + '"]');
        if (tab) tab.click();
        $$(".nav-links a").forEach(function (a) { a.classList.remove("active"); });
        link.classList.add("active");
      });
    });

    $$("[data-close]").forEach(function (el) { el.addEventListener("click", closeModal); });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeModal(); closeCompare(); }
      if (e.key === "/" && document.activeElement !== $("#search")) {
        e.preventDefault();
        $("#search").focus();
      }
    });

    $("#save-profile").addEventListener("click", function () {
      saveProfile(readModal());
      closeModal();
      renderStats();
      renderTop10();
      render();
    });

    $("#reset-profile").addEventListener("click", function () {
      saveProfile(null);
      closeModal();
      renderStats();
      renderTop10();
      render();
    });
  }

  /* ---------------- profile modal ---------------- */

  var draft = null;

  function openModal() {
    draft = state.profile ? JSON.parse(JSON.stringify(state.profile)) : window.HBE.emptyProfile();
    buildSurfaceSliders();
    $("#hours").value = draft.constraints.hours_per_week;
    $("#hours-v").textContent = draft.constraints.hours_per_week;
    $("#session").value = draft.constraints.session_hours;
    $("#session-v").textContent = draft.constraints.session_hours + "h";
    $$("#goal-chips .chip").forEach(function (c) {
      c.classList.toggle("on", c.getAttribute("data-goal") === draft.preferences.goal);
    });
    $$("#tool-chips .chip").forEach(function (c) {
      c.classList.toggle("on", !!draft.constraints.tools[c.getAttribute("data-tool")]);
    });
    $("#modal").classList.add("open");
  }

  function closeModal() { $("#modal").classList.remove("open"); }

  function buildSurfaceSliders() {
    var labels = {
      web: "Web apps", api: "APIs", mobile: "Mobile", cloud: "Cloud",
      network: "Network / infra", source: "Source code", hardware: "Hardware",
      smart_contract: "Smart contracts", ai: "AI / LLM", other: "Other",
    };
    $("#surface-sliders").innerHTML = window.HBE.SURFACES.map(function (key) {
      var value = draft.capability.surfaces[key] || 0;
      return '<div class="slider" data-surface="' + key + '">' +
        "<span>" + esc(labels[key] || key) + "</span>" +
        '<input type="range" min="0" max="5" step="1" value="' + value + '">' +
        '<span class="sv">' + value + "</span></div>";
    }).join("");

    $$("#surface-sliders input").forEach(function (input) {
      input.addEventListener("input", function () {
        var wrap = input.closest(".slider");
        wrap.querySelector(".sv").textContent = input.value;
        draft.capability.surfaces[wrap.getAttribute("data-surface")] = Number(input.value);
      });
    });
  }

  function readModal() {
    draft.constraints.hours_per_week = Number($("#hours").value);
    draft.constraints.session_hours = Number($("#session").value);
    return draft;
  }

  document.addEventListener("input", function (e) {
    if (e.target.id === "hours") $("#hours-v").textContent = e.target.value;
    if (e.target.id === "session") $("#session-v").textContent = e.target.value + "h";
  });

  document.addEventListener("click", function (e) {
    var goal = e.target.closest("#goal-chips .chip");
    if (goal && draft) {
      $$("#goal-chips .chip").forEach(function (c) { c.classList.remove("on"); });
      goal.classList.add("on");
      draft.preferences.goal = goal.getAttribute("data-goal");
    }
    var tool = e.target.closest("#tool-chips .chip");
    if (tool && draft) {
      var key = tool.getAttribute("data-tool");
      tool.classList.toggle("on");
      draft.constraints.tools[key] = tool.classList.contains("on");
    }
  });

  init();
})();
