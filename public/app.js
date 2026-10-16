/* honeybee UI — vanilla JS, no build step */
(function () {
  "use strict";

  var PROFILE_KEY = "honeybee.profile.v1";

  var state = {
    programs: [],
    meta: null,
    tab: "ranked",
    search: "",
    pay: "all",
    sort: "fit",
    profile: null,
    expanded: {},
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
        $("#meta").textContent =
          nf(state.programs.length) + " programs · " + when(data.generated_at);
        var heroCount = $("#hero-count");
        if (heroCount) heroCount.textContent = nf(state.programs.length);
        $("#count-ranked").textContent = nf(state.programs.length);
        $("#count-catalog").textContent = "soon";
        renderStats();
        render();
      })
      .catch(function (err) {
        $("#list").innerHTML =
          '<div class="empty"><h3>Could not load data</h3><p>' +
          esc(err.message) +
          ". Run <code>python -m pipeline.run</code> then reload.</p></div>";
        $("#meta").textContent = "offline";
      });
  }

  function when(iso) {
    if (!iso) return "unknown";
    var d = new Date(iso);
    var mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    if (mins < 1440) return Math.round(mins / 60) + "h ago";
    return d.toISOString().slice(0, 10);
  }

  /* ---------------- profile storage ---------------- */

  function loadProfile() {
    try {
      var raw = localStorage.getItem(PROFILE_KEY);
      state.profile = raw ? JSON.parse(raw) : null;
    } catch (e) {
      state.profile = null;
    }
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
    if (window.HBE.hasProfile(state.profile)) {
      el.innerHTML = '<span class="profile-pill">tuned to you</span>';
    } else {
      el.innerHTML = "";
    }
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
      { k: "Median score", v: median.toFixed(1), s: "population, /100", cls: "" },
      { k: "Pays reliably", v: counts.green, s: "green tier", cls: "green" },
      { k: "Risky", v: counts.red, s: "failed or dormant", cls: "red" },
      {
        k: "Top match",
        v: top ? top.score.toFixed(1) : "—",
        s: top ? top.program.name.slice(0, 26) : "",
        cls: "accent",
      },
    ];

    $("#stats").innerHTML = stats
      .map(function (s) {
        return (
          '<div class="stat ' + (s.cls || "") + '">' +
          '<div class="k">' + esc(s.k) + "</div>" +
          '<div class="v">' + esc(s.v) + "</div>" +
          '<div class="s">' + esc(s.s) + "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  /* ---------------- list ---------------- */

  function currentRows() {
    var rows = window.HBE.rescore(state.programs, state.profile);

    if (state.pay !== "all") {
      rows = rows.filter(function (r) {
        return r.program.badges.will_pay.tier === state.pay;
      });
    }

    if (state.search) {
      var q = state.search.toLowerCase();
      rows = rows.filter(function (r) {
        var p = r.program;
        if (p.name.toLowerCase().indexOf(q) !== -1) return true;
        if (p.slug.indexOf(q) !== -1) return true;
        return (p.scope || []).some(function (a) {
          return a.asset.toLowerCase().indexOf(q) !== -1;
        });
      });
    }

    if (state.sort !== "fit") {
      var cmp = {
        lowcomp: function (a, b) {
          return a.program.derived.crowding_per_asset_month - b.program.derived.crowding_per_asset_month;
        },
        newest: function (a, b) {
          return (a.program.signals.age_months || 1e9) - (b.program.signals.age_months || 1e9);
        },
        payout: function (a, b) {
          return (b.program.signals.paid_90d || 0) - (a.program.signals.paid_90d || 0);
        },
        scope: function (a, b) {
          return (b.program.signals.scope_count || 0) - (a.program.signals.scope_count || 0);
        },
      }[state.sort];
      if (cmp) rows.sort(cmp);
    }

    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  function render() {
    if (state.tab === "catalog") {
      $("#controls").style.display = "none";
      $("#list").innerHTML =
        '<div class="empty"><h3>Catalog is next</h3>' +
        "<p>3,300+ programs from lissy93, rix4uni and arkadiyt — every field we have, " +
        "with explicit gaps. Nothing here is scored.</p></div>";
      return;
    }

    $("#controls").style.display = "flex";
    var rows = currentRows();

    if (!rows.length) {
      $("#list").innerHTML =
        '<div class="empty"><h3>No programs match</h3><p>Loosen the filters or clear the search.</p></div>';
      return;
    }

    $("#list").innerHTML = rows.map(rowHtml).join("");
    $("#foot").innerHTML =
      "<b>How this ranks:</b> novelty (t^.40 decay) · inverse crowding (reports per asset) · " +
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

    var sub = [
      "HackerOne",
      age(s.age_months),
      nf(s.scope_count) + " assets",
      slop.label !== "none" ? "slop " + slop.label : null,
    ].filter(Boolean).join(" · ");

    return (
      '<div class="row' + (open ? " open" : "") + '" data-id="' + esc(p.id) + '">' +
        '<div class="row-main">' +
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

  function detailHtml(p) {
    var reasons = (p.reasons || [])
      .map(function (r) {
        return '<span class="reason ' + r.sign + '">' + esc(r.text) + "</span>";
      })
      .join("");

    var bars = window.HBE.explain(p, state.profile)
      .map(function (c) {
        return (
          '<div class="barline">' +
            "<span>" + esc(c.label) + "</span>" +
            '<span class="track"><i class="' + (c.contribution >= 8 ? "hot" : "") +
              '" style="width:' + Math.round(c.value * 100) + '%"></i></span>' +
            '<span class="val">' + c.contribution.toFixed(1) + "</span>" +
          "</div>"
        );
      })
      .join("");

    var penalties = (p.score.penalties || [])
      .map(function (x) {
        return '<span class="reason bad">−' + Math.abs(x.points) + " " + esc(x.reason) + "</span>";
      })
      .join("");

    var scope = (p.scope || []).slice(0, 240)
      .map(function (a) {
        return (
          '<span class="scope-item" title="' + esc(a.asset) + '">' +
            esc(a.asset) +
            '<span class="t">' + esc(a.type) + "</span>" +
          "</span>"
        );
      })
      .join("");

    var scopeNote = (p.scope || []).length > 240
      ? '<div class="reason neutral">showing 240 of ' + nf(p.scope.length) + " assets</div>"
      : "";

    return (
      '<div class="reasons">' + reasons + penalties + "</div>" +
      '<div class="bars">' + bars + "</div>" +
      '<div class="scope-head"><h4>In scope</h4>' +
        '<a class="btn sm ghost" href="' + esc(p.url) + '" target="_blank" rel="noopener">open on HackerOne</a>' +
        '<span class="reason neutral">' + esc(p.badges.will_pay.why) + "</span>" +
      "</div>" +
      '<div class="scope-grid">' + (scope || '<span class="scope-item">no scope published</span>') + "</div>" +
      scopeNote
    );
  }

  /* ---------------- events ---------------- */

  function bindEvents() {
    $("#search").addEventListener("input", function (e) {
      state.search = e.target.value.trim();
      render();
    });

    $("#filter-pay").addEventListener("change", function (e) {
      state.pay = e.target.value;
      render();
    });

    $("#sort").addEventListener("change", function (e) {
      state.sort = e.target.value;
      render();
    });

    $("#list").addEventListener("click", function (e) {
      if (e.target.closest("a")) return;
      var row = e.target.closest(".row");
      if (!row) return;
      var id = row.getAttribute("data-id");
      state.expanded[id] = !state.expanded[id];
      row.classList.toggle("open");
    });

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
    $$("[data-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    $("#save-profile").addEventListener("click", function () {
      saveProfile(readModal());
      closeModal();
      renderStats();
      render();
    });

    $("#reset-profile").addEventListener("click", function () {
      saveProfile(null);
      closeModal();
      renderStats();
      render();
    });
  }

  /* ---------------- modal ---------------- */

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

  function closeModal() {
    $("#modal").classList.remove("open");
  }

  function buildSurfaceSliders() {
    var labels = {
      web: "Web apps",
      api: "APIs",
      mobile: "Mobile",
      cloud: "Cloud",
      network: "Network / infra",
      source: "Source code",
      hardware: "Hardware",
      smart_contract: "Smart contracts",
      ai: "AI / LLM",
      other: "Other",
    };

    $("#surface-sliders").innerHTML = window.HBE.SURFACES.map(function (key) {
      var value = draft.capability.surfaces[key] || 0;
      return (
        '<div class="slider" data-surface="' + key + '">' +
          "<span>" + esc(labels[key] || key) + "</span>" +
          '<input type="range" min="0" max="5" step="1" value="' + value + '">' +
          '<span class="sv">' + value + "</span>" +
        "</div>"
      );
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
