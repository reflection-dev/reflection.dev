// Wrap each <pre> with a header (language label + copy button) and wire copy.
(function () {
  var blocks = document.querySelectorAll("pre");
  if (!blocks.length) return;

  var LANG_CLASS = /(?:^|\s)language-([\w+-]+)/;

  blocks.forEach(function (pre) {
    if (pre.closest(".code-wrap")) return;
    var codeEl = pre.querySelector("code");
    var lang = "";
    if (codeEl) {
      var m = (codeEl.className || "").match(LANG_CLASS);
      if (m) lang = m[1];
    }

    var wrap = document.createElement("figure");
    wrap.className = "code-wrap";
    pre.parentNode.insertBefore(wrap, pre);

    var head = document.createElement("div");
    head.className = "code-head";

    var label = document.createElement("span");
    label.className = "code-lang";
    label.textContent = lang || "text";
    head.appendChild(label);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-copy";
    btn.setAttribute("aria-label", "Copy code");
    btn.textContent = "Copy";
    head.appendChild(btn);

    wrap.appendChild(head);
    wrap.appendChild(pre);

    btn.addEventListener("click", function () {
      var text = codeEl ? codeEl.innerText : pre.innerText;
      var done = function () {
        btn.textContent = "Copied";
        btn.classList.add("is-copied");
        setTimeout(function () {
          btn.textContent = "Copy";
          btn.classList.remove("is-copied");
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (_) {}
        document.body.removeChild(ta);
      }
    });
  });
})();
