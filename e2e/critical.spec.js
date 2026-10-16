const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { be, api, password, stateFile } = require("./settings");
const mongoose = be("mongoose");
const seed = be("./scripts/seed");
const User = be("./src/models/User"), Product = be("./src/models/Product"), Variant = be("./src/models/ProductVariant");
const Order = be("./src/models/Order"), Message = be("./src/models/Message"), Attempt = be("./src/models/PaymentAttempt");
const { sign, orderInfo } = be("./src/utils/vnpay");
let env, accounts, errors;
test.beforeAll(async () => {
  const { mongoUri } = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (!mongoUri.startsWith("mongodb://127.0.0.1:") || !mongoUri.includes("/clothing_e2e?")) throw new Error("Refusing a non-isolated E2E database");
  env = { NODE_ENV: "test", MONGO_URI: mongoUri, DEMO_PASSWORD: password };
  await mongoose.connect(mongoUri);
});
test.afterAll(() => mongoose.disconnect());
test.beforeEach(async ({ page, context }) => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  // Include collections whose model was loaded only in the backend process.
  for (const name of ["carts", "cartitems", "orderitems", "conversationusers", "conversations", "useraddresses", "categories"]) {
    await mongoose.connection.db.collection(name).deleteMany({});
  }
  accounts = await seed(env);
  errors = []; page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  // Real application/API/socket traffic is local. External fonts/CDNs/gateways are blocked.
  await context.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
test.afterEach(() => expect(errors).toEqual([]));
async function login(page) {
  await page.goto("/login");
  await page.locator("#login-email").click(); await page.locator("#login-email").fill("user@demo.example.com");
  await page.locator("#login-password").click(); await page.locator("#login-password").fill(password);
  await page.locator(".login__btn").click();
  await expect(page).toHaveURL(/4300\/account$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("token"))).toBeTruthy();
}
async function addCart(page) {
  await page.goto("/demo-everyday-shirt");
  await page.locator("#sizes button", { hasText: /^M$/ }).click();
  await page.locator("#colors button", { hasText: /^black$/ }).click();
  await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/cart/add") && response.request().method() === "POST"), page.locator("#addToCartBtn").click()]);
  await page.goto("/cart");
  await expect(page.locator(".cart-items")).toContainText("Everyday Shirt");
}
test("login uses the real backend; invalid session expires only the customer context", async ({ page }) => {
  await login(page);
  await page.evaluate(() => { localStorage.setItem("adminToken", "other-context"); localStorage.setItem("token", "expired-or-invalid"); });
  await page.goto("/account");
  await expect(page.locator("#api-notice a")).toHaveAttribute("href", "/login");
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("adminToken"))).toBe("other-context");
});
test("catalog to cart keeps archived items visible with a working remove action", async ({ page }) => {
  await login(page); await addCart(page);
  const product = await Product.findOne({ slug: "demo-everyday-shirt" });
  await Product.updateOne({ _id: product._id }, { $set: { archivedAt: new Date() } });
  await page.reload();
  await expect(page.locator(".cart-unavailable")).toBeVisible();
  await expect(page.locator(".cart-items")).toContainText("Everyday Shirt");
  await page.locator('[data-action="remove"]').click();
  await expect(page.locator('[data-action="remove"]')).toHaveCount(0);
});
test("checkout retries a lost response after the actual DB commit with the same key and one order", async ({ page }) => {
  await login(page); await addCart(page);
  await page.locator(".checkout-btn").click();
  await expect(page.locator("#checkoutBtn")).toBeEnabled();
  const payloads = [];
  await page.route("**/api/orders", async route => {
    if (route.request().method() !== "POST") return route.continue();
    payloads.push(route.request().postDataJSON());
    const result = await route.fetch(); // Real backend commits before the response is dropped.
    expect(result.ok()).toBeTruthy();
    if (payloads.length === 1) await route.abort("connectionreset");
    else await route.fulfill({ response: result });
  });
  await page.locator("#checkoutBtn").click();
  await expect(page.locator("#checkoutMessage")).toContainText("Chưa xác nhận");
  await expect(page.locator("#checkoutBtn")).toBeEnabled();
  expect(await Order.countDocuments({ idUser: accounts.user._id })).toBe(1);
  await page.locator("#checkoutBtn").click();
  await expect(page).toHaveURL(/4300\/$/);
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toEqual(payloads[1]);
  expect(await Order.countDocuments({ idUser: accounts.user._id })).toBe(1);
  expect(await page.evaluate(id => sessionStorage.getItem("checkoutAttempt:" + id), accounts.user.id)).toBeNull();
});

test("Batch 8: admin metadata and explicit stale stock edits cannot overwrite checkout/cancellation", async ({ page, request }) => {
  await login(page); await addCart(page);
  const customerToken = await page.evaluate(() => localStorage.getItem("token"));
  const customerHeaders = { Authorization: "Bearer " + customerToken };
  const loginAdmin = await request.post(api + "/api/auth/login", { data: { email: "admin@demo.example.com", password } });
  const admin = await loginAdmin.json();
  await page.evaluate(data => {
    localStorage.setItem("adminToken", data.token); localStorage.setItem("adminUser", JSON.stringify(data.user));
  }, admin);
  const product = await Product.findOne({ slug: "demo-everyday-shirt" });
  const variant = await Variant.findOne({ idProduct: product._id, size: "M", color: "black" });
  await page.goto("/admin/variants.html?id=" + product.id);
  const row = () => page.locator("#variantTable tr").filter({ has: page.locator("td", { hasText: /^M$/ }) });
  await row().locator('[data-action="editVariant"]').click();
  await expect(page.locator("#stock")).toBeDisabled();
  let quote = await (await request.get(api + "/api/cart", { headers: customerHeaders })).json();
  expect((await request.put(api + "/api/cart/update", { headers: customerHeaders,
    data: { idItem: quote.items[0]._id, quantity: 2 } })).ok()).toBeTruthy();
  quote = await (await request.get(api + "/api/cart", { headers: customerHeaders })).json();
  const created = await request.post(api + "/api/orders", { headers: customerHeaders, data: {
    receiverName: "E2E Customer", phone: "0901234567", addressLine: "1 Test Street", ward: "Ward", district: "District", city: "City",
    shippingMethod: "COD", idempotencyKey: randomUUID(), cartId: quote.cart._id, cartSnapshot: quote.checkout.snapshot
  } });
  expect(created.status()).toBe(201);
  const order = (await created.json()).order;
  await page.locator("#price").fill("180000");
  await Promise.all([page.waitForResponse(r => r.url().endsWith("/api/variants/" + variant.id) && r.status() === 200),
    page.locator('button[onclick="addVariant()"]').click()]);
  expect((await Variant.findById(variant.id)).stock).toBe(variant.stock - 2);
  expect((await Variant.findById(variant.id)).price).toBe(180000);
  await expect(row().locator("td").nth(3)).toHaveText(String(variant.stock - 2));
  await row().locator('[data-action="editStock"]').click();
  expect((await request.put(api + "/api/orders/" + order._id + "/cancel", { headers: customerHeaders })).ok()).toBeTruthy();
  await page.locator("#newStock").fill("50");
  await page.locator("#saveStock").click();
  await expect(page.locator("#inventoryMessage")).toContainText("Tồn kho đã thay đổi");
  expect((await Variant.findById(variant.id)).stock).toBe(variant.stock);
  await row().locator('[data-action="editStock"]').click();
  await expect(page.locator("#newStock")).toHaveValue(String(variant.stock));
  await page.locator("#newStock").fill("31");
  await page.locator("#saveStock").click();
  await expect(page.locator("#inventoryForm")).toBeHidden();
  expect((await Variant.findById(variant.id)).stock).toBe(31);
});

test("Batch 8: payment response lost after commit survives reload with one attempt; deliberate next action gets a new key", async ({ page, context }) => {
  // Local response stub for the gateway landing; never contacts an external provider.
  await context.route("https://gateway.test/**", route => route.fulfill({ contentType: "text/plain", body: "Local gateway landing" }));
  await login(page); await addCart(page);
  await page.locator(".checkout-btn").click();
  await expect(page.locator("#checkoutBtn")).toBeEnabled();
  await page.locator('input[value="VNPAY"]').check();
  const payloads = [], references = [];
  await page.route("**/api/vnpay/{create,recreate}", async route => {
    payloads.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy(); references.push((await response.json()).reference);
    if (payloads.length === 1) await route.abort("connectionreset");
    else await route.fulfill({ response });
  });
  await page.locator("#checkoutBtn").click();
  await expect(page.locator("#checkoutMessage")).toContainText("Chưa xác nhận");
  expect(await Attempt.countDocuments()).toBe(1);
  expect(await Order.countDocuments()).toBe(1);
  const order = await Order.findOne();
  const stock = (await Variant.findOne({ size: "M", idProduct: (await Product.findOne({ slug: "demo-everyday-shirt" }))._id })).stock;
  await page.reload();
  await expect(page.locator("#checkoutBtn")).toBeEnabled();
  await page.locator("#checkoutBtn").click();
  await expect(page).toHaveURL(/gateway\.test\/pay/);
  expect(payloads).toHaveLength(2); expect(payloads[1]).toEqual(payloads[0]); expect(references[1]).toBe(references[0]);
  expect(await Attempt.countDocuments()).toBe(1); expect(await Order.countDocuments()).toBe(1);
  expect((await Order.findById(order._id)).paymentStatus).toBe("UNPAID");
  expect((await Variant.findOne({ size: "M", idProduct: (await Product.findOne({ slug: "demo-everyday-shirt" }))._id })).stock).toBe(stock);
  await page.goto("/account");
  await page.locator('[data-tab="orders"]').click();
  await page.locator(".btn-pay-again").click();
  await expect(page).toHaveURL(/gateway\.test\/pay/);
  expect(payloads).toHaveLength(3); expect(payloads[2].idempotencyKey).not.toBe(payloads[1].idempotencyKey);
  expect(references[2]).not.toBe(references[1]); expect(await Attempt.countDocuments()).toBe(2);
});
test("native Back/Forward restores filter, page and sort without extra history entries", async ({ page }) => {
  const category = (await Product.findOne()).idCategory;
  for (let i = 0; i < 42; i++) {
    const product = await Product.create({ slug: "navigation-" + i, nameProduct: "Navigation Shirt " + i, idCategory: category, images: ["/demo-product.svg"] });
    await Variant.create({ idProduct: product._id, size: "M", color: "black", price: 100000 + i, stock: 2 });
  }
  await page.goto("/shop");
  await page.locator("#filter-size").selectOption("M");
  await page.locator("#filter-sort").selectOption("price_desc");
  await expect(page.locator("#pagination")).toContainText("2");
  await page.locator("#pagination").getByRole("button", { name: "2", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator("#pagination .active")).toHaveText("2");
  const length = await page.evaluate(() => history.length);
  await page.goBack();
  await expect(page.locator("#pagination .active")).toHaveText("1");
  await expect(page.locator("#filter-size")).toHaveValue("M");
  await page.goForward();
  await expect(page.locator("#pagination .active")).toHaveText("2");
  await expect(page.locator("#filter-sort")).toHaveValue("price_desc");
  expect(await page.evaluate(() => history.length)).toBe(length);
});
async function observeSockets(page) {
  await page.addInitScript(() => {
    let wrapped;
    window.__sends = []; window.__joins = 0;
    Object.defineProperty(window, "io", { configurable: true, get: () => wrapped, set: factory => {
      wrapped = (...args) => {
        const socket = factory(...args), emit = socket.emit.bind(socket);
        window.__socket = socket;
        socket.emit = (name, payload, ack) => {
          if (name === "joinConversation") window.__joins++;
          if (name === "sendMessage") {
            window.__sends.push(structuredClone(payload));
            if (window.__dropAck) return emit(name, payload, () => {});
          }
          return emit(name, payload, ack);
        };
        return socket;
      };
    } });
    const later = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => later(callback, delay === 8000 ? 500 : delay, ...args);
  });
}
test("real socket ACK loss then retry keeps one database message, one event and one UI row", async ({ page }) => {
  await observeSockets(page); await login(page);
  await expect.poll(() => page.evaluate(() => window.__joins)).toBeGreaterThan(0);
  await page.locator("#chat-button").click();
  await page.evaluate(() => {
    window.__dropAck = true; window.__events = 0;
    window.__socket.on("newMessage", () => window.__events++);
  });
  await page.locator("#chat-input").fill("Lost ACK message");
  await page.locator("#chat-send").click();
  await expect(page.locator("#chat-status")).toContainText("kiểm tra lịch sử");
  await expect(page.locator("#chat-input")).toHaveValue("Lost ACK message");
  await expect(page.locator(".message-bubble")).toHaveCount(1);
  expect(await Message.countDocuments({ content: "Lost ACK message" })).toBe(1);
  await page.evaluate(() => { window.__dropAck = false; });
  await page.locator("#chat-send").click();
  await expect(page.locator("#chat-input")).toHaveValue("");
  const sends = await page.evaluate(() => window.__sends);
  expect(sends).toHaveLength(2);
  expect(sends[0].clientMessageId).toBe(sends[1].clientMessageId);
  expect(await Message.countDocuments({ clientMessageId: sends[0].clientMessageId })).toBe(1);
  expect(await page.evaluate(() => window.__events)).toBe(1);
  await expect(page.locator(".message-bubble")).toHaveCount(1);
});
test("offline socket reconnect rejoins and resyncs a missed persisted message once", async ({ page, context, request }) => {
  await observeSockets(page); await login(page);
  await page.locator("#chat-button").click();
  await expect.poll(() => page.evaluate(() => window.__joins)).toBeGreaterThan(0);
  const token = await page.evaluate(() => localStorage.getItem("token"));
  const conversation = await request.post(api + "/api/chat/conversation", { headers: { Authorization: "Bearer " + token } });
  const id = (await conversation.json())._id;
  await context.setOffline(true);
  await page.evaluate(() => window.__socket.io.engine.close());
  await expect(page.locator("#chat-status")).toContainText("mất kết nối");
  const loginAdmin = await request.post(api + "/api/auth/login", { data: { email: "admin@demo.example.com", password } });
  const adminToken = (await loginAdmin.json()).token;
  const sent = await request.post(api + "/api/chat/message", { headers: { Authorization: "Bearer " + adminToken },
    data: { conversationId: id, content: "Missed while offline", clientMessageId: randomUUID() } });
  expect(sent.ok()).toBeTruthy();
  await context.setOffline(false);
  await page.locator("#chat-retry").click();
  await expect.poll(() => page.evaluate(() => window.__joins)).toBeGreaterThan(1);
  await expect(page.locator(".message-bubble", { hasText: "Missed while offline" })).toHaveCount(1);
});
for (const outcome of ["PAID", "REQUIRES_REVIEW"]) {
  test("payment Processing to " + outcome + " uses signed local IPN; network retry never claims Failed", async ({ page, request }) => {
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem("token"));
    const order = await Order.create({ idUser: accounts.user._id, shippingMethod: "VNPAY", status: "PENDING", paymentStatus: "UNPAID", total: 150000 });
    const created = await request.post(api + "/api/vnpay/create", { headers: { Authorization: "Bearer " + token }, data: { orderId: order.id, idempotencyKey: randomUUID() } });
    expect(created.ok()).toBeTruthy();
    const { reference } = await created.json();
    await page.goto("/payment-result?reference=" + reference + "&state=PAID");
    await expect(page.locator("#payment-title")).toHaveText("Đang chờ xác nhận");
    await page.route("**/api/vnpay/status/*", route => route.abort("connectionreset"));
    await page.locator("#payment-refresh").click();
    await expect(page.locator("#payment-title")).toHaveText("Chưa kiểm tra được kết quả");
    const attempt = await Attempt.findOne({ reference });
    const params = { vnp_TmnCode: "E2EDEMO", vnp_TxnRef: reference, vnp_Amount: "15000000", vnp_TransactionNo: "123456789",
      vnp_BankCode: "NCB", vnp_OrderInfo: orderInfo(attempt), vnp_ResponseCode: outcome === "PAID" ? "00" : "07", vnp_TransactionStatus: "00" };
    params.vnp_SecureHash = sign(params, "e2e-provider-signature-only");
    const ipn = await request.get(api + "/api/vnpay/ipn?" + new URLSearchParams(params));
    expect((await ipn.json()).RspCode).toBe("00");
    await page.unroute("**/api/vnpay/status/*");
    await page.locator("#payment-refresh").click();
    await expect(page.locator("#payment-title")).toHaveText(outcome === "PAID" ? "Đã thanh toán" : "Thanh toán cần kiểm tra");
  });
}
