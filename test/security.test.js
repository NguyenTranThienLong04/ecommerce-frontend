const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");
const read = file => fs.readFileSync(path.join(__dirname, "../public", file), "utf8");
const attack = `"><img data-xss src=x onerror="window.__xss=1"><svg onload="window.__xss=1"></svg>`;
const quoted = `');window.__xss=1;//"<&`;
const description = `<h2>Details</h2><p><strong>Bold</strong> <em>Italic</em></p><ul><li>One</li></ul>
  <figure class="table"><table><tbody><tr><td>Cell</td></tr></tbody></table></figure>
  <a href="https://example.com/info">More</a><img src="https://example.com/image.jpg" alt="Product">
  <script>window.__xss=1</script><img src=x onerror="window.__xss=1">
  <a href="javascript:window.__xss=1">Attack</a><iframe srcdoc="<script>window.__xss=1</script>"></iframe>`;
const product = { _id: "product1", slug: quoted, nameProduct: attack, images: [attack, "javascript:alert(1)"],
  selectedTags: ["NEW"], customTags: [attack], description, minPrice: 100, totalStock: 4 };
const variant = { _id: "variant1", idProduct: "product1", size: quoted, color: attack, price: 100, stock: 4 };
const address = { _id: quoted, receiverName: attack, phone: quoted, addressLine: attack,
  ward: quoted, district: attack, city: attack, isDefault: true };
const order = { _id: "order1", createdAt: "2026-01-01", total: 200, status: "PENDING", paymentStatus: "UNPAID",
  shippingMethod: "VNPAY", receiverName: attack, phone: quoted, addressLine: attack, district: attack, city: attack,
  idUser: { name: attack, email: attack }, items: [{ quantity: 2, price: 100,
    idProductVariant: { ...variant, idProduct: product } }] };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

async function page(t, html, script, respond, suffix = "") {
  const dom = new JSDOM(read(html), { url: "https://shop.test/" + html + suffix, runScripts: "outside-only" });
  const w = dom.window;
  t.after(() => w.close());
  await new Promise(resolve => w.document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  // jsdom has no layout-backed innerText; emulate its plain-text behavior.
  Object.defineProperty(w.HTMLElement.prototype, "innerText", {
    get() { return this.textContent; }, set(value) { this.textContent = value; }
  });
  w.localStorage.setItem("token", "test-token");
  w.localStorage.setItem("adminToken", "test-admin-token");
  w.localStorage.setItem("adminUser", JSON.stringify({ id: "admin", email: attack }));
  w.localStorage.setItem("user", JSON.stringify({ id: "user" }));
  w.alert = () => {};
  w.confirm = () => false;
  w.prompt = () => null;
  w.scrollTo = () => {};
  w.requestAnimationFrame = () => 0;
  w.Swiper = function () {};
  w.Chart = function () {};
  w.editor = { setData(value) { this.value = value; }, getData() { return this.value || ""; } };
  w.DOMPurify = createDOMPurify(w);
  const calls = [];
  const errors = [];
  w.console.error = (...args) => errors.push(args);
  w.fetch = async (url, options = {}) => {
    const parsed = new URL(url, w.location.href);
    calls.push({ url: parsed, ...options });
    const data = await respond(parsed, options);
    return { ok: true, json: async () => data, text: async () => String(data) };
  };
  w.AppConfig = { apiBase: "https://api.test/api", socketUrl: "https://api.test" };
  w.eval(read("js/api.js"));
  w.eval(read("js/payment-create.js"));
  w.eval(read("js/chat-sync.js"));
  w.eval(read("js/safe-html.js"));
  if (script) w.eval(read(script));
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await settle();
  return { w, calls, errors, find: selector => w.document.querySelector(selector) };
}

function safe(container) {
  assert.ok(container, "rendered container exists");
  assert.equal(container.querySelector("script, svg, math, iframe, [data-xss]"), null);
  for (const el of container.querySelectorAll("*")) {
    for (const attr of el.attributes) assert.doesNotMatch(attr.name, /^on/i, el.outerHTML);
    for (const attr of ["href", "src"]) {
      assert.doesNotMatch(el.getAttribute(attr) || "", /^\s*(javascript|vbscript|data):/i);
    }
  }
}

test("search query is literal text even when the API returns no matches", async t => {
  const p = await page(t, "pages/search.html", "js/search.js",
    () => ({ products: [], total: 0, page: 1, totalPages: 0 }), "?q=" + encodeURIComponent(attack));
  assert.ok(p.find("#search-count").textContent.includes(attack));
  safe(p.find("#search-count"));
  assert.deepEqual(p.errors, []);
});

for (const name of ["index", "shop", "search"]) {
  test(name + ": product text/tags/attributes are escaped; card listeners keep quoted slugs", async t => {
    const p = await page(t, "pages/" + name + ".html", "js/" + name + ".js", url => {
      if (url.pathname.endsWith("/banners")) return [{ image: attack, link: "javascript:alert(1)" }];
      if (url.pathname.endsWith("/filters")) return { sizes: [quoted], colors: [attack], categories: [attack] };
      return { products: [product, product], page: 1, totalPages: 1, total: 2 };
    });
    assert.equal(p.find(".product__name").textContent.trim(), attack);
    assert.equal(p.find(".product__badges").children.length, 2);
    safe(p.find("#products-list"));
    const slugs = [];
    p.w.goToDetail = slug => slugs.push(slug);
    p.w.document.querySelectorAll(".product__item").forEach(card => card.click());
    assert.deepEqual(slugs, [quoted, quoted]);
    if (name === "index") safe(p.find("#banner-list"));
    if (name === "shop") {
      assert.equal(p.find("#filter-size").options[1].value, quoted);
      safe(p.find("#filter-color"));
    }
    assert.deepEqual(p.errors, []);
  });
}

test("product detail sanitizes rich HTML, preserves formatting and binds size/color/image clicks", async t => {
  const p = await page(t, "pages/product-detail.html", "js/product-detail.js", () => ({ product, variants: [variant] }));
  const rich = p.find("#productDescription");
  safe(rich);
  for (const selector of ["h2", "strong", "em", "ul li", "figure.table table td", "a[href]", "img[alt]"])
    assert.ok(rich.querySelector(selector), "preserves " + selector);
  safe(p.find("#sizes"));
  safe(p.find("#colors"));
  safe(p.find("#thumbnails"));
  p.find("#sizes button").click();
  p.find("#colors button").click();
  assert.equal(p.find("#addToCartBtn").disabled, false);
  p.w.document.querySelectorAll("#thumbnails img")[1].click();
  assert.doesNotMatch(p.find("#mainImage").src, /^javascript:/);
  assert.deepEqual(p.errors, []);
});

test("cart escapes stored product/variant data and preserves quantity/remove arguments", async t => {
  const p = await page(t, "pages/cart.html", "js/cart.js", url => url.pathname.endsWith("/cart")
    ? { items: [{ _id: quoted, quantity: 2, idProductVariant: variant }] } : { product });
  safe(p.find(".cart-items"));
  assert.equal(p.find(".cart-items h4").textContent, attack);
  assert.equal(p.find(".cart-items a").pathname, "/" + encodeURIComponent(quoted));
  const actions = [];
  p.w.changeQuantity = (id, quantity) => actions.push([id, quantity]);
  p.w.removeItem = id => actions.push([id]);
  p.w.document.querySelectorAll(".cart-items button").forEach(button => button.click());
  assert.deepEqual(actions, [[quoted, 1], [quoted, 3], [quoted]]);
  assert.deepEqual(p.errors, []);
});

test("checkout escapes products while keeping address option text and totals", async t => {
  const p = await page(t, "pages/checkout.html", "js/checkout.js", url => {
    if (url.pathname.endsWith("/cart")) return {
      cart: { _id: "cart1", idUser: "user" },
      items: [{ _id: "item1", quantity: 2, idProductVariant: variant }],
      checkout: { snapshot: "fixture", subtotal: 200, shippingFee: 30000, total: 30200,
        lines: [{ itemId: "item1", lineTotal: 200 }] }
    };
    if (url.pathname.endsWith("/addresses")) return [address];
    if (url.pathname.endsWith("/me")) return { email: attack };
    return { product };
  });
  safe(p.find("#orderItems"));
  safe(p.find("#addressBook"));
  assert.equal(p.find(".order-name").textContent, attack);
  assert.equal(p.find("#receiverName").value, attack);
  assert.ok(p.find("#orderTotal").textContent.includes("30.200"));
  assert.deepEqual(p.errors, []);
});

test("address list escapes customer fields and passes the original ID to actions", async t => {
  const p = await page(t, "pages/account.html", "js/account-address.js", () => [address]);
  safe(p.find("#address-list"));
  assert.equal(p.find("#address-list b").textContent, attack);
  const ids = [];
  for (const name of ["editAddress", "setDefaultAddress", "deleteAddress"]) p.w[name] = id => ids.push(id);
  p.w.document.querySelectorAll("#address-list button").forEach(button => button.click());
  assert.deepEqual(ids, [quoted, quoted, quoted]);
});

for (const admin of [false, true]) {
  test((admin ? "admin" : "customer") + " orders escape stored fields and preserve nested detail/actions", async t => {
    const p = await page(t, admin ? "admin/orders.html" : "pages/account.html",
      admin ? "admin/js/order.js" : "js/account-orders.js", () => [order]);
    safe(p.find("#order-list"));
    assert.equal(p.find(".order-item").querySelector(".name, b").textContent, attack);
    assert.ok(p.find(".view-order"));
    p.find(".view-order").click();
    assert.equal(p.find(".order-detail").style.display, "table-row");
    if (!admin) assert.ok(p.find(".btn-pay-again"));
    assert.deepEqual(p.errors, []);
  });
}

test("admin users escape profiles, preserve edit arguments and role selection", async t => {
  const p = await page(t, "admin/users.html", "admin/js/users.js", () => [
    { _id: quoted, name: attack, email: attack, phone: quoted, role: "ADMIN" },
    { _id: "second", name: "Second", role: "USER" }
  ]);
  safe(p.find("#userTable"));
  let args;
  p.w.editUser = (...values) => { args = values; };
  p.find('[data-action="editUser"]').click();
  assert.deepEqual(args, [quoted, attack, quoted]);
  assert.equal(p.find(".user-role").value, "ADMIN");
  p.w.changeRole = (...values) => { args = values; };
  p.find(".user-role").value = "USER";
  p.find(".user-role").dispatchEvent(new p.w.Event("change"));
  assert.deepEqual(args.slice(0, 2), [quoted, "USER"]);
  assert.equal(args[2], p.find(".user-role"));
  assert.equal(args[3], "ADMIN");
  assert.deepEqual(p.errors, []);
});

test("admin variants/categories keep quote-containing values out of executable handlers", async t => {
  const variants = await page(t, "admin/variants.html", "admin/js/variants.js", () => ({ variants: [variant] }));
  safe(variants.find("#variantTable"));
  variants.find('[data-action="editVariant"]').click();
  assert.equal(variants.find("#size").value, quoted);
  assert.equal(variants.find("#color").value, attack);
  const categories = await page(t, "admin/categories.html", "admin/js/categories.js", () => [{ _id: quoted, nameCategory: attack }]);
  safe(categories.find("#categoryTable"));
  categories.find('[data-action="startEdit"]').click();
  assert.equal(categories.find("#categoryName").value, attack);
});

test("admin products sanitize HTML before editor.setData and escape preview/tags/options", async t => {
  const p = await page(t, "admin/products.html", "admin/js/products.js", url => {
    if (url.pathname.endsWith("/categories")) return [{ _id: quoted, nameCategory: attack }];
    return url.pathname.endsWith("/products/admin") ? { products: [product], totalPages: 1 } : { product };
  });
  safe(p.find("#productTable"));
  safe(p.find("#categorySelect"));
  p.find('[data-action="editProduct"]').click();
  await settle();
  const preview = p.w.document.createElement("div");
  preview.innerHTML = p.w.editor.value;
  safe(preview);
  assert.ok(preview.querySelector("strong"));
  assert.deepEqual(p.errors, []);
});

test("admin banners/dashboard safely render stored strings", async t => {
  const banners = await page(t, "admin/banners.html", "admin/js/banners.js", () => [
    { _id: quoted, title: attack, image: attack, order: 1, status: true }
  ]);
  safe(banners.find("#banner-table tbody"));
  let edited;
  banners.w.editBanner = id => { edited = id; };
  banners.find('[data-action="editBanner"]').click();
  assert.equal(edited, quoted);
  const dashboard = await page(t, "admin/dashboard.html", "admin/js/dashboard.js", url => {
    if (url.pathname.endsWith("/dashboard")) return { totalProducts: 1, totalOrders: 1, totalUsers: 1, revenue: 1, statusStats: {} };
    if (url.pathname.endsWith("/orders")) return [{ ...order, status: attack }];
    return [];
  });
  safe(dashboard.find("#recentOrders"));
  assert.ok(dashboard.find("#recentOrders").textContent.includes(attack));
  assert.deepEqual(dashboard.errors, []);
});

test("all admin sidebar greetings render localStorage email as text", async t => {
  for (const name of ["banners", "categories", "chat", "dashboard", "orders", "products", "users", "variants"]) {
    const p = await page(t, "admin/" + name + ".html", null, () => read("admin/slidebar.html"));
    const inline = [...p.w.document.scripts].find(script => script.textContent.includes("adminInfoElem"));
    p.w.eval(inline.textContent);
    await settle();
    safe(p.find("#adminInfo"));
    assert.ok(p.find("#adminInfo").textContent.includes(attack));
  }
});

function fakeSocket() {
  const handlers = {};
  const sent = [];
  return { handlers, sent, connected: false,
    on(name, fn) { handlers[name] = fn; },
    emit(name, data, ack) { sent.push({ name, data }); ack?.({ ok: true, ...(name === "sendMessage" ? { messageId: "sent1" } : {}) }); },
    disconnect() { this.connected = false; }
  };
}

test("customer chat authenticates with JWT, rejoins after reconnect and sends no userId", async t => {
  const p = await page(t, "pages/search.html", null, url =>
    url.pathname.endsWith("/conversation") ? { _id: "conversation1" } : []);
  const socket = fakeSocket();
  let options;
  p.w.io = (url, authOptions) => { options = authOptions; return socket; };
  p.w.eval(read("js/chat-widget.js"));
  await settle();
  assert.equal(options.auth.token, "test-token");
  socket.connected = true;
  socket.handlers.connect();
  await settle();
  assert.equal(socket.sent.at(-1).data, "conversation1");
  p.find("#chat-input").value = attack;
  p.find("#chat-send").click();
  assert.equal(socket.sent.at(-1).name, "sendMessage");
  assert.equal(socket.sent.at(-1).data.content, attack);
  assert.equal(Object.hasOwn(socket.sent.at(-1).data, "userId"), false);
  socket.handlers.newMessage({ _id: "message1", idConversation: "conversation1", idUser: { _id: "other", name: attack }, content: attack });
  safe(p.find("#chat-messages"));
  assert.equal(p.find(".message-bubble").textContent, attack);
  socket.handlers.connect();
  assert.equal(socket.sent.at(-1).name, "joinConversation");
});

test("guest chat does not open an unauthenticated socket", async t => {
  const p = await page(t, "pages/search.html", null, () => []);
  p.w.localStorage.removeItem("token");
  let connections = 0;
  p.w.io = () => { connections++; return fakeSocket(); };
  p.w.eval(read("js/chat-widget.js"));
  await settle();
  assert.equal(connections, 0);
});

test("admin chat uses adminToken, rejoins its selected conversation and renders messages as text", async t => {
  const p = await page(t, "admin/chat.html", null, url => url.pathname.endsWith("/conversations")
    ? [{ idUser: { _id: "user", name: attack }, idConversation: { _id: "conversation1" } }] : []);
  const socket = fakeSocket();
  let options;
  p.w.io = (url, authOptions) => { options = authOptions; return socket; };
  p.w.eval(read("admin/js/admin-chat.js"));
  await settle();
  assert.equal(options.auth.token, "test-admin-token");
  p.find("#userList li").click();
  await settle();
  socket.connected = true;
  socket.handlers.connect();
  await settle();
  assert.equal(socket.sent.at(-1).data, "conversation1");
  p.find("#messageInput").value = attack;
  p.find("#sendBtn").click();
  assert.equal(Object.hasOwn(socket.sent.at(-1).data, "userId"), false);
  socket.handlers.newMessage({ _id: "message1", idConversation: "conversation1", idUser: { _id: "user", name: attack }, content: attack });
  safe(p.find("#userList"));
  safe(p.find("#chatMessages"));
  assert.equal(p.find(".message-bubble").textContent, attack);
});

test("URL handling rejects script protocols and product slugs remain a single path segment", async t => {
  const p = await page(t, "pages/search.html", null, () => ({}));
  for (const value of ["javascript:alert(1)", "java\nscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x"]) {
    assert.equal(p.w.SafeHTML.url(value), "#");
  }
  assert.equal(p.w.SafeHTML.url("https://example.com/a?q=1&b=2"), "https://example.com/a?q=1&b=2");
  assert.equal(p.w.SafeHTML.productPath("/evil.example"), "/%2Fevil.example");
});

test("every page using safe templates loads the local sanitizer/helper before its application script", () => {
  for (const folder of ["pages", "admin"]) {
    for (const file of fs.readdirSync(path.join(__dirname, "../public", folder)).filter(file => file.endsWith(".html"))) {
      const content = read(folder + "/" + file);
      const dom = new JSDOM(content);
      for (const script of dom.window.document.querySelectorAll("script[src]")) {
        const src = script.getAttribute("src");
        if (/^https?:/.test(src) || src.startsWith("/vendor/") || src === "/runtime-config.js") continue;
        // Customer pages are served at /, /shop, /search, etc.; admin pages at /admin/*.
        const base = folder === "pages" ? "/" : "/admin/";
        const relative = new URL(src, "https://shop.test" + base).pathname.slice(1);
        const code = read(relative);
        new vm.Script(code, { filename: relative });
        if (!code.includes("SafeHTML.")) continue;
        assert.ok(content.indexOf('/vendor/dompurify.js') >= 0);
        assert.ok(content.indexOf('/js/safe-html.js') >= 0);
        assert.ok(content.indexOf('/vendor/dompurify.js') < content.indexOf('/js/safe-html.js'));
        assert.ok(content.indexOf('/js/safe-html.js') < content.indexOf(src));
      }
      dom.window.close();
    }
  }
});
