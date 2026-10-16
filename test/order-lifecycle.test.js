const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");
const read = file => fs.readFileSync(path.join(__dirname, "../public", file), "utf8");
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const order = { _id: "order1", createdAt: "2026-10-14", total: 100000, status: "PENDING",
  paymentStatus: "UNPAID", shippingMethod: "COD", items: [], canCancel: true,
  allowedTransitions: ["CONFIRMED", "CANCEL"] };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

async function page(t, isAdmin, respond) {
  const dom = new JSDOM(read(isAdmin ? "admin/orders.html" : "pages/account.html"), {
    url: "https://shop.test/", runScripts: "outside-only"
  });
  const w = dom.window;
  t.after(() => w.close());
  await new Promise(resolve => w.document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  Object.defineProperty(w.HTMLElement.prototype, "innerText", {
    get() { return this.textContent; }, set(value) { this.textContent = value; }
  });
  w.localStorage.setItem("token", "user-token");
  w.localStorage.setItem("adminToken", "admin-token");
  w.DOMPurify = createDOMPurify(w);
  const alerts = [], calls = [];
  w.alert = message => alerts.push(message);
  w.confirm = () => true;
  w.fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    return respond(new URL(url).pathname, options);
  };
  w.AppConfig = { apiBase: "https://api.test/api", socketUrl: "https://api.test" };
  w.eval(read("js/api.js"));
  w.eval(read("js/payment-create.js"));
  w.eval(read("js/chat-sync.js"));
  w.eval(read("js/safe-html.js"));
  w.eval(read(isAdmin ? "admin/js/order.js" : "js/account-orders.js"));
  if (!isAdmin) w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await settle();
  return { w, alerts, calls, find: selector => w.document.querySelector(selector) };
}

test("admin status choices come from server rules and terminal orders have no enabled transition", async t => {
  const p = await page(t, true, () => response([
    order, { ...order, _id: "cancelled", status: "CANCEL", allowedTransitions: [] },
    { ...order, _id: "done", status: "DONE", allowedTransitions: [] },
    { ...order, _id: "unpaid-vnpay", shippingMethod: "VNPAY", allowedTransitions: ["CANCEL"] }
  ]));
  assert.deepEqual([...p.find('[data-id="order1"].status-select').options].map(o => o.value), ["PENDING", "CONFIRMED", "CANCEL"]);
  assert.equal(p.find('[data-id="cancelled"].status-select').disabled, true);
  assert.equal(p.find('[data-id="done"].status-select').disabled, true);
  assert.deepEqual([...p.find('[data-id="unpaid-vnpay"].status-select').options].map(o => o.value), ["PENDING", "CANCEL"]);
});

test("admin conflict displays server error and refreshes options from the winning state", async t => {
  let state = order;
  const p = await page(t, true, (url, options) => {
    if (options.method === "PUT") {
      assert.deepEqual(JSON.parse(options.body), { status: "CONFIRMED" });
      assert.equal(options.headers.Authorization, "Bearer admin-token");
      state = { ...order, status: "CANCEL", allowedTransitions: [] };
      return response({ message: "Đơn đã bị hủy" }, 409);
    }
    return response([state]);
  });
  const select = p.find(".status-select");
  select.value = "CONFIRMED";
  const pending = select.onchange();
  assert.equal(select.disabled, true);
  await pending;
  assert.deepEqual(p.alerts, ["Đơn đã bị hủy"]);
  assert.equal(p.find(".status-select").value, "CANCEL");
  assert.equal(p.find(".status-select").disabled, true);
});

test("admin network failure restores the selection and allows retry", async t => {
  const p = await page(t, true, (url, options) => {
    if (options.method === "PUT") throw new Error("network failure");
    return response([order]);
  });
  const select = p.find(".status-select");
  select.value = "CONFIRMED";
  await select.onchange();
  assert.equal(select.value, "PENDING");
  assert.equal(select.disabled, false);
  assert.equal(p.alerts.length, 1);
});

test("customer cancellation visibility follows server eligibility, including paid and shipped orders", async t => {
  const p = await page(t, false, () => response([
    order, { ...order, _id: "paid", paymentStatus: "PAID", canCancel: false },
    { ...order, _id: "shipping", status: "SHIPPING", canCancel: false },
    { ...order, _id: "cancelled", status: "CANCEL", canCancel: false }
  ]));
  assert.deepEqual([...p.w.document.querySelectorAll(".cancel-order")].map(button => button.dataset.id), ["order1"]);
});

test("customer accepts an idempotent cancellation response and reloads the terminal state", async t => {
  let state = order;
  const p = await page(t, false, (url, options) => {
    if (options.method === "PUT") {
      assert.match(url, /\/orders\/order1\/cancel$/);
      state = { ...order, status: "CANCEL", canCancel: false };
      return response({ order: state, replayed: true });
    }
    return response([state]);
  });
  p.find(".cancel-order").click();
  await settle();
  assert.equal(p.find(".cancel-order"), null);
  assert.equal(p.find(".order-status").textContent.trim(), "CANCEL");
  assert.deepEqual(p.alerts, ["Hủy thành công"]);
});
