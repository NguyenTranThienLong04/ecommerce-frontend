const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const createDOMPurify = require("dompurify");
const read = file => fs.readFileSync(path.join(__dirname, "../public", file), "utf8");
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const product = { _id: "product1", slug: "shirt", nameProduct: "New name", images: ["https://images.test/new.jpg"] };
const variant = { _id: "variant1", size: "XL", color: "white", price: 999000, idProduct: product };
const snapshot = { nameProduct: "Original shirt", size: "M", color: "black", image: "https://images.test/original.jpg" };
const order = { _id: "order1", createdAt: "2026-10-14", total: 230000, status: "DONE", paymentStatus: "PAID",
  shippingMethod: "COD", canCancel: false, allowedTransitions: [], items: [] };
const live = { _id: "live", quantity: 2, idProductVariant: { ...variant, price: 100000 }, availability: { available: true } };

async function page(t, html, script, respond) {
  const dom = new JSDOM(read(html), { url: "https://shop.test/", runScripts: "outside-only", virtualConsole: new VirtualConsole() });
  const w = dom.window;
  t.after(() => w.close());
  await new Promise(resolve => w.document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  Object.defineProperty(w.HTMLElement.prototype, "innerText", { get() { return this.textContent; }, set(value) { this.textContent = value; } });
  w.localStorage.setItem("token", "user-token");
  w.localStorage.setItem("adminToken", "admin-token");
  w.DOMPurify = createDOMPurify(w);
  w.confirm = () => true;
  const alerts = [], calls = [], errors = [];
  w.alert = message => alerts.push(message);
  w.console.error = error => errors.push(error);
  w.fetch = async (url, options = {}) => {
    calls.push({ path: new URL(url).pathname, ...options });
    return respond(new URL(url).pathname, options);
  };
  w.AppConfig = { apiBase: "https://api.test/api", socketUrl: "https://api.test" };
  w.eval(read("js/api.js"));
  w.eval(read("js/payment-create.js"));
  w.eval(read("js/chat-sync.js"));
  w.eval(read("js/safe-html.js"));
  const ready = w.eval(read(script) + (script === "js/checkout.js" ? "\ncheckoutReady;" : ""));
  if (script === "js/account-orders.js") w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  if (script === "js/checkout.js") await ready;
  await settle();
  return { w, alerts, calls, errors, find: selector => w.document.querySelector(selector) };
}

for (const admin of [false, true]) {
  test((admin ? "admin" : "customer") + " order display uses purchase snapshot after catalog edits/archive", async t => {
    const p = await page(t, admin ? "admin/orders.html" : "pages/account.html", admin ? "admin/js/order.js" : "js/account-orders.js",
      () => response([{ ...order, items: [{ quantity: 2, price: 100000, productSnapshot: snapshot,
        idProductVariant: { ...variant, archivedAt: "2026-10-14" } }] }]));
    const line = p.find(".order-item");
    assert.match(line.textContent, /Original shirt/);
    assert.match(line.textContent, /M.*black/s);
    assert.doesNotMatch(line.textContent, /New name|XL|white|999/);
    assert.equal(line.querySelector("img").src, snapshot.image);
    assert.match(line.textContent, /100[.,]000/);
    assert.deepEqual(p.errors, []);
  });
  test((admin ? "admin" : "customer") + " history renders snapshots without refs and legacy missing refs without crashing", async t => {
    const p = await page(t, admin ? "admin/orders.html" : "pages/account.html", admin ? "admin/js/order.js" : "js/account-orders.js",
      () => response([{ ...order, items: [
        { quantity: 2, price: 100000, productSnapshot: snapshot, idProductVariant: null },
        { quantity: 1, price: 200000, idProductVariant: null },
        { quantity: 1, price: 200000, idProductVariant: { idProduct: null } },
        { quantity: 1, price: 300000, idProductVariant: variant }
      ] }]));
    const lines = [...p.w.document.querySelectorAll(".order-item")];
    assert.equal(lines.length, 4);
    assert.match(lines[0].textContent, /Original shirt/);
    assert.match(lines[1].textContent, /không còn thông tin/);
    assert.match(lines[2].textContent, /không còn thông tin/);
    assert.match(lines[3].textContent, /New name/);
    assert.deepEqual(p.errors, []);
  });
}

test("snapshot names/attributes/image URLs remain escaped and empty purchase attributes never use current values", async t => {
  const attack = '<img data-xss src=x onerror="alert(1)">';
  const p = await page(t, "pages/account.html", "js/account-orders.js", () => response([{ ...order,
    items: [{ quantity: 1, price: 5, idProductVariant: variant,
      productSnapshot: { nameProduct: attack, size: "", color: "", image: "javascript:alert(1)" } }] }]));
  assert.equal(p.find(".order-item .name").textContent, attack);
  assert.equal(p.find("[data-xss]"), null);
  assert.doesNotMatch(p.find(".order-item").textContent, /XL|white/);
  assert.equal(p.find('.order-item img[src^="javascript:"]'), null);
});

for (const kind of ["archived", "missing variant", "missing product"]) {
  test("cart keeps " + kind + " visible/removable and preserves the live row", async t => {
    const stale = { _id: "stale", quantity: 1, idProductVariant: kind === "missing variant" ? null :
      { ...variant, idProduct: kind === "missing product" ? null : product },
      availability: { available: false, message: "Sản phẩm ngừng bán <img data-xss>" } };
    let items = [stale, live];
    const p = await page(t, "pages/cart.html", "js/cart.js", (url, options) => {
      if (options.method === "DELETE") { assert.equal(url, "/api/cart/remove/stale"); items = [live]; return response({}); }
      assert.equal(url, "/api/cart");
      return response({ items });
    });
    assert.equal(p.w.document.querySelectorAll(".cart-row").length, 2);
    assert.match(p.find(".cart-unavailable").textContent, /ngừng bán/);
    assert.equal(p.find("[data-xss]"), null);
    assert.equal(p.find('[data-item-id="stale"] [data-action="quantity"]').disabled, true);
    assert.equal(p.find('[data-item-id="stale"] [data-action="remove"]').disabled, false);
    assert.match(p.find("#cartTotal").textContent, /200[.,]000/);
    p.w.goCheckout();
    assert.match(p.alerts[0], /xóa/);
    p.find('[data-item-id="stale"] [data-action="remove"]').click();
    await settle();
    assert.equal(p.find('[data-item-id="stale"]'), null);
    assert.ok(p.find('[data-item-id="live"]'));
    assert.deepEqual(p.errors, []);
  });
}

test("legacy cart API with a failed product lookup retains the row and remove action", async t => {
  const p = await page(t, "pages/cart.html", "js/cart.js", url => url === "/api/cart"
    ? response({ items: [{ _id: "stale", quantity: 1, idProductVariant: { ...variant, idProduct: "missing" } }] })
    : response({ message: "Not found" }, 404));
  assert.ok(p.find('.cart-row [data-action="remove"]'));
  assert.ok(p.find(".cart-unavailable"));
  assert.deepEqual(p.errors, []);
});

test("checkout shows each stale row and link back to cart; it cannot submit a new invalid cart", async t => {
  const p = await page(t, "pages/checkout.html", "js/checkout.js", url => {
    if (url.endsWith("/me")) return response({ email: "owner@test.invalid" });
    if (url.endsWith("/addresses")) return response([]);
    assert.equal(url, "/api/cart");
    return response({ cart: { _id: "cart1", idUser: "owner" },
      items: [{ _id: "missing", quantity: 1, idProductVariant: null, availability: { available: false, message: "Biến thể không tồn tại" } }, live],
      checkout: { code: "CART_UNAVAILABLE", message: "Kiểm tra dòng ngừng bán" } });
  });
  assert.equal(p.w.document.querySelectorAll("#orderItems .order-item").length, 2);
  assert.match(p.find('[data-item-id="missing"]').textContent, /Biến thể không tồn tại/);
  assert.equal(p.find('[data-item-id="missing"] a').pathname, "/cart");
  assert.equal(p.find("#checkoutBtn").disabled, true);
  await p.w.handleCheckout();
  assert.equal(p.calls.filter(call => call.method === "POST").length, 0);
});

test("admin variants read protected archive view and surface duplicate responses without clearing input", async t => {
  const p = await page(t, "admin/variants.html", "admin/js/variants.js", (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer admin-token");
    if (options.method === "POST") return response({ message: "Variant đã tồn tại" }, 409);
    assert.match(url, /\/products\/admin\//);
    return response({ variants: [{ ...variant, archivedAt: "2026-10-14" }] });
  });
  assert.match(p.find("#variantTable").textContent, /Ngừng bán/);
  p.find("#size").value = "M";
  p.find("#color").value = "black";
  await p.w.addVariant();
  assert.deepEqual(p.alerts, ["Variant đã tồn tại"]);
  assert.equal(p.find("#size").value, "M");
});

test("H01: metadata save omits stock even when the loaded form contains stale inventory", async t => {
  let body;
  const p = await page(t, "admin/variants.html", "admin/js/variants.js", (url, options) => {
    if (options.method === "PATCH") { body = JSON.parse(options.body); return response({ ...variant, ...body, stock: 3 }); }
    return response({ variants: [{ ...variant, stock: 5, inventoryVersion: 0 }] });
  });
  p.find('[data-action="editVariant"]').click();
  assert.equal(p.find("#stock").disabled, true);
  p.find("#price").value = "120000";
  await p.w.addVariant();
  assert.equal(body.price, "120000");
  assert.equal(Object.hasOwn(body, "stock"), false);
  assert.equal(Object.hasOwn(body, "inventoryVersion"), false);
});
test("H01: explicit stock edits send the loaded version, and a conflict requires deliberate refresh/reselection", async t => {
  let stock = 5, version = 0;
  const writes = [];
  const p = await page(t, "admin/variants.html", "admin/js/variants.js", (url, options) => {
    if (options.method === "PATCH") {
      assert.match(url, /\/stock$/);
      const body = JSON.parse(options.body); writes.push(body);
      if (writes.length === 1) { stock = 3; version = 1; return response({ code: "INVENTORY_CHANGED", message: "Tồn kho đã thay đổi" }, 409); }
      stock = body.stock; version++;
      return response({ ...variant, stock, inventoryVersion: version });
    }
    return response({ variants: [{ ...variant, stock, inventoryVersion: version }] });
  });
  p.find('[data-action="editStock"]').click();
  p.find("#newStock").value = "8";
  await p.w.saveStock();
  assert.deepEqual(writes, [{ stock: 8, expectedStock: 5, expectedVersion: 0 }]);
  assert.match(p.find("#inventoryMessage").textContent, /Chọn lại/);
  await p.w.saveStock(); assert.equal(writes.length, 1, "no automatic replay with a refreshed version");
  p.find('[data-action="editStock"]').click();
  assert.equal(p.find("#newStock").value, "3");
  p.find("#newStock").value = "8";
  await p.w.saveStock();
  assert.deepEqual(writes[1], { stock: 8, expectedStock: 3, expectedVersion: 1 });
  assert.equal(p.find("#inventoryForm").hidden, true);
});
