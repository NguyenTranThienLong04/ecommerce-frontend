/* Plain API/query values are text. Only html templates and richText may contain markup. */
(function () {
  const markup = new WeakMap();
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  function trusted(value) {
    const result = Object.freeze({ toString: () => value });
    markup.set(result, value);
    return result;
  }
  function interpolate(value) {
    if (Array.isArray(value)) return value.map(interpolate).join("");
    return markup.has(value) ? markup.get(value) : escape(value);
  }
  function html(strings, ...values) {
    return trusted(strings.reduce((out, part, i) => out + part +
      (i < values.length ? interpolate(values[i]) : ""), ""));
  }
  function url(value, fallback = "#") {
    try {
      const parsed = new URL(String(value || fallback), window.location.origin);
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : fallback;
    } catch {
      return fallback;
    }
  }
  function richText(value) {
    return trusted(DOMPurify.sanitize(String(value ?? ""), {
      ALLOWED_TAGS: ["p", "br", "strong", "em", "b", "i", "u", "s", "ul", "ol", "li",
        "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "a", "table", "caption",
        "thead", "tbody", "tfoot", "tr", "th", "td", "figure", "figcaption", "img", "span", "div"],
      ALLOWED_ATTR: ["href", "title", "src", "alt", "width", "height", "class", "colspan", "rowspan"],
      ALLOW_DATA_ATTR: false
    }));
  }
  function textFromHTML(value) {
    const template = document.createElement("template");
    template.innerHTML = richText(value);
    return template.content.textContent;
  }
  window.SafeHTML = Object.freeze({ html, url, richText, textFromHTML,
    productPath: slug => "/" + encodeURIComponent(String(slug ?? "")) });
})();
