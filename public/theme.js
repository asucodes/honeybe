/* Theme: light by default, dark when chosen or when the OS prefers it.
   The choice lives in localStorage under honeybee.theme and is applied
   before paint by a tiny inline script in each page head. */
(function () {
  var KEY = "honeybee.theme";
  var root = document.documentElement;

  function current() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function apply(mode) {
    root.setAttribute("data-theme", mode);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      var dark = mode === "dark";
      button.setAttribute("aria-pressed", dark ? "true" : "false");
      button.title = dark ? "Switch to light theme" : "Switch to dark theme";
      button.setAttribute(
        "aria-label",
        dark ? "Switch to light theme" : "Switch to dark theme",
      );
    });
  }

  function toggle() {
    var next = current() === "dark" ? "light" : "dark";
    apply(next);
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {
      /* private mode: the theme still changes for this page */
    }
  }

  function init() {
    apply(current());
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      button.addEventListener("click", toggle);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
