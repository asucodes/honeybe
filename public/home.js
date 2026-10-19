/* Home page: live counts and a small live preview from the published data. */
(function () {
  function nf(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function money(v) {
    if (v === null || v === undefined) return "unknown";
    if (v >= 1000000) return "$" + (v / 1000000).toFixed(1) + "M";
    if (v >= 1000) return "$" + Math.round(v / 1000) + "k";
    return "$" + Math.round(v);
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function preview(programs) {
    var host = document.getElementById("home-preview");
    if (!host) return;
    host.innerHTML = programs
      .slice(0, 5)
      .map(function (p, i) {
        var badge = p.badges.will_pay;
        return (
          '<a class="preview-row" href="app.html">' +
          '<span class="pv-rank">' +
          String(i + 1).padStart(2, "0") +
          "</span>" +
          '<span class="pv-name">' +
          "<b>" +
          p.name +
          "</b>" +
          "<small>HackerOne · " +
          nf(p.signals.scope_count) +
          " assets · " +
          nf(p.signals.reports_90d) +
          " reports / 90d</small>" +
          "</span>" +
          '<span class="badge ' +
          badge.tier +
          '"><span class="dot"></span>' +
          badge.label +
          "</span>" +
          '<span class="pv-score">' +
          p.score.total.toFixed(1) +
          "</span>" +
          "</a>"
        );
      })
      .join("");
  }

  function refreshInfo(iso) {
    var el = document.getElementById("home-refresh");
    if (!el || !iso) return;
    var then = new Date(iso).getTime();
    if (isNaN(then)) return;
    var mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    var age;
    if (mins < 60) age = mins + "m ago";
    else if (mins < 1440) age = Math.round(mins / 60) + "h ago";
    else age = Math.round(mins / 1440) + "d ago";
    var left = Math.max(0, then + 6 * 3600 * 1000 - Date.now());
    var lh = Math.floor(left / 3600000);
    var lm = Math.round((left % 3600000) / 60000);
    var next =
      left <= 0
        ? "update due"
        : "next in " + (lh > 0 ? lh + "h " : "") + lm + "m";
    el.textContent = "updated " + age + " · " + next;
  }

  fetch("data/programs.json")
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      if (!data) return;
      setText("home-scored", nf(data.count));
      var paid =
        (data.stats && data.stats.will_pay && data.stats.will_pay.green) || 0;
      if (paid) setText("home-paid", nf(paid));
      refreshInfo(data.generated_at);
      preview(data.programs || []);
    })
    .catch(function () {});

  fetch("data/catalog.json")
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (cat) {
      if (!cat) return;
      setText("home-catalog", nf(cat.counts.total));
      var platforms = Object.keys(cat.counts.by_platform || {}).length;
      if (platforms) setText("home-sources", nf(platforms));
    })
    .catch(function () {});
})();
