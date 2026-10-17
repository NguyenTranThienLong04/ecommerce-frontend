const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { be, api, password, stateFile } = require("./settings");
const mongoose = be("mongoose");
const seed = be("./scripts/seed");
const Variant = be("./src/models/ProductVariant");
const Address = be("./src/models/UserAddress");
const Notification = be("./src/models/Notification");
let env, accounts, customer, admin, errors;
const headers = login => ({ Authorization: "Bearer " + login.token });
test.beforeAll(async () => {
  const { mongoUri } = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (!mongoUri.startsWith("mongodb://127.0.0.1:") || !mongoUri.includes("/clothing_e2e?")) throw new Error("Isolated database required");
  env = { NODE_ENV: "test", MONGO_URI: mongoUri, DEMO_PASSWORD: password };
  await mongoose.connect(mongoUri);
});
test.afterAll(() => mongoose.disconnect());
test.beforeEach(async ({ page, context, request }) => {
  for (const collection of await mongoose.connection.db.listCollections().toArray()) await mongoose.connection.db.collection(collection.name).deleteMany({});
  accounts = await seed(env);
  customer = await (await request.post(api + "/api/auth/login", { data: { email: "user@demo.example.com", password } })).json();
  admin = await (await request.post(api + "/api/auth/login", { data: { email: "admin@demo.example.com", password } })).json();
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(({ customer, admin }) => {
    localStorage.setItem("token", customer.token); localStorage.setItem("user", JSON.stringify(customer.user));
    localStorage.setItem("adminToken", admin.token); localStorage.setItem("adminUser", JSON.stringify(admin.user));
  }, { customer, admin });
});
test.afterEach(() => expect(errors).toEqual([]));
async function checkout(request) {
  const variant = await Variant.findOne({ stock: { $gt: 0 } });
  expect((await request.post(api + "/api/cart/add", { headers: headers(customer), data: { idProductVariant: variant.id, quantity: 1 } })).ok()).toBeTruthy();
  const quote = await (await request.get(api + "/api/cart", { headers: headers(customer) })).json();
  const address = await Address.findOne({ idUser: accounts.user._id });
  const data = { cartId: quote.cart._id, cartSnapshot: quote.checkout.snapshot, idempotencyKey: randomUUID(), shippingMethod: "COD", addressId: address.id };
  const response = await request.post(api + "/api/orders", { headers: headers(customer), data }); expect(response.status()).toBe(201);
  const result = await response.json();
  expect((await request.post(api + "/api/orders", { headers: headers(customer), data })).status()).toBe(200);
  return result.order;
}
async function send(request, conversationId, sender = admin) {
  const data = { conversationId, content: "Notification browser test", clientMessageId: randomUUID() };
  const response = await request.post(api + "/api/chat/message", { headers: headers(sender), data }); expect(response.ok()).toBeTruthy();
  expect((await request.post(api + "/api/chat/message", { headers: headers(sender), data })).ok()).toBeTruthy();
}
test("admin realtime checkout, customer order link, read/read-all and responsive notification dropdown", async ({ page, context, request }) => {
  await page.goto("/account");
  await expect(page.locator(".notification-bell")).toBeVisible();
  const staff = await context.newPage(); staff.on("pageerror", error => errors.push(error.message));
  await staff.goto("/admin/orders"); await expect(staff.locator(".notification-bell")).toBeVisible();
  const order = await checkout(request);
  await expect(staff.locator(".notification-badge")).toHaveText("1");
  expect(await Notification.countDocuments({ recipientUserId: accounts.admin._id, type: "ORDER_CREATED" })).toBe(1);
  await staff.locator(".notification-bell").click();
  await expect(staff.locator(".notification-item")).toHaveCount(1);
  await expect(staff.locator(".notification-item")).toHaveAttribute("href", "/admin/orders?search=" + order._id);
  expect((await request.put(api + `/api/orders/${order._id}/status`, { headers: headers(admin), data: { status: "CONFIRMED" } })).ok()).toBeTruthy();
  await expect(page.locator(".notification-badge")).toHaveText("1");
  await page.locator(".notification-bell").click(); await page.locator(".notification-item").click();
  await expect(page).toHaveURL(new RegExp("/account\\?order=" + order._id));
  await expect(page.locator("#orders")).toHaveClass(/active/);
  await expect(page.locator("#detail-" + order._id)).toBeVisible();
  await expect(page.locator(".notification-badge")).toBeHidden();
  expect((await request.put(api + `/api/orders/${order._id}/status`, { headers: headers(admin), data: { status: "SHIPPING" } })).ok()).toBeTruthy();
  await expect(page.locator(".notification-badge")).toHaveText("1");
  await page.locator(".notification-bell").click(); await expect(page.locator(".notification-item")).toHaveCount(2);
  const shots = path.join(__dirname, "../.cache/notification-review"); fs.mkdirSync(shots, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await page.locator(".notification-panel").boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    await page.screenshot({ path: path.join(shots, `customer-${viewport.width}.png`) });
  }
  await page.locator(".notification-read-all").click(); await expect(page.locator(".notification-badge")).toBeHidden();
  await expect(page.locator(".notification-unread")).toHaveCount(0);
  await page.locator(".notification-read-all").press("Escape"); await expect(page.locator(".notification-panel")).toBeHidden();
  await expect(page.locator(".notification-bell")).toBeFocused();
  await staff.setViewportSize({ width: 375, height: 812 });
  await staff.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const staffPanel = await staff.locator(".notification-panel").boundingBox();
  const staffBell = await staff.locator(".notification-bell").boundingBox();
  expect(staffPanel.y).toBeGreaterThanOrEqual(staffBell.y + staffBell.height);
  expect(staffPanel.y + staffPanel.height).toBeLessThanOrEqual(812);
  await staff.screenshot({ path: path.join(shots, "admin-375.png") });
  await staff.close();
});
test("real reconnect recovers missed customer message notification once and opens the existing chat", async ({ page, context, request }) => {
  await page.goto("/account");
  const conversation = await (await request.post(api + "/api/chat/conversation", { headers: headers(customer) })).json();
  await expect.poll(() => page.evaluate(() => window.ChatSync.socket("user").connected)).toBe(true);
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => window.ChatSync.socket("user").connected)).toBe(false);
  await send(request, conversation._id);
  expect(await Notification.countDocuments({ recipientUserId: accounts.user._id, type: "CHAT_MESSAGE" })).toBe(1);
  await context.setOffline(false);
  await expect(page.locator(".notification-badge")).toHaveText("1", { timeout: 20000 });
  await page.locator(".notification-bell").click(); await expect(page.locator(".notification-item")).toHaveCount(1);
  await page.locator(".notification-item").click(); await expect(page).toHaveURL(/\/account\?chat=1$/);
  await expect(page.locator("#chat-box")).toBeVisible(); await expect(page.locator(".message-bubble")).toHaveCount(1);
  await expect(page.locator(".notification-badge")).toBeHidden();
});
test("HTTP snapshot overlapping a real socket event refreshes count without duplicating either notification", async ({ page, request }) => {
  await page.goto("/account");
  const conversation = await (await request.post(api + "/api/chat/conversation", { headers: headers(customer) })).json();
  await send(request, conversation._id); await expect(page.locator(".notification-badge")).toHaveText("1");
  let release, entered, intercepted = false;
  const gate = new Promise(resolve => { release = resolve; }); const reached = new Promise(resolve => { entered = resolve; });
  await page.route("**/api/notifications?*", async route => {
    if (intercepted) return route.continue(); intercepted = true;
    const snapshot = await route.fetch(); entered(); await gate; await route.fulfill({ response: snapshot });
  });
  try {
    await page.locator(".notification-bell").click(); await reached;
    await send(request, conversation._id);
    await expect(page.locator(".notification-item")).toHaveCount(2);
  } finally { release(); }
  await expect(page.locator(".notification-badge")).toHaveText("2");
  await expect(page.locator(".notification-item")).toHaveCount(2);
});
