const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { JSDOM, VirtualConsole } = require("jsdom");
const createDOMPurify = require("dompurify");
const read = file => fs.readFileSync(path.join(__dirname, "../public", file), "utf8");
const address = { _id: "address1", receiverName: "Customer", phone: "0901234567", addressLine: "1 Test Street",
  ward: "Ward", district: "District", city: "City", isDefault: true };
const cart = { cart: { _id: "cart1", idUser: "user1" }, paymentMethods: ["COD", "VNPAY"],
  items: [{ _id: "item1", quantity: 2, idProductVariant: { idProduct: "product1", price: 999, size: "M", color: "Black" } }],
  checkout: { snapshot: "a".repeat(64), subtotal: 200000, shippingFee: 30000, total: 230000,
    lines: [{ itemId: "item1", lineTotal: 200000 }] } };
const order = { _id: "order1", subtotal: 200000, shippingFee: 30000, total: 230000,
  shippingMethod: "COD", paymentStatus: "UNPAID", status: "PENDING" };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

async function page(t, submit, options = {}) {
  const dom = new JSDOM(read("pages/checkout.html"), {
    url: "https://shop.test/checkout", runScripts: "outside-only", virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  t.after(() => w.close());
  Object.defineProperty(w.HTMLElement.prototype, "innerText", {
    get() { return this.textContent; }, set(value) { this.textContent = value; }
  });
  w.crypto.randomUUID = randomUUID;
  w.DOMPurify = createDOMPurify(w);
  w.localStorage.setItem("token", "test-token");
  if (options.pending) w.sessionStorage.setItem("checkoutAttempt:user1", options.pending);
  if (options.paymentPending) w.sessionStorage.setItem("paymentCreate:user1:order1", options.paymentPending);
  const calls = [];
  w.fetch = async (url, request = {}) => {
    const pathname = new URL(url).pathname;
    if (request.method === "POST") {
      const body = JSON.parse(request.body);
      calls.push({ pathname, body });
      return submit(pathname, body, w);
    }
    if (pathname.endsWith("/cart")) return response(options.cart || cart);
    if (pathname.endsWith("/addresses")) return response([address]);
    if (pathname.endsWith("/me")) return response({ _id: "user1", email: "test@example.com" });
    if (pathname.endsWith("/products/product1")) return response({ product: { nameProduct: "Shirt", images: [] } });
    throw new Error("Unexpected fetch " + pathname);
  };
  w.AppConfig = { apiBase: "https://api.test/api", socketUrl: "https://api.test" };
  w.eval(read("js/api.js"));
  w.eval(read("js/payment-create.js"));
  w.eval(read("js/chat-sync.js"));
  w.eval(read("js/safe-html.js"));
  await w.eval(read("js/checkout.js") + "\ncheckoutReady;");
  return { w, calls, find: selector => w.document.querySelector(selector),
    pending: () => w.sessionStorage.getItem("checkoutAttempt:user1") };
}

test("checkout displays backend totals/line totals and sends no client money or quantity", async t => {
  const p = await page(t, () => response({ order }, 201));
  assert.ok(p.find("#subTotal").textContent.includes("200.000"));
  assert.ok(p.find("#shippingFee").textContent.includes("30.000"));
  assert.ok(p.find(".order-price").textContent.includes("200.000"));
  await p.w.handleCheckout();
  assert.equal(p.calls.length, 1);
  const body = p.calls[0].body;
  for (const key of ["price", "subtotal", "total", "shippingFee", "quantity"]) assert.equal(Object.hasOwn(body, key), false);
  assert.equal(body.cartId, "cart1");
  assert.equal(body.cartSnapshot, cart.checkout.snapshot);
  assert.equal(body.addressId, "address1");
  assert.match(body.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(p.pending(), null);
});

test("duplicate clicks share one in-flight request", async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const p = await page(t, async () => { await gate; return response({ order }, 201); });
  const first = p.w.handleCheckout();
  await settle();
  await p.w.handleCheckout();
  assert.equal(p.calls.length, 1);
  assert.equal(p.find("#checkoutBtn").disabled, true);
  release();
  await first;
  await p.w.handleCheckout();
  assert.equal(p.calls.length, 1);
});

for (const failure of ["network", "server", "uncertain commit"]) {
  test(failure + " keeps the key and immutable payload for retry", async t => {
    let count = 0;
    const p = await page(t, (url, body, w) => {
      assert.ok(w.sessionStorage.getItem("checkoutAttempt:user1"), "persisted before POST");
      if (count++ === 0) {
        if (failure === "network") throw new Error("Response lost");
        return response({ code: failure === "server" ? "CHECKOUT_FAILED" : "CHECKOUT_RETRY" }, failure === "server" ? 500 : 409);
      }
      return response({ order, replayed: true });
    });
    await p.w.handleCheckout();
    assert.ok(p.pending());
    assert.equal(p.find("#checkoutBtn").disabled, false);
    assert.equal(p.find("#receiverName").readOnly, true);
    await p.w.handleCheckout();
    assert.deepEqual(p.calls[0].body, p.calls[1].body);
    assert.equal(p.pending(), null);
  });
}

test("reload with a new cart retries the original snapshot/key instead of consuming the new cart", async t => {
  const first = await page(t, () => { throw new Error("Timeout"); });
  await first.w.handleCheckout();
  const second = await page(t, () => response({ order, replayed: true }), {
    pending: first.pending(), cart: { ...cart, checkout: { ...cart.checkout, snapshot: "b".repeat(64) } }
  });
  assert.match(second.find("#checkoutMessage").textContent, /trước/);
  await second.w.handleCheckout();
  assert.deepEqual(second.calls[0].body, first.calls[0].body);
});

test("a definitive cart conflict clears the attempt; explicit resubmission gets a new key", async t => {
  let count = 0;
  const p = await page(t, () => count++ === 0
    ? response({ code: "CART_CHANGED", message: "Cart changed" }, 409) : response({ order }, 201));
  await p.w.handleCheckout();
  assert.equal(p.pending(), null);
  assert.equal(p.find("#checkoutBtn").disabled, false);
  assert.equal(p.find("#receiverName").readOnly, false);
  await p.w.handleCheckout();
  assert.notEqual(p.calls[0].body.idempotencyKey, p.calls[1].body.idempotencyKey);
});

test("VNPay link failure retries the existing order with the original checkout key", async t => {
  let links = 0;
  const p = await page(t, url => {
    if (url.endsWith("/orders")) return response({ order: { ...order, shippingMethod: "VNPAY" } });
    if (links++ === 0) return response({ message: "Temporary error" }, 500);
    return response({ reference: "testref", paymentUrl: "https://payment.test/pay?order=order1" });
  });
  p.find('input[value="VNPAY"]').checked = true;
  await p.w.handleCheckout();
  assert.ok(p.pending());
  assert.equal(p.find("#checkoutBtn").disabled, false);
  await p.w.handleCheckout();
  assert.equal(p.calls.length, 4);
  assert.deepEqual(p.calls[0].body, p.calls[2].body);
  assert.equal(p.calls[1].body.orderId, "order1");
  assert.match(p.calls[1].body.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.deepEqual(p.calls[3].body, p.calls[1].body);
  assert.equal(p.pending(), null);
});

test("editing a saved address switches to validated free-form input", async t => {
  const p = await page(t, () => response({ order }, 201));
  p.find("#addressLine").value = "2 New Street";
  p.find("#addressLine").dispatchEvent(new p.w.Event("input"));
  await p.w.handleCheckout();
  assert.equal(Object.hasOwn(p.calls[0].body, "addressId"), false);
  assert.equal(p.calls[0].body.addressLine, "2 New Street");
});

test("invalid form/empty cart does not start a checkout", async t => {
  const p = await page(t, () => assert.fail("Unexpected checkout"));
  p.find("#phone").value = "invalid";
  await p.w.handleCheckout();
  assert.equal(p.calls.length, 0);
  assert.equal(p.pending(), null);
  assert.equal(p.find("#checkoutBtn").disabled, false);
  const empty = await page(t, () => assert.fail("Unexpected checkout"), {
    cart: { cart: cart.cart, items: [], checkout: { code: "EMPTY_CART", message: "Empty cart" } }
  });
  await empty.w.handleCheckout();
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.find("#checkoutBtn").disabled, true);
});

test("actual request timeout after server commit retries the same key and receives the same order", async t => {
  const stored = new Map();
  let attempts = 0, timeout;
  const p = await page(t, (url, body) => {
    if (!stored.has(body.idempotencyKey)) stored.set(body.idempotencyKey, order);
    if (++attempts === 1) return new Promise(() => {}); // Order committed, response lost.
    return response({ order: stored.get(body.idempotencyKey), replayed: true });
  });
  const setTimeout = p.w.setTimeout.bind(p.w);
  p.w.setTimeout = (callback, delay) => { if (delay === 15000) { timeout = callback; return 999; } return setTimeout(callback, delay); };
  const first = p.w.handleCheckout();
  await settle();
  assert.ok(p.pending());
  assert.equal(p.find("#checkoutBtn").disabled, true);
  timeout(); await first;
  assert.equal(p.find("#checkoutBtn").disabled, false);
  assert.ok(p.pending());
  await p.w.handleCheckout();
  assert.deepEqual(p.calls[0].body, p.calls[1].body);
  assert.equal(stored.size, 1);
  assert.equal(p.pending(), null);
});

test("malformed success JSON preserves the unresolved attempt and permits a safe retry", async t => {
  const p = await page(t, () => response({ order, replayed: true }));
  const fetch = p.w.fetch;
  let first = true;
  p.w.fetch = async (url, options) => {
    const result = await fetch(url, options);
    if (options?.method === "POST" && first) {
      first = false;
      return { ok: true, status: 201, json: async () => { throw new SyntaxError("Broken response"); } };
    }
    return result;
  };
  await p.w.handleCheckout();
  assert.ok(p.pending());
  assert.equal(p.find("#checkoutBtn").disabled, false);
  await p.w.handleCheckout();
  assert.deepEqual(p.calls[0].body, p.calls[1].body);
  assert.equal(p.pending(), null);
});

test("checkout 401 retains its attempt for resolution after login and never clears the admin session", async t => {
  const p = await page(t, () => response({}, 401));
  p.w.localStorage.setItem("adminToken", "admin-token");
  await p.w.handleCheckout();
  assert.ok(p.pending());
  assert.equal(p.w.localStorage.getItem("token"), null);
  assert.equal(p.w.localStorage.getItem("adminToken"), "admin-token");
  assert.equal(p.find("#checkoutBtn").disabled, false);
  assert.match(p.find("#checkoutMessage").textContent, /đăng nhập/);
});

test("corrupt saved checkout cannot silently discard an unresolved attempt and create another order", async t => {
  for (const saved of ["{broken", '{"payload":{"idempotencyKey":"old-key"}}', "null"]) {
    const p = await page(t, () => assert.fail("Must resolve the saved attempt first"), { pending: saved });
    assert.equal(p.pending(), saved);
    assert.equal(p.find("#checkoutBtn").disabled, true);
    assert.match(p.find("#checkoutMessage").textContent, /kiểm tra mục Đơn hàng/);
    await p.w.handleCheckout();
    assert.equal(p.calls.length, 0);
  }
});

test("M01: backend capabilities hide and disable VNPay, reject a tampered choice, and allow COD", async t => {
  const p = await page(t, () => response({ order }, 201), { cart: { ...cart, paymentMethods: ["COD"] } });
  const vnpay = p.find('input[value="VNPAY"]');
  assert.equal(vnpay.disabled, true); assert.equal(vnpay.closest("label").hidden, true);
  vnpay.checked = true;
  await p.w.handleCheckout();
  assert.equal(p.calls.length, 0); assert.equal(p.pending(), null);
  p.find('input[value="COD"]').checked = true;
  await p.w.handleCheckout();
  assert.equal(p.calls.length, 1); assert.equal(p.calls[0].body.shippingMethod, "COD");
});
test("M02: reload after payment response loss preserves both the checkout key and payment key", async t => {
  const first = await page(t, url => {
    if (url.endsWith("/orders")) return response({ order: { ...order, shippingMethod: "VNPAY" } });
    throw new TypeError("Response lost after payment commit");
  });
  first.find('input[value="VNPAY"]').checked = true;
  await first.w.handleCheckout();
  const saved = first.w.sessionStorage.getItem("paymentCreate:user1:order1");
  assert.ok(saved); assert.ok(first.pending());
  const second = await page(t, url => url.endsWith("/orders")
    ? response({ order: { ...order, shippingMethod: "VNPAY" }, replayed: true })
    : response({ reference: "sameReference", paymentUrl: "https://gateway.test/existing" }),
  { pending: first.pending(), paymentPending: saved });
  await second.w.handleCheckout();
  assert.deepEqual(second.calls[0].body, first.calls[0].body);
  assert.deepEqual(second.calls[1].body, first.calls[1].body);
  assert.equal(second.w.sessionStorage.getItem("paymentCreate:user1:order1"), null);
  assert.equal(second.pending(), null);
});
