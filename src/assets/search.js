// Search modal backed by Pagefind (lazy-loaded on first open).
(function () {
  var modal = document.querySelector("[data-search-modal]");
  var input = document.querySelector("[data-search-input]");
  var results = document.querySelector("[data-search-results]");
  var triggers = document.querySelectorAll("[data-search-trigger]");
  if (!modal || !input || !results) return;

  var pagefind = null;
  var loading = null;
  var activeIndex = -1;

  function loadPagefind() {
    if (pagefind) return Promise.resolve(pagefind);
    if (loading) return loading;
    loading = import("/pagefind/pagefind.js")
      .then(function (mod) {
        pagefind = mod;
        return mod.options({ excerptLength: 30 });
      })
      .then(function () {
        return pagefind;
      })
      .catch(function (e) {
        loading = null;
        results.innerHTML =
          '<div class="search-modal-error">Search index unavailable. Run <code>pnpm build</code>.</div>';
        throw e;
      });
    return loading;
  }

  function openModal() {
    if (typeof modal.showModal === "function") modal.showModal();
    else modal.setAttribute("open", "");
    setTimeout(function () { input.focus(); input.select(); }, 0);
    loadPagefind();
  }

  function closeModal() {
    if (typeof modal.close === "function") modal.close();
    else modal.removeAttribute("open");
    input.value = "";
    renderHint("Start typing to search.");
    activeIndex = -1;
  }

  function renderHint(text) {
    results.innerHTML = '<div class="search-modal-hint">' + text + "</div>";
  }

  function highlight() {
    var items = results.querySelectorAll("[data-search-result]");
    items.forEach(function (el, i) {
      el.classList.toggle("is-active", i === activeIndex);
      if (i === activeIndex) el.scrollIntoView({ block: "nearest" });
    });
  }

  function navigateActive() {
    var items = results.querySelectorAll("[data-search-result]");
    if (activeIndex < 0 || activeIndex >= items.length) return;
    var a = items[activeIndex].querySelector("a");
    if (a) window.location.href = a.href;
  }

  var searchToken = 0;
  async function runSearch(q) {
    var token = ++searchToken;
    if (!q.trim()) { renderHint("Start typing to search."); activeIndex = -1; return; }
    try {
      var pf = await loadPagefind();
      var search = await pf.debouncedSearch(q, {}, 150);
      if (search === null || token !== searchToken) return;
      var hits = await Promise.all(search.results.slice(0, 10).map(function (r) { return r.data(); }));
      if (token !== searchToken) return;
      if (!hits.length) { renderHint("No results."); activeIndex = -1; return; }
      results.innerHTML = hits
        .map(function (h) {
          return (
            '<div class="search-modal-result" data-search-result>' +
              '<a href="' + h.url + '">' +
                '<div class="search-modal-result-title">' + (h.meta && h.meta.title ? h.meta.title : h.url) + "</div>" +
                '<div class="search-modal-result-excerpt">' + h.excerpt + "</div>" +
              "</a>" +
            "</div>"
          );
        })
        .join("");
      activeIndex = 0;
      highlight();
    } catch (_) {}
  }

  triggers.forEach(function (btn) { btn.addEventListener("click", openModal); });

  document.addEventListener("keydown", function (e) {
    var isK = e.key === "k" || e.key === "K";
    var mod = e.metaKey || e.ctrlKey;
    if (isK && mod) { e.preventDefault(); openModal(); return; }
    if (e.key === "/" && document.activeElement === document.body) { e.preventDefault(); openModal(); return; }
  });

  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal();
  });
  modal.addEventListener("close", function () {
    input.value = ""; renderHint("Start typing to search."); activeIndex = -1;
  });

  input.addEventListener("input", function () { runSearch(input.value); });

  input.addEventListener("keydown", function (e) {
    var items = results.querySelectorAll("[data-search-result]");
    if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(items.length - 1, activeIndex + 1); highlight(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); highlight(); }
    else if (e.key === "Enter") { e.preventDefault(); navigateActive(); }
    else if (e.key === "Escape") { e.preventDefault(); closeModal(); }
  });
})();
