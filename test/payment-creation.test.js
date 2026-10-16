const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { JSDOM, VirtualConsole } = require("jsdom");
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function page(t, respond, saved) {
  const dom = new JSDOM("<body></body>", { url: "https://shop.test", runScripts: "outside-only", virtualConsole: new VirtualConsole() });
  const w = dom.window; t.after(() => w.close());
  w.crypto.randomUUID = randomUUID;
  w.AppConfig = { apiBase: "https://api.test/api" };
  w.localStorage.setItem("token", "customer-token");
  if (saved !== undefined) w.sessionStorage.setItem("paymentCreate:user1:order1", saved);
  const calls = [];
  w.fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    return respond(body, w);
  };
  for (const file of ["api.js", "payment-create.js"]) w.eval(fs.readFileSync(path.join(__dirname, "../public/js", file), "utf8"));
  return { w, calls, saved: () => w.sessionStorage.getItem("paymentCreate:user1:order1") };
}
const link = { reference: "paymentReference", paymentUrl: "https://gateway.test/pay" };
test("M02: unknown outcome keeps the same key across pages and create/recreate endpoints; acknowledged new action gets a new key", async t => {
  const first = page(t, (body, w) => {
    assert.equal(JSON.parse(w.sessionStorage.getItem("paymentCreate:user1:order1")).idempotencyKey, body.idempotencyKey);
    throw new TypeError("Response lost");
  });
  await assert.rejects(first.w.PaymentCreate.create("user1", "order1"));
  const second = page(t, () => response(link), first.saved());
  assert.equal(await second.w.PaymentCreate.create("user1", "order1", "recreate"), link.paymentUrl);
  assert.deepEqual(second.calls[0].body, first.calls[0].body);
  assert.equal(second.saved(), null);
  await second.w.PaymentCreate.create("user1", "order1", "recreate");
  assert.notEqual(second.calls[0].body.idempotencyKey, second.calls[1].body.idempotencyKey);
});
for (const failure of ["timeout", "malformed JSON", "invalid link", "401", "409", "500"]) {
  test("M02: " + failure + " preserves the payment key for explicit recovery", async t => {
    let broken = true, expire;
    const p = page(t, () => {
      if (!broken) return response(link);
      if (failure === "timeout") return new Promise(() => {});
      if (failure === "malformed JSON") return { ok: true, status: 200, json: async () => { throw new SyntaxError(); } };
      if (failure === "invalid link") return response({ ...link, paymentUrl: "javascript:alert(1)" });
      return response({ code: "PAYMENT_RETRY" }, Number(failure));
    });
    if (failure === "timeout") p.w.setTimeout = callback => { expire = callback; return 1; };
    const pending = p.w.PaymentCreate.create("user1", "order1");
    if (failure === "timeout") expire();
    await assert.rejects(pending);
    assert.ok(p.saved());
    broken = false; p.w.localStorage.setItem("token", "new-token");
    await p.w.PaymentCreate.create("user1", "order1");
    assert.deepEqual(p.calls[1].body, p.calls[0].body); assert.equal(p.saved(), null);
  });
}
test("M02: a resolved attempt routes to backend status, and corrupt stored intent cannot create another attempt", async t => {
  const p = page(t, () => response({ reference: "existingReference", paymentUrl: null }));
  assert.equal(await p.w.PaymentCreate.create("user1", "order1"), "/payment-result?reference=existingReference");
  for (const value of ["{broken", "null", JSON.stringify({ orderId: "other", idempotencyKey: randomUUID() })]) {
    const broken = page(t, () => assert.fail("Must not send"), value);
    await assert.rejects(broken.w.PaymentCreate.create("user1", "order1"), error => error.code === "PAYMENT_STORAGE_ERROR");
    assert.equal(broken.saved(), value); assert.equal(broken.calls.length, 0);
  }
});
test("M02: concurrent retries share the same persisted intent and separate users/orders have different keys", async t => {
  const p = page(t, () => response(link));
  await Promise.all([p.w.PaymentCreate.create("user1", "order1"), p.w.PaymentCreate.create("user1", "order1")]);
  assert.deepEqual(p.calls[0].body, p.calls[1].body);
  await p.w.PaymentCreate.create("user2", "order1");
  await p.w.PaymentCreate.create("user1", "order2");
  assert.equal(new Set(p.calls.map(call => call.body.idempotencyKey)).size, 3);
});
