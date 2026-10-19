/* honeybe UI - vanilla JS, no build step */
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
    catalog: [],
    catalogMeta: null,
    catalogPlatform: "all",
    catalogIncludeScored: false,
    catSort: "best",
    surfaces: new Set(),
    news: [],
    gapCache: null,
  };

  var $ = function (sel) {
    return document.querySelector(sel);
  };
  var $$ = function (sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  function nf(value) {
    if (value == null) return "-";
    return Number(value).toLocaleString();
  }

  function money(value) {
    if (value == null) return "-";
    if (value >= 1e6) return "$" + (value / 1e6).toFixed(1) + "M";
    if (value >= 1e3) return "$" + Math.round(value / 1e3) + "k";
    return "$" + Math.round(value);
  }

  function age(months) {
    if (months == null) return "-";
    if (months < 12) return Math.round(months) + "mo";
    return (months / 12).toFixed(1) + "y";
  }

  function pct(value) {
    return value == null ? "-" : Math.round(value) + "%";
  }

  function byId(id) {
    return (
      state.programs.filter(function (p) {
        return p.id === id;
      })[0] || null
    );
  }

  /* ---------------- boot ---------------- */

  function init() {
    loadProfile();
    bindEvents();
    tickClock();
    bumpVisits();
    maybeOnboard();
    fetch("data/programs.json")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.programs = data.programs || [];
        state.meta = data;
        $("#meta").textContent =
          nf(state.programs.length) +
          " programs · updated " +
          when(data.generated_at);
        ["#hero-count", "#hero-count-2"].forEach(function (sel) {
          var el = $(sel);
          if (el) el.textContent = nf(state.programs.length);
        });
        $("#count-ranked").textContent = nf(state.programs.length);
        $("#count-catalog").textContent = "soon";
        renderSurfaceCounts();
        collapseMobileFilters();
        renderStats();
        renderTop10();
        render();
        renderRail();
        loadCatalog();
        loadNews();
        applyHash();
      })
      .catch(function (err) {
        $("#list").innerHTML =
          '<div class="empty"><h3>Could not load data</h3><p>' +
          esc(err.message) +
          ". Run <code>python -m pipeline.run</code> then reload.</p></div>";
        $("#meta").textContent = "offline";
      });
  }

  function loadNews() {
    fetch("data/events.json")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (payload) {
        state.news = (payload && payload.events) || [];
        state.newsMeta = payload || null;
        var dot = $("#news-dot");
        if (dot) dot.hidden = state.news.length === 0;
        var btn = $("#news-btn");
        if (btn)
          btn.title = state.news.length
            ? state.news.length +
              (state.news.length === 1 ? " change" : " changes") +
              " since the last crawls"
            : "What's new";
        var modal = $("#news-modal");
        if (modal && modal.classList.contains("open")) renderNews();
      })
      .catch(function () {
        /* the feed is optional */
      });
  }

  var NEWS_META = {
    new_program: { label: "New program", icon: "+", cls: "green" },
    new_catalog_program: { label: "New in catalog", icon: "+", cls: "amber" },
    new_asset: { label: "New scope", icon: "+", cls: "blue" },
    scope_updated: { label: "Scope updated", icon: "±", cls: "blue" },
    removed_asset: { label: "Scope removed", icon: "−", cls: "red" },
  };

  function renderNews() {
    var body = $("#news-body");
    var sub = $("#news-sub");
    var events = state.news || [];
    if (sub) {
      sub.textContent = events.length
        ? events.length +
          (events.length === 1 ? " change" : " changes") +
          " across recent crawls"
        : "";
    }
    if (!body) return;
    if (!events.length) {
      body.innerHTML =
        '<div class="news-empty"><h3>No changes recorded yet</h3>' +
        "<p>honeybe compares every crawl with the previous one. New programs, new scope assets and removed scope will appear here from the next run.</p>" +
        '<p class="hint">The first crawl is a baseline. That is deliberate: it avoids presenting 2,900 existing programs as if they were new.</p></div>';
      return;
    }
    body.innerHTML = events
      .map(function (e) {
        var meta = NEWS_META[e.type] || {
          label: "Update",
          icon: "•",
          cls: "blue",
        };
        var href = e.url || "app.html";
        return (
          '<a class="news-item" href="' +
          esc(href) +
          '" target="_blank" rel="noopener">' +
          '<span class="news-ico ' +
          meta.cls +
          '">' +
          meta.icon +
          "</span>" +
          '<span class="news-text"><b>' +
          esc(e.name || e.id || "Program") +
          "</b><small>" +
          meta.label +
          (e.detail ? " · " + esc(e.detail) : "") +
          "</small></span>" +
          '<span class="news-time">' +
          esc(when(e.at)) +
          "</span>" +
          "</a>"
        );
      })
      .join("");
  }

  function openNews() {
    renderNews();
    $("#news-modal").classList.add("open");
    document.body.classList.add("modal-open");
  }

  function closeNews() {
    var el = $("#news-modal");
    if (!el) return;
    el.classList.remove("open");
    document.body.classList.remove("modal-open");
  }

  function applyHash() {
    var hash = (window.location.hash || "").replace("#", "");
    if (hash === "catalog" && state.tab !== "catalog") {
      setTab("catalog");
    }
    if (hash === "news") {
      openNews();
    }
  }

  function maybeOnboard() {
    var modal = $("#onboard");
    if (!modal) return;
    var seen = false;
    try {
      seen = !!localStorage.getItem("honeybee.onboarded");
    } catch (e) {}
    if (state.profile || seen) return;
    modal.classList.add("open");
  }

  function loadCatalog() {
    fetch("data/catalog.json")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (cat) {
        if (!cat) return;
        state.catalog = cat.programs || [];
        state.catalogMeta = cat;
        var m = $("#method-count");
        if (m) m.textContent = nf(state.programs.length);
        var cc = $("#count-catalog");
        if (cc) cc.textContent = nf(state.catalog.length);
        renderCoverageFigure();
        if (state.tab === "catalog") render();
      })
      .catch(function () {
        /* catalog is optional, ranking still works */
      });
  }

  function closeOnboard() {
    $("#onboard").classList.remove("open");
    try {
      localStorage.setItem("honeybee.onboarded", "1");
    } catch (e) {}
  }

  function when(iso) {
    if (!iso) return "unknown";
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    if (mins < 1440) return Math.round(mins / 60) + "h ago";
    return iso.slice(0, 10);
  }

  function tickClock() {
    var el = $("#clock");
    if (!el) return;
    var d = new Date();
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    el.textContent =
      pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    setTimeout(tickClock, 1000);
  }

  function bumpVisits() {
    var el = $("#visit-count");
    if (!el) return;
    var n = 1;
    try {
      n = Number(localStorage.getItem("honeybee.visits") || "0") + 1;
      localStorage.setItem("honeybee.visits", String(n));
    } catch (e) {
      /* private mode */
    }
    el.textContent = String(n).padStart(6, "0");
  }

  /* ---------------- profile ---------------- */

  function loadProfile() {
    try {
      var raw = localStorage.getItem(PROFILE_KEY);
      state.profile = raw ? window.HBE.migrateProfile(JSON.parse(raw)) : null;
    } catch (e) {
      state.profile = null;
    }
  }

  function saveProfile(profile) {
    state.profile = profile;
    state.gapCache = null;
    try {
      if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      else localStorage.removeItem(PROFILE_KEY);
    } catch (e) {
      /* private mode */
    }
  }

  /* ---------------- stats ---------------- */

  function renderStats() {
    var rows = window.HBE.rescore(state.programs, state.profile);
    var scores = rows.map(function (r) {
      return r.score;
    });
    var median = scores[Math.floor(scores.length / 2)] || 0;

    var counts = { green: 0, yellow: 0, red: 0, unknown: 0 };
    state.programs.forEach(function (p) {
      counts[p.badges.will_pay.tier] =
        (counts[p.badges.will_pay.tier] || 0) + 1;
    });

    var top = rows[0];
    var stats = [
      {
        k: "Programs scored",
        v: nf(state.programs.length),
        s: "HackerOne · paid + open",
      },
      { k: "Median score", v: median.toFixed(1), s: "population, /100" },
      {
        k: "Pays reliably",
        v: counts.green,
        s: "response + payout proof",
        cls: "green",
      },
      { k: "Risky", v: counts.red, s: "failed or dormant", cls: "red" },
      {
        k: "Top match",
        v: top ? top.score.toFixed(1) : "-",
        s: top ? top.program.name.slice(0, 24) : "",
        cls: "accent",
      },
    ];

    $("#stats").innerHTML = stats
      .map(function (s) {
        return (
          '<div class="stat ' +
          (s.cls || "") +
          '">' +
          '<div class="k">' +
          esc(s.k) +
          "</div>" +
          '<div class="v">' +
          esc(s.v) +
          "</div>" +
          '<div class="s">' +
          esc(s.s) +
          "</div></div>"
        );
      })
      .join("");

    var total = state.programs.length || 1;
    var bar = $("#tierbar");
    if (bar) {
      bar.innerHTML = ["green", "yellow", "red", "unknown"]
        .map(function (t) {
          return (
            '<i class="t-' +
            t +
            '" style="width:' +
            ((counts[t] || 0) / total) * 100 +
            '%"></i>'
          );
        })
        .join("");
    }

    var legend = $("#tierlegend");
    if (legend) {
      var meta = {
        green: ["Pays reliably", "#34a853"],
        yellow: ["Pays slowly / missed", "#fbbc04"],
        red: ["Risky", "#ea4335"],
        unknown: ["Not enough signal", "var(--border)"],
      };
      legend.innerHTML = ["green", "yellow", "red", "unknown"]
        .map(function (t) {
          return (
            '<span><i style="background:' +
            meta[t][1] +
            '"></i>' +
            meta[t][0] +
            " <b>" +
            (counts[t] || 0) +
            "</b></span>"
          );
        })
        .join("");
    }

    updateChipCounts();
  }

  function updateChipCounts() {
    var keys = [
      "all",
      "green",
      "missed",
      "red",
      "lowcomp",
      "fresh",
      "bigscope",
    ];
    var n = { all: state.programs.length };
    keys.slice(1).forEach(function (k) {
      n[k] = state.programs.filter(function (p) {
        return quickMatch(p, k);
      }).length;
    });
    keys.forEach(function (k) {
      var el = document.querySelector('[data-cnt="' + k + '"]');
      if (el) el.textContent = nf(n[k]);
    });
  }

  /* ---------------- top 10 ---------------- */

  function renderTop10() {
    var rows = window.HBE.rescore(state.programs, state.profile).slice(0, 10);
    var personalised = window.HBE.hasProfile(state.profile);
    var note = $("#top10-note");
    if (note) {
      note.textContent = personalised
        ? "personalised · " +
          Math.round(window.HBE.completeness(state.profile) * 100) +
          "% strength · moves a score by at most ±" +
          window.HBE.MAX_DELTA
        : "population ranking · add a profile to personalise";
    }

    $("#cards").innerHTML = rows
      .map(function (row) {
        var p = row.program;
        var s = p.signals;
        var on = state.compare.has(p.id);
        return (
          '<article class="card' +
          (row.rank <= 3 ? " top" : "") +
          (on ? " picked" : "") +
          '" data-id="' +
          esc(p.id) +
          '">' +
          '<div class="card-top">' +
          '<span class="card-rank">' +
          String(row.rank).padStart(2, "0") +
          "</span>" +
          '<span class="badge ' +
          p.badges.will_pay.tier +
          '"><span class="dot"></span>' +
          esc(p.badges.will_pay.label) +
          "</span>" +
          "</div>" +
          '<h3 class="card-name"><a href="' +
          esc(p.url) +
          '" target="_blank" rel="noopener">' +
          esc(p.name) +
          "</a></h3>" +
          '<div class="card-sub">HackerOne · ' +
          age(s.age_months) +
          " · " +
          nf(s.scope_count) +
          " assets</div>" +
          '<div class="card-score">' +
          '<span class="card-num">' +
          row.score.toFixed(1) +
          "</span>" +
          '<span class="card-bar"><i style="width:' +
          Math.min(100, row.score) +
          '%"></i></span>' +
          '<span class="card-pct">top ' +
          Math.max(1, Math.round(100 - row.percentile)) +
          "%</span>" +
          "</div>" +
          '<dl class="card-metrics">' +
          "<div><dt>Reports / 90d</dt><dd>" +
          nf(s.reports_90d) +
          "</dd></div>" +
          "<div><dt>Response</dt><dd>" +
          pct(s.response_efficiency) +
          "</dd></div>" +
          "<div><dt>Paid 90d</dt><dd>" +
          money(s.paid_90d) +
          "</dd></div>" +
          "</dl>" +
          '<div class="card-foot">' +
          '<button class="card-cmp' +
          (on ? " on" : "") +
          '" data-cmp="' +
          esc(p.id) +
          '">' +
          (on ? "Selected" : "Compare") +
          "</button>" +
          '<a class="card-open" href="' +
          esc(p.url) +
          '" target="_blank" rel="noopener">HackerOne ↗</a>' +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  /* ---------------- list ---------------- */

  function quickMatch(p, key) {
    var s = p.signals;
    switch (key) {
      case "green":
        return p.badges.will_pay.tier === "green";
      case "missed":
        return p.badges.will_pay.label === "Missed targets";
      case "red":
        return p.badges.will_pay.tier === "red";
      case "lowcomp":
        return p.derived.crowding_per_asset_month < 0.5;
      case "fresh":
        return (s.age_months == null ? 999 : s.age_months) < 12;
      case "bigscope":
        return (s.scope_count || 0) >= 100;
      default:
        return true;
    }
  }

  function currentRows() {
    var rows = window.HBE.rescore(state.programs, state.profile);

    rows = rows.filter(function (r) {
      return quickMatch(r.program, state.quick);
    });

    if (state.surfaces.size) {
      rows = rows.filter(function (r) {
        var counts = window.HBE.surfaceCounts(r.program.scope);
        return Object.keys(counts).some(function (k) {
          return state.surfaces.has(k);
        });
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
          return (
            a.program.derived.crowding_per_asset_month -
            b.program.derived.crowding_per_asset_month
          );
        },
        newest: function (a, b) {
          return (
            (a.program.signals.age_months || 1e9) -
            (b.program.signals.age_months || 1e9)
          );
        },
        payout: function (a, b) {
          return (
            (b.program.signals.paid_90d || 0) -
            (a.program.signals.paid_90d || 0)
          );
        },
        scope: function (a, b) {
          return (
            (b.program.signals.scope_count || 0) -
            (a.program.signals.scope_count || 0)
          );
        },
      }[state.sort];
      if (cmp) rows.sort(cmp);
    }

    rows.forEach(function (r, i) {
      r.rank = i + 1;
    });
    return rows;
  }

  function renderSurfaceCounts() {
    var counts = {};
    state.programs.forEach(function (p) {
      var c = window.HBE.surfaceCounts(p.scope);
      Object.keys(c).forEach(function (k) {
        counts[k] = (counts[k] || 0) + 1;
      });
    });
    $$("[data-scnt]").forEach(function (el) {
      var k = el.getAttribute("data-scnt");
      el.textContent = counts[k] ? nf(counts[k]) : "0";
    });
  }

  function updateSurfaceClear() {
    var btn = $("#clear-surfaces");
    if (btn) btn.hidden = state.surfaces.size === 0;
  }

  function collapseMobileFilters() {
    try {
      if (!window.matchMedia("(max-width: 860px)").matches) return;
      var host = $("#surface-filter");
      var block = host && host.closest("details");
      if (block) block.open = false;
    } catch (e) {}
  }

  function setTab(name) {
    state.tab = name;
    $$("[data-tab-link]").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-tab-link") === name);
    });
    var crumb = $("#crumb-current");
    if (crumb) crumb.textContent = name === "catalog" ? "Catalog" : "Programs";
    render();
    window.scrollTo(0, 0);
  }

  var PLATFORM_LABEL = {
    hackerone: "HackerOne",
    bugcrowd: "Bugcrowd",
    intigriti: "Intigriti",
    yeswehack: "YesWeHack",
    platform: "Platform",
    direct: "Direct",
  };

  var RANKED_SUMMARY = null;

  function syncChrome(isCatalog) {
    if (!RANKED_SUMMARY) {
      var body = $("#page-summary-body");
      RANKED_SUMMARY = body ? body.innerHTML : "";
    }
    var h1 = $(".h1-row h1");
    if (h1) {
      h1.textContent = isCatalog
        ? "Every program we can find"
        : "Programs that actually pay";
    }
    var section = $("#crumb-section");
    var current = $("#crumb-current");
    var hero = $("#hero-count-wrap");
    var toc = $("#toc-list");
    var summary = $("#page-summary-body");

    if (isCatalog) {
      if (section) {
        section.textContent = "Catalog";
        section.setAttribute("href", "#catalog");
      }
      if (current) current.textContent = "All programs";
      if (hero) {
        hero.innerHTML =
          "Catalog programs: <b>" + nf(state.catalog.length) + "</b>";
      }
      if (toc) {
        toc.innerHTML =
          '<li><a href="#catalog">Catalog</a></li>' +
          '<li><a href="#cat-top">Catalog top 10</a></li>' +
          '<li><a href="#cat-latest">Latest additions</a></li>' +
          '<li><a href="#cat-all">All catalog programs</a></li>';
      }
      if (summary) {
        summary.innerHTML =
          "<p>The Catalog lists <b>" +
          nf(state.catalog.length) +
          " programs</b> across HackerOne, Bugcrowd, Intigriti, YesWeHack, platform and direct sources.</p>" +
          "<p>Rows are ordered, never scored. Missing fields are printed as unknown, and every row carries a coverage percentage. Use the Catalog for breadth, then check the program's own policy before you hunt.</p>";
      }
    } else {
      if (section) {
        section.textContent = "Ranked";
        section.setAttribute("href", "#top10");
      }
      if (current) current.textContent = "Programs";
      if (hero) {
        hero.innerHTML =
          'Scored programs: <b id="hero-count">' +
          nf(state.programs.length) +
          "</b>";
      }
      if (toc) {
        toc.innerHTML =
          '<li><a href="#snapshot">Snapshot</a></li>' +
          '<li><a href="#top10">Your top 10</a></li>' +
          '<li><a href="#all">All programs</a></li>';
      }
      if (summary) summary.innerHTML = RANKED_SUMMARY;
    }
  }

  function render() {
    var isCatalog = state.tab === "catalog";
    syncChrome(isCatalog);
    var ranked = $("#ranked-view");
    var catalog = $("#catalog-view");
    if (ranked) ranked.style.display = isCatalog ? "none" : "";
    if (catalog) catalog.style.display = isCatalog ? "" : "none";

    if (isCatalog) {
      $("#controls").style.display = "none";
      $("#quick").style.display = "none";
      var sortBlock = $("#sort-block");
      if (sortBlock) sortBlock.style.display = "none";
      renderCatalog();
      renderRail();
      return;
    }

    $("#controls").style.display = "flex";
    $("#quick").style.display = "flex";
    var sortBlockBack = $("#sort-block");
    if (sortBlockBack) sortBlockBack.style.display = "";

    var rows = currentRows();
    var countEl = $("#count-ranked");
    if (countEl)
      countEl.textContent =
        nf(rows.length) +
        (rows.length !== state.programs.length
          ? "/" + nf(state.programs.length)
          : "");

    if (!rows.length) {
      $("#list").innerHTML =
        '<div class="empty"><h3>No programs match</h3><p>Loosen the filters or clear the search.</p></div>';
      renderRail();
      return;
    }

    $("#list").innerHTML = rows.map(rowHtml).join("");
    renderRail();
  }

  /* ---------------- catalog ---------------- */

  function renderCatalog() {
    var all = state.catalog || [];
    var list = $("#cat-list");
    if (!list) return;

    if (!all.length) {
      list.innerHTML =
        '<div class="empty"><h3>Catalog not generated yet</h3>' +
        "<p>Run <code>python -m pipeline.run</code> to build data/catalog.json.</p></div>";
      $("#cat-cards").innerHTML = "";
      $("#cat-count").textContent = "";
      return;
    }

    var counts = (state.catalogMeta && state.catalogMeta.counts) || {};
    var by = counts.by_platform || {};
    var sortEl = $("#cat-sort");
    if (sortEl && sortEl.value !== state.catSort) sortEl.value = state.catSort;
    $("#cat-intro").textContent =
      nf(all.length) +
      " programs from " +
      Object.keys(by).length +
      " sources. " +
      nf(counts.with_scope) +
      " publish scope and " +
      nf(counts.with_payout) +
      " state a maximum payout. Rows marked scored also appear in Ranked; everything else is catalog only. Sources are the arkadiyt mirrors for HackerOne, Bugcrowd, Intigriti and YesWeHack, plus the lissy93 lists for platform and direct programs. Duplicates are merged on platform and slug.";

    var platforms = [["all", "All", all.length]].concat(
      Object.keys(by)
        .sort()
        .map(function (k) {
          return [k, PLATFORM_LABEL[k] || k, by[k]];
        }),
    );
    $("#cat-chips").innerHTML =
      platforms
        .map(function (p) {
          var active = state.catalogPlatform === p[0] ? " active" : "";
          return (
            '<button class="cat-chip' +
            active +
            '" data-cat="' +
            p[0] +
            '">' +
            esc(p[1]) +
            " <span>" +
            nf(p[2]) +
            "</span></button>"
          );
        })
        .join("") +
      '<button class="cat-chip toggle' +
      (state.catalogIncludeScored ? " active" : "") +
      '" data-toggle="scored">Include scored <span>' +
      nf(
        all.filter(function (p) {
          return p.scored;
        }).length,
      ) +
      "</span></button>";

    var q = (state.search || "").toLowerCase();
    var rows = all.filter(function (p) {
      if (
        state.catalogPlatform !== "all" &&
        p.platform !== state.catalogPlatform
      )
        return false;
      if (!state.catalogIncludeScored && p.scored) return false;
      if (!q) return true;
      if (p.name.toLowerCase().indexOf(q) !== -1) return true;
      if (p.platform.indexOf(q) !== -1) return true;
      return (p.scope_types || []).some(function (t) {
        return t.indexOf(q) !== -1;
      });
    });
    rows.sort(catComparator(state.catSort));

    var latest = rows.slice().sort(catComparator("latest")).slice(0, 10);
    if (counts.baseline) {
      $("#cat-latest-note").textContent =
        "Day one baseline: every catalog program was first seen on the same crawl, so this list is not yet a change feed. From the next crawl it lists programs honeybe is seeing for the first time.";
    } else {
      $("#cat-latest-note").textContent =
        nf(counts.new_since_last) +
        " programs are new since the last crawl. First seen means first seen by honeybe, not the program launch date, because none of the catalog sources publish one.";
    }
    $("#cat-latest").innerHTML = latest.map(catLatestRow).join("");

    var top = all
      .filter(function (p) {
        if (p.scored) return false;
        return (
          state.catalogPlatform === "all" ||
          p.platform === state.catalogPlatform
        );
      })
      .slice(0, 10);

    $("#cat-cards").innerHTML = top
      .map(function (p, i) {
        return catCard(p, i);
      })
      .join("");
    $("#cat-top-note").textContent = q
      ? "Search is active. Clear the search box to see the catalog top 10."
      : "Ordered on scope size, stated bounties and disclosure terms, using only the fields we have. This is an ordering, not a payout prediction. Programs already scored in Ranked are excluded here.";

    $("#cat-count").textContent =
      nf(rows.length) +
      " programs" +
      (q ? ' matching "' + state.search + '"' : "") +
      (state.catalogPlatform !== "all"
        ? " in " +
          (PLATFORM_LABEL[state.catalogPlatform] || state.catalogPlatform)
        : "") +
      (rows.length > 400 ? ". Showing the first 400 in this order." : ".") +
      (state.catalogIncludeScored
        ? ""
        : " " +
          nf(
            all.filter(function (p) {
              return p.scored;
            }).length,
          ) +
          " scored programs are hidden.");

    list.innerHTML = rows.slice(0, 400).map(catRow).join("");
  }

  function catCard(p, index) {
    var types =
      (p.scope_types || []).slice(0, 3).join(", ") || "scope not published";
    return (
      '<article class="card">' +
      '<div class="card-top">' +
      '<span class="card-rank">' +
      String(index + 1).padStart(2, "0") +
      "</span>" +
      '<span class="cat-plat">' +
      esc(PLATFORM_LABEL[p.platform] || p.platform) +
      "</span>" +
      "</div>" +
      '<h3 class="card-name"><a href="' +
      esc(p.url) +
      '" target="_blank" rel="noopener">' +
      esc(p.name) +
      "</a></h3>" +
      '<div class="card-sub">' +
      esc(types) +
      "</div>" +
      '<div class="card-score">' +
      '<span class="card-num">' +
      p.catalog_score.toFixed(1) +
      "</span>" +
      '<span class="card-bar"><i style="width:' +
      Math.min(100, p.catalog_score) +
      '%"></i></span>' +
      '<span class="card-pct">coverage ' +
      p.coverage_pct +
      "%</span>" +
      "</div>" +
      '<dl class="card-metrics">' +
      "<div><dt>Scope</dt><dd>" +
      nf(p.scope_count) +
      "</dd></div>" +
      "<div><dt>Bounty</dt><dd>" +
      (p.offers_bounty === true
        ? "yes"
        : p.offers_bounty === false
          ? "no"
          : "unknown") +
      "</dd></div>" +
      "<div><dt>Max payout</dt><dd>" +
      (p.max_payout ? money(p.max_payout) : "unknown") +
      "</dd></div>" +
      "</dl>" +
      '<div class="card-foot">' +
      '<span class="badge unknown">catalog only</span>' +
      '<a class="card-open" href="' +
      esc(p.url) +
      '" target="_blank" rel="noopener">Open</a>' +
      "</div>" +
      "</article>"
    );
  }

  function catComparator(kind) {
    return function (a, b) {
      if (kind === "latest") {
        var d = (b.first_seen || "").localeCompare(a.first_seen || "");
        return d || a.catalog_rank - b.catalog_rank;
      }
      if (kind === "scope") {
        return (
          (b.scope_count || 0) - (a.scope_count || 0) ||
          a.catalog_rank - b.catalog_rank
        );
      }
      if (kind === "payout") {
        return (
          (b.max_payout || 0) - (a.max_payout || 0) ||
          a.catalog_rank - b.catalog_rank
        );
      }
      if (kind === "name") return a.name.localeCompare(b.name);
      return a.catalog_rank - b.catalog_rank;
    };
  }

  function catLatestRow(p) {
    return (
      '<div class="catrow latest">' +
      '<div class="catname"><a href="' +
      esc(p.url) +
      '" target="_blank" rel="noopener">' +
      esc(p.name) +
      "</a>" +
      (p.new ? ' <span class="cat-new">new</span>' : "") +
      "</div>" +
      '<div class="catplat">' +
      esc(PLATFORM_LABEL[p.platform] || p.platform) +
      "</div>" +
      '<div class="catseen">first seen ' +
      esc(p.first_seen || "-") +
      "</div>" +
      '<div class="catnum">' +
      nf(p.scope_count) +
      " assets</div>" +
      '<div class="catcov">' +
      p.coverage_pct +
      "% known</div>" +
      "</div>"
    );
  }

  function renderCoverageFigure() {
    var el = $("#covbars");
    if (!el) return;
    var meta = state.catalogMeta;
    if (!meta) return;
    var c = meta.counts || {};
    var by = c.by_platform || {};
    var keys = Object.keys(by).sort(function (a, b) {
      return by[b] - by[a];
    });
    var max = keys.length ? by[keys[0]] : 1;
    var total = c.total || 1;
    el.innerHTML =
      keys
        .map(function (k) {
          return (
            '<div class="covbar"><span>' +
            esc(PLATFORM_LABEL[k] || k) +
            '</span><i style="width:' +
            Math.max(2, Math.round((100 * by[k]) / max)) +
            '%"></i><b>' +
            nf(by[k]) +
            "</b></div>"
          );
        })
        .join("") +
      '<div class="cov-split">' +
      nf(c.total) +
      " rows · " +
      nf(c.with_scope) +
      " publish scope (" +
      Math.round((100 * c.with_scope) / total) +
      "%) · " +
      nf(c.with_payout) +
      " state a max payout (" +
      Math.round((100 * c.with_payout) / total) +
      "%). The rest is printed as unknown.</div>";
  }

  function catRow(p) {
    var types = (p.scope_types || []).join(", ") || "-";
    return (
      '<div class="catrow">' +
      '<div class="catname"><a href="' +
      esc(p.url) +
      '" target="_blank" rel="noopener">' +
      esc(p.name) +
      "</a>" +
      (p.new ? ' <span class="cat-new">new</span>' : "") +
      (p.scored ? ' <span class="cat-scored">scored</span>' : "") +
      "</div>" +
      '<div class="catplat">' +
      esc(PLATFORM_LABEL[p.platform] || p.platform) +
      "</div>" +
      '<div class="catnum">' +
      nf(p.scope_count) +
      "</div>" +
      '<div class="cattypes">' +
      esc(types) +
      "</div>" +
      '<div class="catnum">' +
      (p.offers_bounty === true
        ? "bounty"
        : p.offers_bounty === false
          ? "VDP"
          : "-") +
      "</div>" +
      '<div class="catnum">' +
      (p.max_payout ? money(p.max_payout) : "-") +
      "</div>" +
      '<div class="catcov">' +
      p.coverage_pct +
      "%</div>" +
      "</div>"
    );
  }

  /* ---------------- right rail ---------------- */

  function renderRail() {
    var el = $("#rail-stats");
    if (el) {
      var rows = window.HBE.rescore(state.programs, state.profile);
      var scores = rows.map(function (r) {
        return r.score;
      });
      var median = scores.length ? scores[Math.floor(scores.length / 2)] : 0;
      var green = state.programs.filter(function (p) {
        return p.badges.will_pay.tier === "green";
      }).length;
      var assets = state.programs.reduce(function (n, p) {
        return n + (p.signals.scope_count || 0);
      }, 0);
      var fresh = state.programs.filter(function (p) {
        return (p.signals.age_months || 999) < 12;
      }).length;
      var top = rows[0];
      el.innerHTML = [
        ["Programs", nf(state.programs.length)],
        ["Median score", median.toFixed(1)],
        ["Pays reliably", nf(green)],
        ["Scope assets", nf(assets)],
        ["Opened < 12mo", nf(fresh)],
        ["Top match", top ? top.program.name : "-"],
        ["Updated", state.meta ? when(state.meta.generated_at) : "-"],
      ]
        .map(function (r) {
          return (
            '<div class="rail-stat"><span class="lbl">' +
            esc(r[0]) +
            '</span><span class="val">' +
            esc(r[1]) +
            "</span></div>"
          );
        })
        .join("");
    }
    renderRailCompare();
    renderGaps();
  }

  function renderGaps() {
    var block = $("#rail-gap-block");
    if (!block) return;
    var el = $("#rail-gaps");
    if (!el) return;

    if (!window.HBE.hasProfile(state.profile)) {
      block.style.display = "none";
      state.gapCache = null;
      return;
    }
    block.style.display = "";

    if (!state.gapCache && state.programs.length) {
      state.gapCache = window.HBE.skillGap(state.programs, state.profile);
    }
    var gaps = state.gapCache || [];

    if (!gaps.length) {
      el.innerHTML =
        '<p class="rail-empty">No clear gaps left. Practice what you already know.</p>';
      return;
    }

    el.innerHTML = gaps
      .map(function (g) {
        return (
          '<div class="gap-item">' +
          '<div class="gap-head"><b>' +
          esc(g.surface) +
          "</b> → 3/5</div>" +
          '<div class="gap-body">' +
          g.count +
          " program" +
          (g.count === 1 ? "" : "s") +
          " would enter your top 50 · median " +
          g.median.toFixed(1) +
          "</div>" +
          (g.example
            ? '<div class="gap-example">e.g. ' + esc(g.example.name) + "</div>"
            : "") +
          "</div>"
        );
      })
      .join("");
  }

  function renderRailCompare() {
    var el = $("#rail-compare");
    if (!el) return;
    var items = Array.from(state.compare).map(byId).filter(Boolean);

    if (!items.length) {
      el.innerHTML =
        '<p class="rail-empty">Tick a program in the list, or press Compare on a card, to line up to four side by side.</p>';
      return;
    }

    el.innerHTML =
      items
        .map(function (p) {
          return (
            '<div class="rail-cmp-item"><span>' +
            esc(p.name) +
            "</span>" +
            '<button data-uncmp="' +
            esc(p.id) +
            '" aria-label="Remove">×</button></div>'
          );
        })
        .join("") +
      '<button class="btn primary full" id="rail-compare-btn"' +
      (items.length < 2 ? " disabled" : "") +
      ">Compare " +
      items.length +
      "</button>";

    var btn = document.getElementById("rail-compare-btn");
    if (btn) btn.addEventListener("click", openCompare);
  }

  function rowHtml(row) {
    var p = row.program;
    var s = p.signals;
    var wp = p.badges.will_pay;
    var slop = p.badges.slop;
    var open = !!state.expanded[p.id];
    var picked = state.compare.has(p.id);

    var sub = [
      "HackerOne",
      age(s.age_months),
      nf(s.scope_count) + " assets",
      slop.label !== "none" ? "slop " + slop.label : null,
    ]
      .filter(Boolean)
      .join(" · ");

    var matchNote = "";
    if (window.HBE.hasProfile(state.profile)) {
      var b = window.HBE.matchBreakdown(p, state.profile);
      if (b.total && b.surfaces.length) {
        var top = b.surfaces[0];
        var bucket =
          top.eff >= 4 ? "match" : top.eff >= 2 ? "partial" : "outside";
        matchNote =
          top.surface + " " + Math.round(top.share * 100) + "% " + bucket;
        if (
          b.surfaces.length > 1 &&
          b.surfaces[1].eff < 2 &&
          b.surfaces[1].share >= 0.15
        ) {
          matchNote +=
            " · " +
            b.surfaces[1].surface +
            " " +
            Math.round(b.surfaces[1].share * 100) +
            "% outside";
        }
      }
    }

    var crowd = window.HBE.crowdedForBeginner(p, state.profile)
      ? ' <span class="crowd-note" title="Heavy competition. Most accepted reports here come from experienced hunters.">very crowded</span>'
      : "";

    return (
      '<div class="row' +
      (open ? " open" : "") +
      '" data-id="' +
      esc(p.id) +
      '">' +
      '<div class="row-main">' +
      '<div class="sel"><input type="checkbox" data-sel="' +
      esc(p.id) +
      '"' +
      (picked ? " checked" : "") +
      ' aria-label="Compare ' +
      esc(p.name) +
      '"></div>' +
      '<div class="rank">' +
      row.rank +
      "</div>" +
      '<div class="pname">' +
      '<div class="n"><a href="' +
      esc(p.url) +
      '" target="_blank" rel="noopener">' +
      esc(p.name) +
      "</a></div>" +
      '<div class="sub">' +
      esc(sub) +
      (matchNote
        ? ' <span class="match-note">' + esc(matchNote) + "</span>"
        : "") +
      crowd +
      "</div>" +
      "</div>" +
      '<div class="scorecell">' +
      '<span class="num">' +
      row.score.toFixed(1) +
      "</span>" +
      '<div class="bar"><i style="width:' +
      Math.min(100, row.score) +
      '%"></i></div>' +
      "</div>" +
      '<div><span class="badge ' +
      wp.tier +
      '"><span class="dot"></span>' +
      esc(wp.label) +
      "</span></div>" +
      '<div class="metric hide-sm"><span class="lbl">reports / 90d</span><b>' +
      nf(s.reports_90d) +
      "</b></div>" +
      '<div class="metric hide-md"><span class="lbl">assets</span><b>' +
      nf(s.scope_count) +
      "</b></div>" +
      '<div class="metric hide-md"><span class="lbl">response</span><b>' +
      pct(s.response_efficiency) +
      "</b></div>" +
      '<div class="metric hide-sm"><span class="lbl">paid 90d</span><b>' +
      money(s.paid_90d) +
      "</b></div>" +
      "</div>" +
      "</div>"
    );
  }

  function surfaceMix(p) {
    var counts = window.HBE.surfaceCounts(p.scope);
    var keys = Object.keys(counts)
      .sort(function (a, b) {
        return counts[b] - counts[a];
      })
      .slice(0, 5);
    if (!keys.length) return "";
    return (
      '<div class="mix">' +
      keys
        .map(function (k) {
          return (
            '<span class="mixchip">' +
            esc(k) +
            " <b>" +
            counts[k] +
            "</b></span>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function detailHtml(p) {
    var reasons = (p.reasons || [])
      .map(function (r) {
        return '<span class="reason ' + r.sign + '">' + esc(r.text) + "</span>";
      })
      .join("");

    var penalties = (p.score.penalties || [])
      .map(function (x) {
        return (
          '<span class="reason bad">−' +
          Math.abs(x.points) +
          " " +
          esc(x.reason) +
          "</span>"
        );
      })
      .join("");

    var bars = window.HBE.explain(p, state.profile)
      .map(function (c) {
        return (
          '<div class="barline"><span>' +
          esc(c.label) +
          "</span>" +
          '<span class="track"><i class="' +
          (c.contribution >= 8 ? "hot" : "") +
          '" style="width:' +
          Math.round(c.value * 100) +
          '%"></i></span>' +
          '<span class="val">' +
          c.contribution.toFixed(1) +
          "</span></div>"
        );
      })
      .join("");

    var scope = (p.scope || [])
      .slice(0, 240)
      .map(function (a) {
        return (
          '<span class="scope-item" title="' +
          esc(a.asset) +
          '">' +
          esc(a.asset) +
          '<span class="t">' +
          esc(a.type) +
          "</span></span>"
        );
      })
      .join("");

    var more =
      (p.scope || []).length > 240
        ? '<div class="reason neutral">showing 240 of ' +
          nf(p.scope.length) +
          " assets</div>"
        : "";

    return (
      '<div class="reasons">' +
      reasons +
      penalties +
      "</div>" +
      matchBlock(p) +
      surfaceMix(p) +
      '<div class="bars">' +
      bars +
      "</div>" +
      '<div class="scope-head"><h4>In scope</h4>' +
      '<button class="btn sm ghost" data-copy="' +
      esc(p.id) +
      '">copy scope</button>' +
      '<a class="btn sm ghost" href="' +
      esc(p.url) +
      '" target="_blank" rel="noopener">open on HackerOne</a>' +
      '<span class="reason neutral">' +
      esc(p.badges.will_pay.why) +
      "</span>" +
      "</div>" +
      '<div class="scope-grid">' +
      (scope || '<span class="scope-item">no scope published</span>') +
      "</div>" +
      more
    );
  }

  /* Personalization explanation for one program, plain numbers. */
  function matchBlock(p) {
    if (!window.HBE.hasProfile(state.profile)) return "";
    var b = window.HBE.matchBreakdown(p, state.profile);
    if (!b.total || !b.surfaces.length) return "";

    var rows = b.surfaces
      .slice(0, 4)
      .map(function (s) {
        var cls = s.eff >= 4 ? "good" : s.eff >= 2 ? "neutral" : "bad";
        var bucket = s.eff >= 4 ? "match" : s.eff >= 2 ? "partial" : "outside";
        return (
          '<div class="mline">' +
          '<span class="msurface">' +
          esc(s.surface) +
          "</span>" +
          '<span class="mshare">' +
          Math.round(s.share * 100) +
          "% of scope</span>" +
          '<span class="mskill reason ' +
          cls +
          '">' +
          esc(bucket) +
          " · " +
          s.eff.toFixed(1) +
          "/5</span>" +
          "</div>"
        );
      })
      .join("");

    var penalty = window.HBE.mismatchPenalty(p, state.profile);
    var delta = window.HBE.curatedScore(p, state.profile) - p.score.total;
    var deltaLine =
      Math.abs(delta) < 0.05
        ? "no net change"
        : (delta > 0 ? "+" : "−") +
          Math.abs(delta).toFixed(1) +
          " points vs population";

    return (
      '<div class="matchblock">' +
      '<div class="matchblock-head">Your fit' +
      '<span class="matchblock-delta">' +
      esc(deltaLine) +
      " (cap ±" +
      window.HBE.MAX_DELTA +
      ")</span>" +
      "</div>" +
      rows +
      (penalty
        ? '<div class="matchblock-note">surface mismatch penalty: ' +
          penalty.toFixed(1) +
          " points</div>"
        : "") +
      '<div class="matchblock-note">stack match ' +
      Math.round(window.HBE.stackMatch(p, state.profile) * 100) +
      "/100 of this scope is at your effective skill · profile " +
      Math.round(window.HBE.completeness(state.profile) * 100) +
      "% strength</div>" +
      "</div>"
    );
  }

  /* ---------------- compare ---------------- */

  function toggleCompare(id) {
    if (state.compare.has(id)) state.compare.delete(id);
    else {
      if (state.compare.size >= MAX_COMPARE)
        return flashTray("Compare up to " + MAX_COMPARE + " at once");
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
        btn.textContent = on ? "Selected" : "Compare";
      }
    });
    renderRailCompare();
  }

  function renderTray() {
    var tray = $("#tray");
    var items = Array.from(state.compare).map(byId).filter(Boolean);
    tray.classList.toggle("show", items.length > 0);
    document.body.classList.toggle("tray-open", items.length > 0);
    $("#compare-count").textContent = items.length;
    $("#tray-items").innerHTML = items
      .map(function (p) {
        return (
          '<span class="tray-item"><span>' +
          esc(p.name) +
          "</span>" +
          '<button data-uncmp="' +
          esc(p.id) +
          '" aria-label="Remove">×</button></span>'
        );
      })
      .join("");
    $("#open-compare").disabled = items.length < 2;
    renderRailCompare();
  }

  /** From a top-10 card: clear filters, expand that row and scroll to it. */
  function jumpTo(id) {
    closeMatch();
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
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("flash");
    setTimeout(function () {
      row.classList.remove("flash");
    }, 1200);
  }

  /* ---------------- match card ---------------- */

  function openMatch(id) {
    var p = byId(id);
    if (!p) return;

    var rows = window.HBE.rescore(state.programs, state.profile);
    var row = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].program.id === id) {
        row = rows[i];
        break;
      }
    }
    if (!row) return;

    var s = p.signals;
    var wp = p.badges.will_pay;
    var personalised = window.HBE.hasProfile(state.profile);
    var b = personalised ? window.HBE.matchBreakdown(p, state.profile) : null;
    var delta = personalised
      ? window.HBE.curatedScore(p, state.profile) - p.score.total
      : 0;
    var share = function (v) {
      return Math.round(v * 100) + "%";
    };

    var why = "";
    if (personalised && b && b.surfaces.length) {
      var top = b.surfaces[0];
      var second = b.surfaces[1];
      var bucket =
        top.eff >= 4 ? "match" : top.eff >= 2 ? "partial" : "outside";
      var verdict;
      if (top.eff >= 4) {
        verdict =
          "Your strongest surface is " +
          esc(top.surface) +
          " and it covers " +
          share(top.share) +
          " of this scope. That overlap is why it ranks here for you.";
      } else if (top.eff >= 2) {
        verdict =
          "Part of this scope is in a surface you practice. It is a stretch rather than a mismatch.";
      } else {
        verdict =
          "Most of this scope sits outside what you practice. The population score may be high, but your fit is weak.";
      }
      why =
        '<div class="why">' +
        '<div class="why-kicker">Why this is a good match</div>' +
        "<p>" +
        verdict +
        "</p>" +
        '<div class="why-grid">' +
        matchCell("Top surface", esc(top.surface)) +
        matchCell("Scope share", share(top.share)) +
        matchCell(
          "Your effective skill",
          top.eff.toFixed(1) + "/5 (" + bucket + ")",
        ) +
        matchCell(
          "Stack match",
          Math.round(window.HBE.stackMatch(p, state.profile) * 100) + "/100",
        ) +
        matchCell(
          "Personal delta",
          (delta >= 0 ? "+" : "") +
            delta.toFixed(1) +
            " pts (cap ±" +
            window.HBE.MAX_DELTA +
            ")",
        ) +
        matchCell(
          "Profile strength",
          Math.round(window.HBE.completeness(state.profile) * 100) + "%",
        ) +
        "</div>" +
        (second && second.share >= 0.15 && second.eff < 2
          ? '<p class="why-warn">Watch out: ' +
            share(second.share) +
            " of the scope is " +
            esc(second.surface) +
            ", where your effective skill is " +
            second.eff.toFixed(1) +
            "/5.</p>"
          : "") +
        "</div>";
    } else {
      why =
        '<div class="why">' +
        '<div class="why-kicker">Why this ranks here</div>' +
        "<p>This is the population ranking, for every hunter. Tune for me and this card will show how much of the scope you can actually test.</p>" +
        "</div>";
    }

    var metrics =
      '<div class="match-metrics">' +
      matchCell(
        "Score",
        row.score.toFixed(1),
        "top " + Math.max(1, Math.round(100 - row.percentile)) + "%",
      ) +
      matchCell("Reports / 90d", nf(s.reports_90d), "competition") +
      matchCell("Response", pct(s.response_efficiency), wp.label) +
      matchCell("Paid 90d", money(s.paid_90d), "bounty volume") +
      matchCell("Scope", nf(s.scope_count), "assets") +
      matchCell(
        "Avg bounty",
        s.avg_bounty ? money(s.avg_bounty) : "unknown",
        "per report",
      ) +
      "</div>";

    $("#match-body").innerHTML =
      '<div class="match-head">' +
      '<div class="match-kicker">Rank #' +
      row.rank +
      " of " +
      nf(rows.length) +
      ' · <span class="badge ' +
      wp.tier +
      '"><span class="dot"></span>' +
      esc(wp.label) +
      "</span></div>" +
      '<h2 id="match-title">' +
      esc(p.name) +
      "</h2>" +
      '<div class="match-sub">HackerOne · ' +
      age(s.age_months) +
      " · " +
      nf(s.scope_count) +
      " assets" +
      (wp.why ? " · " + esc(wp.why) : "") +
      "</div>" +
      '<button class="modal-x" data-close-match aria-label="Close">×</button>' +
      "</div>" +
      why +
      metrics +
      detailHtml(p) +
      '<div class="match-actions">' +
      '<button class="btn sm" data-cmp="' +
      esc(p.id) +
      '">' +
      (state.compare.has(p.id) ? "Selected for compare" : "Add to compare") +
      "</button>" +
      '<button class="btn sm ghost" data-jump="' +
      esc(p.id) +
      '">Show in list</button>' +
      '<a class="btn sm ghost" href="' +
      esc(p.url) +
      '" target="_blank" rel="noopener">Open on HackerOne</a>' +
      "</div>";

    $("#match-modal").classList.add("open");
    document.body.classList.add("modal-open");
  }

  function matchCell(label, value, note) {
    return (
      '<div class="mcell"><span>' +
      esc(label) +
      "</span><b>" +
      value +
      "</b>" +
      (note ? "<i>" + esc(note) + "</i>" : "") +
      "</div>"
    );
  }

  function closeMatch() {
    var el = $("#match-modal");
    if (!el) return;
    el.classList.remove("open");
    document.body.classList.remove("modal-open");
  }

  function flashTray(msg) {
    var label = $(".tray-label");
    if (!label) return;
    var old = label.textContent;
    label.textContent = msg;
    label.style.color = "var(--amber-fg)";
    setTimeout(function () {
      label.textContent = old;
      label.style.color = "";
    }, 1800);
  }

  var COMPARE_ROWS = [
    {
      label: "Score",
      get: function (p) {
        return p.score.total;
      },
      fmt: function (v) {
        return v.toFixed(1);
      },
      better: "high",
      delta: 0.5,
    },
    {
      label: "Reports / 90d",
      get: function (p) {
        return p.signals.reports_90d;
      },
      fmt: nf,
      better: "low",
      delta: 2,
    },
    {
      label: "Scope assets",
      get: function (p) {
        return p.signals.scope_count;
      },
      fmt: nf,
      better: "high",
      delta: 2,
    },
    {
      label: "Response eff.",
      get: function (p) {
        return p.signals.response_efficiency;
      },
      fmt: pct,
      better: "high",
      delta: 1,
    },
    {
      label: "Paid 90d",
      get: function (p) {
        return p.signals.paid_90d;
      },
      fmt: money,
      better: "high",
      delta: 100,
    },
    {
      label: "Age",
      get: function (p) {
        return p.signals.age_months;
      },
      fmt: age,
      better: "low",
      delta: 1,
    },
    {
      label: "Crowding / asset / mo",
      get: function (p) {
        return p.derived.crowding_per_asset_month;
      },
      fmt: function (v) {
        return v.toFixed(2);
      },
      better: "low",
      delta: 0.05,
    },
    {
      label: "Slop risk",
      get: function (p) {
        return p.badges.slop.risk;
      },
      fmt: function (v) {
        return v == null ? "-" : v.toFixed(2);
      },
      better: "low",
      delta: 0.05,
    },
  ];

  /** Winner index, but only when it beats the runner-up by a meaningful margin. */
  function bestIndex(values, better, delta) {
    var best = -1,
      bestVal = null,
      second = null;
    values.forEach(function (v, i) {
      if (v == null) return;
      if (bestVal === null || (better === "high" ? v > bestVal : v < bestVal)) {
        second = bestVal;
        bestVal = v;
        best = i;
      } else if (
        second === null ||
        (better === "high" ? v > second : v < second)
      ) {
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

    var head =
      "<thead><tr><th></th>" +
      items
        .map(function (p) {
          var s = p.signals;
          return (
            '<th><div class="compare-thumb">' +
            '<span class="ct-name">' +
            esc(p.name) +
            "</span>" +
            '<span class="ct-sub">HackerOne · ' +
            age(s.age_months) +
            " · " +
            nf(s.scope_count) +
            " assets</span>" +
            '<span class="badge ' +
            p.badges.will_pay.tier +
            '" style="margin-top:6px"><span class="dot"></span>' +
            esc(p.badges.will_pay.label) +
            "</span>" +
            "</div></th>"
          );
        })
        .join("") +
      "</tr></thead>";

    var body = COMPARE_ROWS.map(function (row) {
      var values = items.map(row.get);
      var win =
        values.filter(function (v) {
          return v != null;
        }).length > 1
          ? bestIndex(values, row.better, row.delta)
          : -1;
      return (
        "<tr><th>" +
        esc(row.label) +
        "</th>" +
        values
          .map(function (v, i) {
            var cls = i === win ? ' class="best"' : "";
            return (
              "<td" + cls + ">" + esc(v == null ? "-" : row.fmt(v)) + "</td>"
            );
          })
          .join("") +
        "</tr>"
      );
    }).join("");

    var mix =
      "<tr><th>Surface mix</th>" +
      items
        .map(function (p) {
          var c = window.HBE.surfaceCounts(p.scope);
          var keys = Object.keys(c)
            .sort(function (a, b) {
              return c[b] - c[a];
            })
            .slice(0, 3);
          return (
            "<td>" +
            keys
              .map(function (k) {
                return (
                  '<span class="mixchip">' + esc(k) + " " + c[k] + "</span>"
                );
              })
              .join(" ") +
            "</td>"
          );
        })
        .join("") +
      "</tr>";

    var pen =
      "<tr><th>Penalties</th>" +
      items
        .map(function (p) {
          var list = (p.score.penalties || []).map(function (x) {
            return x.reason;
          });
          return "<td>" + (list.length ? esc(list.join(", ")) : "-") + "</td>";
        })
        .join("") +
      "</tr>";

    $("#compare-body").innerHTML =
      '<div class="compare-scroll"><table class="compare-table">' +
      head +
      "<tbody>" +
      body +
      mix +
      pen +
      "</tbody></table></div>";
  }

  function openCompare() {
    if (state.compare.size < 2) return;
    renderCompare();
    $("#compare-modal").classList.add("open");
  }

  function closeCompare() {
    $("#compare-modal").classList.remove("open");
  }

  function exportCsv() {
    var items = Array.from(state.compare).map(byId).filter(Boolean);
    var cols = [
      "name",
      "url",
      "score",
      "will_pay",
      "reports_90d",
      "scope_assets",
      "response_efficiency",
      "paid_90d",
      "age_months",
      "crowding",
      "slop_risk",
    ];
    var lines = [cols.join(",")];
    items.forEach(function (p) {
      var row = [
        p.name,
        p.url,
        p.score.total,
        p.badges.will_pay.label,
        p.signals.reports_90d,
        p.signals.scope_count,
        p.signals.response_efficiency,
        p.signals.paid_90d,
        p.signals.age_months == null ? "" : p.signals.age_months.toFixed(1),
        p.derived.crowding_per_asset_month,
        p.badges.slop.risk,
      ];
      lines.push(
        row
          .map(function (v) {
            var s = String(v == null ? "" : v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          })
          .join(","),
      );
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "honeybe-compare.csv";
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
      $$(".quickchip").forEach(function (c) {
        c.classList.toggle("active", c === chip);
      });
      render();
    });

    var surfaceFilter = $("#surface-filter");
    if (surfaceFilter) {
      surfaceFilter.addEventListener("change", function (e) {
        var cb = e.target.closest("input[type=checkbox]");
        if (!cb) return;
        if (cb.checked) state.surfaces.add(cb.value);
        else state.surfaces.delete(cb.value);
        updateSurfaceClear();
        render();
      });
    }

    var clearSurfaces = $("#clear-surfaces");
    if (clearSurfaces) {
      clearSurfaces.addEventListener("click", function () {
        state.surfaces.clear();
        $$("#surface-filter input[type=checkbox]").forEach(function (cb) {
          cb.checked = false;
        });
        updateSurfaceClear();
        render();
      });
    }

    $("#list").addEventListener("click", function (e) {
      if (e.target.closest("a")) return;
      if (e.target.closest(".sel")) return;

      var copyBtn = e.target.closest("[data-copy]");
      if (copyBtn) {
        var prog = byId(copyBtn.getAttribute("data-copy"));
        if (prog) {
          var text = (prog.scope || [])
            .map(function (a) {
              return a.asset;
            })
            .join("\n");
          navigator.clipboard.writeText(text);
          copyBtn.textContent = "copied";
          setTimeout(function () {
            copyBtn.textContent = "copy scope";
          }, 1400);
        }
        return;
      }

      var row = e.target.closest(".row");
      if (!row) return;
      openMatch(row.getAttribute("data-id"));
    });

    $("#list").addEventListener("change", function (e) {
      var cb = e.target.closest("input[data-sel]");
      if (!cb) return;
      toggleCompare(cb.getAttribute("data-sel"));
    });

    $("#cards").addEventListener("click", function (e) {
      var btn = e.target.closest(".card-cmp");
      if (btn) {
        toggleCompare(btn.getAttribute("data-cmp"));
        return;
      }
      if (e.target.closest("a")) return;
      var card = e.target.closest(".card");
      if (card) openMatch(card.getAttribute("data-id"));
    });

    $("#tray-items").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-uncmp]");
      if (btn) toggleCompare(btn.getAttribute("data-uncmp"));
    });

    var catChips = $("#cat-chips");
    if (catChips) {
      catChips.addEventListener("click", function (e) {
        var chip = e.target.closest(".cat-chip");
        if (!chip) return;
        if (chip.getAttribute("data-toggle") === "scored") {
          state.catalogIncludeScored = !state.catalogIncludeScored;
        } else {
          state.catalogPlatform = chip.getAttribute("data-cat");
        }
        renderCatalog();
      });
    }

    var catSort = $("#cat-sort");
    if (catSort) {
      catSort.addEventListener("change", function (e) {
        state.catSort = e.target.value;
        renderCatalog();
      });
    }

    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-close-match]")) closeMatch();
      if (e.target.closest("[data-close-news]")) closeNews();
    });

    var newsBtn = $("#news-btn");
    if (newsBtn) newsBtn.addEventListener("click", openNews);

    var matchBody = $("#match-body");
    if (matchBody) {
      matchBody.addEventListener("click", function (e) {
        var cmp = e.target.closest("[data-cmp]");
        if (cmp) {
          toggleCompare(cmp.getAttribute("data-cmp"));
          cmp.textContent = state.compare.has(cmp.getAttribute("data-cmp"))
            ? "Selected for compare"
            : "Add to compare";
          return;
        }
        var jump = e.target.closest("[data-jump]");
        if (jump) {
          jumpTo(jump.getAttribute("data-jump"));
          return;
        }
        var copy = e.target.closest("[data-copy]");
        if (copy) {
          var prog = byId(copy.getAttribute("data-copy"));
          if (prog) {
            navigator.clipboard.writeText(
              (prog.scope || [])
                .map(function (a) {
                  return a.asset;
                })
                .join("\n"),
            );
            copy.textContent = "copied";
            setTimeout(function () {
              copy.textContent = "copy scope";
            }, 1400);
          }
        }
      });
    }

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
        setTab(tab.getAttribute("data-tab"));
      });
    });

    $$("[data-tab-link]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        var target = el.getAttribute("data-tab-link");
        if (target === "method") {
          window.location.href = "method.html";
          return;
        }
        setTab(target);
      });
    });

    $$(".js-tune").forEach(function (el) {
      el.addEventListener("click", function () {
        openModal();
      });
    });

    $("#copy-link").addEventListener("click", function () {
      var btn = this;
      navigator.clipboard.writeText(window.location.href);
      btn.title = "Link copied";
      setTimeout(function () {
        btn.title = "Copy a link to this view";
      }, 1400);
    });

    $$("[data-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });

    var onboard = $("#onboard");
    if (onboard) {
      onboard.addEventListener("click", function (e) {
        var opt = e.target.closest(".onboard-option");
        if (opt) {
          saveProfile(
            window.HBE.emptyProfile(Number(opt.getAttribute("data-level"))),
          );
          closeOnboard();
          renderStats();
          renderTop10();
          render();
          return;
        }
        if (e.target.closest("[data-close-onboard]")) closeOnboard();
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeModal();
        closeCompare();
        closeMatch();
        closeNews();
      }
      if (e.key === "/" && document.activeElement !== $("#search")) {
        e.preventDefault();
        $("#search").focus();
      }
    });

    window.addEventListener("hashchange", applyHash);

    $("#save-profile").addEventListener("click", function () {
      saveProfile(window.HBE.migrateProfile(readModal()));
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
    draft = state.profile
      ? JSON.parse(JSON.stringify(state.profile))
      : window.HBE.emptyProfile();
    buildSurfaceSliders();
    $("#hours").value = draft.constraints.hours_per_week;
    $("#hours-v").textContent = draft.constraints.hours_per_week;
    $("#session").value = draft.constraints.session_hours;
    $("#session-v").textContent = draft.constraints.session_hours + "h";
    $$("#level-chips .chip").forEach(function (c) {
      c.classList.toggle(
        "on",
        Number(c.getAttribute("data-level")) === Number(draft.capability.level),
      );
    });
    $$("#goal-chips .chip").forEach(function (c) {
      c.classList.toggle(
        "on",
        c.getAttribute("data-goal") === draft.preferences.goal,
      );
    });
    $$("#tool-chips .chip").forEach(function (c) {
      c.classList.toggle(
        "on",
        !!draft.constraints.tools[c.getAttribute("data-tool")],
      );
    });
    updateGoalShiftNote(draft.preferences.goal);
    $("#modal").classList.add("open");
  }

  var GOAL_SHIFTS = {
    first_bounty:
      "Weight shift: crowding ×1.35, scope breadth ×0.65, value ×0.85 - clear runway over jackpot odds.",
    income:
      "Weight shift: payout reliability ×1.45, crowding ×1.10 - proven payers over long shots.",
    learning:
      "Weight shift: value per competition ×0.80, triage quality ×1.10 - programs that resolve and give feedback.",
  };

  function updateGoalShiftNote(goal) {
    var el = $("#goal-shift-note");
    if (el) el.textContent = GOAL_SHIFTS[goal] || GOAL_SHIFTS.first_bounty;
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
        '<div class="slider" data-surface="' +
        key +
        '">' +
        "<span>" +
        esc(labels[key] || key) +
        "</span>" +
        '<input type="range" min="0" max="5" step="1" value="' +
        value +
        '">' +
        '<span class="sv">' +
        value +
        "</span></div>"
      );
    }).join("");

    $$("#surface-sliders input").forEach(function (input) {
      input.addEventListener("input", function () {
        var wrap = input.closest(".slider");
        wrap.querySelector(".sv").textContent = input.value;
        draft.capability.surfaces[wrap.getAttribute("data-surface")] = Number(
          input.value,
        );
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
    if (e.target.id === "session")
      $("#session-v").textContent = e.target.value + "h";
  });

  document.addEventListener("click", function (e) {
    var level = e.target.closest("#level-chips .chip");
    if (level && draft) {
      $$("#level-chips .chip").forEach(function (c) {
        c.classList.remove("on");
      });
      level.classList.add("on");
      draft.capability.level = Number(level.getAttribute("data-level"));
    }
    var goal = e.target.closest("#goal-chips .chip");
    if (goal && draft) {
      $$("#goal-chips .chip").forEach(function (c) {
        c.classList.remove("on");
      });
      goal.classList.add("on");
      draft.preferences.goal = goal.getAttribute("data-goal");
      updateGoalShiftNote(draft.preferences.goal);
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
