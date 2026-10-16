const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { be, api, password, stateFile } = require("./settings");
const mongoose = be("mongoose");
const seed = be("./scripts/seed");
const Product = be("./src/models/Product");
const Order = be("./src/models/Order");
const Banner = mongoose.models.Banner || be("./src/models/banner");
let env, accounts, errors;
const vendorRoot = path.join(__dirname, "../.cache/ui-vendor");
const shots = path.join(__dirname, "../.cache/ui-review");
const vendors = {
  "https://cdn.jsdelivr.net/npm/chart.js": "chart.js",
  "https://cdn.ckeditor.com/ckeditor5/39.0.1/classic/ckeditor.js": "ckeditor.js",
  "https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js": "swiper.js",
  "https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css": "swiper.css"
};
// Offline fallback keeps the suite runnable without adding dependencies.
// For actual chart/editor/slider visual review, cache the existing CDN files above.
const fallbacks = {
  "chart.js": "window.Chart = class { constructor() {} destroy() {} };",
  "ckeditor.js": "window.ClassicEditor = { create: async el => ({ getData: () => el.value, setData: value => { el.value = value; } }) };",
  "swiper.js": "", "swiper.css": ""
};
test.beforeAll(async () => {
  const { mongoUri } = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (!mongoUri.startsWith("mongodb://127.0.0.1:") || !mongoUri.includes("/clothing_e2e?")) throw new Error("UI tests require the isolated E2E database");
  env = { NODE_ENV: "test", MONGO_URI: mongoUri, DEMO_PASSWORD: password };
  await mongoose.connect(mongoUri);
  fs.mkdirSync(shots, { recursive: true });
});
test.afterAll(() => mongoose.disconnect());
test.beforeEach(async ({ page, context }, info) => {
  for (const collection of await mongoose.connection.db.listCollections().toArray()) {
    await mongoose.connection.db.collection(collection.name).deleteMany({});
  }
  accounts = await seed(env);
  await Banner.create({ title: "Karma Club Studio", image: "/assets/images/logokarmaclub.png", link: "/shop", order: 0, status: true });
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  const missing = Object.values(vendors).filter(file => !fs.existsSync(path.join(vendorRoot, file)));
  info.annotations.push({ type: "CDN assets", description: missing.length ? "Fallbacks: " + missing.join(", ") : "Actual cached Chart.js, CKEditor and Swiper" });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (["127.0.0.1", "localhost"].includes(new URL(url).hostname)) return route.continue();
    const file = vendors[url];
    if (!file) return route.abort();
    const cached = path.join(vendorRoot, file);
    return route.fulfill({
      contentType: file.endsWith(".css") ? "text/css" : "application/javascript",
      body: fs.existsSync(cached) ? fs.readFileSync(cached) : fallbacks[file]
    });
  });
});
test.afterEach(() => expect(errors).toEqual([]));
async function userLogin(page) {
  await page.goto("/login");
  await page.locator("#login-email").click();
  await page.locator("#login-email").fill("user@demo.example.com");
  await page.locator("#login-password").click();
  await page.locator("#login-password").fill(password);
  await page.locator(".login__btn").click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator("#account-email")).toHaveText("user@demo.example.com");
}
async function adminLogin(page) {
  await page.goto("/admin/login");
  await page.locator("#email").fill("admin@demo.example.com");
  await page.locator("#password").fill(password);
  await page.locator('button[onclick="login()"]').click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.locator("#totalProducts")).toHaveText("3");
}
async function inspect(page, name, width) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    unnamedInputs: [...document.querySelectorAll("input, select, textarea")]
      .filter(el => el.getClientRects().length && !el.closest('[hidden], [inert]') && !el.labels?.length &&
        !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"))
      .map(el => el.id || el.outerHTML.slice(0, 100))
  }));
  expect(layout.document, name + ": horizontal page overflow").toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.unnamedInputs, name + ": input labels").toEqual([]);
  await page.screenshot({ path: path.join(shots, name + "-" + width + ".png"), fullPage: true });
}
for (const width of [375, 768, 1024, 1440]) {
  test("responsive screens, dialogs and chat at " + width + "px", async ({ page, request }) => {
    test.setTimeout(150000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await inspect(page, "login", width);
    await userLogin(page);
    for (const [name, url] of [["home", "/"], ["shop", "/shop"], ["search", "/search?q=Shirt"]]) {
      await page.goto(url);
      await expect(page.locator(".product__item").first()).toBeVisible();
      await inspect(page, name, width);
    }
    if (width <= 992) {
      await page.locator(".header__menu-toggle").click();
      await expect(page.locator(".header__nav")).toBeVisible();
      await inspect(page, "mobile-nav", width);
      await page.keyboard.press("Escape");
      await expect(page.locator(".header__menu-toggle")).toBeFocused();
      await expect(page.locator(".header__nav")).toHaveAttribute("inert", "");
    }
    await page.locator(".product__item").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#productName")).toContainText("Everyday Shirt");
    await page.locator("#sizes button", { hasText: /^M$/ }).click();
    await page.locator("#colors button", { hasText: /^black$/ }).click();
    await expect(page.locator("#sizes .active")).toHaveAttribute("aria-pressed", "true");
    await inspect(page, "product", width);
    await page.locator("#addToCartBtn").click();
    await expect(page.locator("#cartPopup")).toBeVisible();
    await expect(page.locator('#cartPopup button[onclick="closePopup()"]')).toBeFocused();
    await inspect(page, "cart-popup", width);
    await page.keyboard.press("Escape");
    await expect(page.locator("#cartPopup")).toBeHidden();
    await page.goto("/cart");
    await expect(page.locator(".cart-row")).toHaveCount(1);
    await inspect(page, "cart", width);
    await page.locator(".checkout-btn").click();
    await expect(page.locator("#checkoutBtn")).toBeEnabled();
    await inspect(page, "checkout", width);
    await page.locator("#checkoutBtn").click();
    await expect(page).toHaveURL(/4300\/$/);
    await page.goto("/account");
    await expect(page.locator("#account-email")).toHaveText("user@demo.example.com");
    await inspect(page, "account", width);
    await page.locator('[data-tab="orders"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".view-order")).toBeVisible();
    await page.locator(".view-order").click();
    await inspect(page, "orders", width);
    await page.locator('[data-tab="address"]').click();
    await expect(page.locator(".address-item")).toBeVisible();
    await inspect(page, "addresses", width);
    await page.locator("#add-address-btn").click();
    await expect(page.locator("#receiverName")).toBeFocused();
    await inspect(page, "address-modal", width);
    await page.keyboard.press("Escape");
    await expect(page.locator("#add-address-btn")).toBeFocused();
    await page.locator("#chat-button").click();
    await expect(page.locator("#chat-input")).toBeFocused();
    await expect(page.locator("#chat-status")).toBeEmpty();
    await page.locator("#chat-input").fill("Xin chào, tư vấn giúp mình chọn size.");
    await page.locator("#chat-send").click();
    await expect(page.locator(".message-bubble")).toHaveCount(1);
    await expect(page.locator(".message-time")).toHaveCount(1);
    await inspect(page, "customer-chat", width);
    await page.locator("#chat-close").click();
    await page.locator("#logout-btn").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/4300\/$/);
    await page.goto("/admin/login");
    await inspect(page, "admin-login", width);
    await adminLogin(page);
    await inspect(page, "admin-dashboard", width);
    const product = await Product.findOne({ slug: "demo-everyday-shirt" });
    const screens = [
      ["admin-categories", "/admin/categories", "#categoryTable tr"],
      ["admin-products", "/admin/products", "#productTable tr"],
      ["admin-variants", "/admin/variants.html?id=" + product.id, "#variantTable tr"],
      ["admin-orders", "/admin/orders", "#order-list .view-order"],
      ["admin-users", "/admin/users", "#userTable tr"],
      ["admin-banners", "/admin/banners", "#banner-table tbody tr"]
    ];
    for (const [name, url, ready] of screens) {
      await page.goto(url);
      await expect(page.locator(ready).first()).toBeVisible();
      if (name === "admin-products" && fs.existsSync(path.join(vendorRoot, "ckeditor.js"))) await expect(page.locator(".ck-editor")).toBeVisible();
      await inspect(page, name, width);
    }
    await page.goto("/admin/chat");
    await expect(page.locator("#userList button").first()).toBeVisible();
    await page.locator("#userList button").first().click();
    await expect(page.locator("#chatMessages .message-bubble")).toHaveCount(1);
    await page.locator("#messageInput").fill("Chào bạn, shop có thể hỗ trợ gì?");
    await page.locator("#sendBtn").click();
    await expect(page.locator("#chatMessages .message-bubble")).toHaveCount(2);
    await expect(page.locator("#userList button").first()).toHaveAttribute("aria-pressed", "true");
    await inspect(page, "admin-chat", width);
    await page.locator(".logout-btn").click();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
}

test("payment state cards, validation focus and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await userLogin(page);
  await page.goto("/demo-everyday-shirt");
  await page.locator("#sizes button", { hasText: /^M$/ }).click();
  await page.locator("#colors button", { hasText: /^black$/ }).click();
  await page.locator("#addToCartBtn").click();
  await expect(page.locator("#cartPopup")).toBeVisible();
  await page.goto("/checkout");
  await expect(page.locator("#checkoutBtn")).toBeEnabled();
  await page.locator("#receiverName").fill("");
  await page.locator("#checkoutBtn").click();
  await expect(page.locator("#receiverName")).toBeFocused();
  await expect(page.locator("#receiverName")).toHaveAttribute("aria-invalid", "true");
  await inspect(page, "checkout-validation", 375);
  expect(await page.locator("#checkoutBtn").evaluate(el => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(.01);
  const orderId = new mongoose.Types.ObjectId().toString();
  for (const state of ["PAID", "PROCESSING", "FAILED", "CANCELLED", "EXPIRED", "REQUIRES_REVIEW"]) {
    await page.route("**/api/vnpay/status/UiReference", route => route.fulfill({ json: { state, orderId } }));
    await page.goto("/payment-result?reference=UiReference");
    await expect(page.locator("main")).toHaveAttribute("data-state", state);
    await inspect(page, "payment-" + state, 375);
    await page.unroute("**/api/vnpay/status/UiReference");
  }
});

test("admin category, product, order and user controls preserve writes", async ({ page }) => {
  test.setTimeout(90000);
  await adminLogin(page);
  await page.goto("/admin/categories");
  await page.locator("#categoryName").fill("UI review category");
  await page.locator('button[onclick="addCategory()"]').click();
  const categoryRow = page.locator("#categoryTable tr").filter({ hasText: "UI review category" });
  await expect(categoryRow).toHaveCount(1);
  await categoryRow.locator('[data-action="startEdit"]').click();
  await page.locator("#categoryName").fill("UI edited category");
  await page.locator('button[onclick="addCategory()"]').click();
  await page.locator("#categoryTable tr").filter({ hasText: "UI edited category" }).locator('[data-action="deleteCategory"]').click();
  await expect(page.locator("#categoryTable")).not.toContainText("UI edited category");
  await page.goto("/admin/products");
  await page.locator("#productTable tr").filter({ hasText: "Everyday Shirt" }).locator('[data-action="editProduct"]').click();
  await expect(page.locator("#productName")).toHaveValue("Everyday Shirt");
  await page.locator("#productName").fill("Everyday Shirt Updated");
  await page.locator('button[onclick="addProduct()"]').click();
  await expect(page.locator("#productTable")).toContainText("Everyday Shirt Updated");
  expect((await Product.findOne({ nameProduct: "Everyday Shirt Updated" })).nameProduct).toBe("Everyday Shirt Updated");
  const order = await Order.create({ idUser: accounts.user._id, total: 150000, status: "PENDING", shippingMethod: "COD" });
  await page.goto("/admin/orders");
  const select = page.locator('.status-select[data-id="' + order.id + '"]');
  await expect(select).toBeEnabled();
  await select.selectOption("CONFIRMED");
  await expect(page.locator("#order-list .order-status")).toHaveText("CONFIRMED");
  expect((await Order.findById(order.id)).status).toBe("CONFIRMED");
  await page.goto("/admin/users");
  const userRow = page.locator("#userTable tr").filter({ hasText: "user@demo.example.com" });
  await userRow.locator(".user-role").selectOption("ADMIN");
  await expect(userRow.locator(".user-role")).toHaveValue("ADMIN");
  await userRow.locator(".user-role").selectOption("USER");
  await expect(userRow.locator(".user-role")).toHaveValue("USER");
});

test("landscape keyboard focus, empty/error/loading states and token contrast", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 812, height: 375 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await userLogin(page);
  await page.locator('[data-tab="address"]').click();
  await page.locator("#add-address-btn").click();
  await expect(page.locator("#receiverName")).toBeFocused();
  const modal = await page.locator(".modal-content").boundingBox();
  expect(modal.y).toBeGreaterThanOrEqual(0);
  expect(modal.y + modal.height).toBeLessThanOrEqual(375);
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#cancel-address")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#receiverName")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.locator("#chat-button").click();
  const chat = await page.locator("#chat-box").boundingBox();
  expect(chat.y).toBeGreaterThanOrEqual(0);
  expect(chat.y + chat.height).toBeLessThanOrEqual(375);
  await inspect(page, "landscape-chat", 812);
  await page.goto("/cart");
  await expect(page.locator(".cart-items")).toContainText("Giỏ hàng trống");
  await inspect(page, "cart-empty", 812);
  let unblock;
  const hold = new Promise(resolve => { unblock = resolve; });
  await page.route("**/api/products?*", async route => { await hold; await route.fulfill({ status: 503, json: { message: "unavailable" } }); });
  await page.goto("/shop");
  await expect(page.locator(".ui-loading")).toBeVisible();
  await inspect(page, "catalog-loading", 812);
  unblock();
  await expect(page.locator("#api-notice")).toBeVisible();
  await inspect(page, "catalog-error", 812);
  await page.unroute("**/api/products?*");
  await page.locator("#api-notice button").click();
  await expect(page.locator(".product__item")).toHaveCount(3);
  await page.goto("/search?q=unmatched-query");
  await expect(page.locator("#search-count")).toContainText("Không tìm thấy");
  await inspect(page, "search-empty", 812);
  const contrast = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const rgb = token => root.getPropertyValue(token).trim().replace("#", "").match(/../g).map(x => parseInt(x, 16) / 255);
    const luminance = rgb => rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    return [["--color-text", "--color-bg"], ["--color-text-muted", "--color-bg"], ["--color-accent", "--color-bg"],
      ["--color-success", "--color-success-bg"], ["--color-warning", "--color-warning-bg"], ["--color-danger", "--color-danger-bg"]]
      .map(([fg, bg]) => ({ fg, ratio: (luminance(rgb(bg)) + .05) / (luminance(rgb(fg)) + .05) }));
  });
  for (const { fg, ratio } of contrast) expect(ratio, fg).toBeGreaterThanOrEqual(4.5);
});
