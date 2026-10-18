/* Method page: fill live counts and draw the catalog coverage figure. */
(function () {
  function nf(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function coverage(cat) {
    var el = document.getElementById("covbars");
    if (!el) return;
    var counts = cat.counts || {};
    var by = counts.by_platform || {};
    var labels = {
      hackerone: "HackerOne",
      bugcrowd: "Bugcrowd",
      intigriti: "Intigriti",
      yeswehack: "YesWeHack",
      platform: "Platform",
      direct: "Direct",
    };
    var keys = Object.keys(by).sort(function (a, b) {
      return by[b] - by[a];
    });
    var max = keys.length ? by[keys[0]] : 1;
    var total = counts.total || 1;
    el.innerHTML =
      keys
        .map(function (k) {
          return (
            '<div class="covbar"><span>' +
            (labels[k] || k) +
            '</span><i style="width:' +
            Math.max(2, Math.round((100 * by[k]) / max)) +
            '%"></i><b>' +
            nf(by[k]) +
            "</b></div>"
          );
        })
        .join("") +
      '<div class="cov-split">' +
      nf(counts.total) +
      " rows · " +
      nf(counts.with_scope) +
      " publish scope (" +
      Math.round((100 * counts.with_scope) / total) +
      "%) · " +
      nf(counts.with_payout) +
      " state a max payout (" +
      Math.round((100 * counts.with_payout) / total) +
      "%). The rest is printed as unknown.</div>";
  }

  fetch("data/programs.json")
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      var el = document.getElementById("method-count");
      if (el && data) el.textContent = nf(data.count);
    })
    .catch(function () {});

  fetch("data/catalog.json")
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (cat) {
      if (cat) coverage(cat);
    })
    .catch(function () {});
})();
