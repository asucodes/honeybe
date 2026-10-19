/* Splash: holds for three seconds, then fades. Any click or key skips it.
   Reduced-motion users get the same content for 1.2 seconds with no movement. */
(function () {
  var el = document.getElementById("splash");
  if (!el) return;

  var reduce = false;
  try {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}

  var done = false;
  function hide() {
    if (done) return;
    done = true;
    el.classList.add("hide");
    document.removeEventListener("keydown", hide);
    setTimeout(function () {
      el.remove();
    }, 950);
  }

  el.addEventListener("click", hide);
  document.addEventListener("keydown", hide);
  setTimeout(hide, reduce ? 1200 : 3000);
})();
