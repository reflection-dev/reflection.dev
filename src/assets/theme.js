// Theme toggle (dark/light persisted in localStorage).
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

  if (btn) {
    btn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (_) {}
      syncIcons();
    });
  }
})();

// TOC active-section highlighting via IntersectionObserver.
(function () {
  var links = document.querySelectorAll(".doc-toc a[data-toc-link]");
  if (!links.length || !("IntersectionObserver" in window)) return;

  var byId = new Map();
  var targets = [];
  links.forEach(function (a) {
    var id = a.getAttribute("href").replace(/^#/, "");
    var target = document.getElementById(id);
    if (!target) return;
    byId.set(id, a);
    targets.push(target);
  });
  if (!targets.length) return;

  var visible = new Set();

  function setActive(id) {
    links.forEach(function (a) { a.classList.remove("active"); });
    var a = byId.get(id);
    if (a) a.classList.add("active");
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) visible.add(e.target.id);
      else visible.delete(e.target.id);
    });
    // Pick the first visible heading in document order.
    for (var i = 0; i < targets.length; i++) {
      if (visible.has(targets[i].id)) {
        setActive(targets[i].id);
        return;
      }
    }
  }, {
    rootMargin: "-15% 0px -70% 0px",
    threshold: 0,
  });

  targets.forEach(function (t) { observer.observe(t); });
})();
