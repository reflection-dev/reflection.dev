(function () {
  var root = document.documentElement;
  var btn = document.querySelector("[data-theme-toggle]");
  var iconDark = document.querySelector("[data-theme-icon-dark]");
  var iconLight = document.querySelector("[data-theme-icon-light]");

  function syncIcons() {
    var theme = root.getAttribute("data-theme");
    if (!iconDark || !iconLight) return;
    iconDark.hidden = theme === "light";
    iconLight.hidden = theme !== "light";
  }

  syncIcons();

  if (!btn) return;
  btn.addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (_) {}
    syncIcons();
  });
})();
