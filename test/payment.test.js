const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const read = name => fs.readFileSync(path.join(__dirname, "../public", name), "utf8");
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

async function page(t, respond, { token = "test-token", query = "reference=testref&vnp_ResponseCode=00&state=PAID" } = {}) {
  const dom = new JSDOM(read("pages/payment-result.html"), { url: "https://shop.test/payment-result?" + query, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [], timers = new Map();
  let next = 0;
  w.setTimeout = callback => { timers.set(++next, callback); return next; };
  w.clearTimeout = id => timers.delete(id);
  if (token) w.localStorage.setItem("token", token);
  w.fetch = async (url, options) => {
    calls.push({ url, options });
    const result = await respond();
    return { ok: true, json: async () => ({ orderId: "order1", ...result }) };
  };
  w.AppConfig = { apiBase: "https://api.test/api", socketUrl: "https://api.test" };
  w.eval(read("js/api.js"));
  w.eval(read("js/payment-result.js")); await settle();
  return { w, calls, timers, find: selector => w.document.querySelector(selector),
    tick: async () => { const [id, callback] = timers.entries().next().value; timers.delete(id); await callback(); await settle(); } };
}

test("browser success parameters cannot mark payment paid before IPN confirmation", async t => {
  const p = await page(t, () => ({ state: "PROCESSING" }));
  assert.equal(p.find("#payment-title").textContent, "Đang chờ xác nhận");
  assert.equal(p.calls[0].url, "https://api.test/api/vnpay/status/testref");
  assert.equal(p.calls[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(p.calls[0].options.cache, "no-store");
  assert.ok(p.timers.size);
});

test("polling switches from PROCESSING to PAID only after backend confirmation", async t => {
  let state = "PROCESSING";
  const p = await page(t, () => ({ state }));
  state = "PAID"; await p.tick();
  assert.equal(p.find("#payment-title").textContent, "Đã thanh toán");
  assert.equal(p.timers.size, 0);
});

for (const [state, expected] of [["FAILED", "Thanh toán không thành công"], ["CANCELLED", "Đơn hàng đã hủy"],
  ["EXPIRED", "Liên kết thanh toán đã hết hạn"], ["REQUIRES_REVIEW", "Thanh toán cần kiểm tra"]]) {
  test("backend " + state + " has a distinct result view", async t => {
    const p = await page(t, () => ({ state }));
    assert.equal(p.find("#payment-title").textContent, expected);
    if (["CANCELLED", "EXPIRED"].includes(state)) assert.match(p.find("#payment-message").textContent, /xác nhận/);
    if (["FAILED", "REQUIRES_REVIEW"].includes(state)) assert.equal(p.timers.size, 0);
  });
}

test("exhausting bounded polling never turns an unresolved payment into FAILED", async t => {
  const p = await page(t, () => ({ state: "PROCESSING" }));
  while (p.timers.size) await p.tick();
  assert.equal(p.calls.length, 16);
  assert.equal(p.find("#payment-title").textContent, "Đang chờ xác nhận");
  assert.equal(p.find("#payment-refresh").disabled, false);
  p.find("#payment-refresh").click(); await settle();
  assert.equal(p.calls.length, 17); assert.ok(p.timers.size);
});

test("network failure says result is unknown and allows checking again", async t => {
  let broken = true;
  const p = await page(t, () => { if (broken) throw new Error("network"); return { state: "PAID" }; });
  assert.equal(p.find("#payment-title").textContent, "Chưa kiểm tra được kết quả");
  assert.match(p.find("#payment-message").textContent, /không có nghĩa thanh toán thất bại/);
  broken = false; p.find("#payment-refresh").click(); await settle();
  assert.equal(p.find("#payment-title").textContent, "Đã thanh toán");
});

test("no authentication or invalid reference makes no status request and no success claim", async t => {
  const guest = await page(t, () => assert.fail("Unauthenticated fetch"), { token: null });
  assert.equal(guest.find("#payment-login").hidden, false);
  assert.equal(guest.find("#payment-title").textContent, "Đăng nhập để kiểm tra");
  const invalid = await page(t, () => assert.fail("Malformed reference fetch"), { query: "reference=%3Cscript%3E" });
  assert.equal(invalid.find("#payment-title").textContent, "Chưa xác định được thanh toán");
});

test("API display fields are text and old success/fail pages also query the backend", async t => {
  const attack = '<img src=x onerror="window.attacked=1">';
  const p = await page(t, () => ({ state: "PAID", orderId: attack }));
  assert.equal(p.find("#payment-order").textContent, "Mã đơn hàng: " + attack);
  assert.equal(p.find("#payment-order img"), null);
  for (const name of ["success", "fail"]) {
    const html = read("pages/" + name + ".html");
    assert.match(html, /\/js\/payment-result\.js/);
    assert.doesNotMatch(html, /Thanh toán thành công!|Thanh toán thất bại!/);
  }
});

test("pagehide stops polling even when the pending response arrives after navigation", async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const p = await page(t, () => gate);
  p.w.dispatchEvent(new p.w.PageTransitionEvent("pagehide", { persisted: true }));
  release({ state: "PROCESSING" }); await settle();
  assert.equal(p.timers.size, 0);
  assert.equal(p.find("#payment-refresh").disabled, false);
});

test("BFCache restoration refetches backend status and ignores the older page's response", async t => {
  let release, count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const p = await page(t, () => ++count === 1 ? gate : { state: "PAID" });
  p.w.dispatchEvent(new p.w.PageTransitionEvent("pagehide", { persisted: true }));
  p.w.dispatchEvent(new p.w.PageTransitionEvent("pageshow", { persisted: true }));
  await settle();
  assert.equal(p.find("#payment-title").textContent, "Đã thanh toán");
  release({ state: "PROCESSING" }); await settle();
  assert.equal(p.find("#payment-title").textContent, "Đã thanh toán");
  assert.equal(p.calls.length, 2);
  assert.equal(p.timers.size, 0);
});
