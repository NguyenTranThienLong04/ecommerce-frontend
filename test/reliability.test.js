const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const createDOMPurify = require("dompurify");
const read = name => fs.readFileSync(path.join(__dirname, "../public", name), "utf8");
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const product = name => ({ _id: name, nameProduct: name, slug: name, images: [], minPrice: 100000, selectedTags: [], customTags: [] });
const catalog = (name, page = 1) => response({ products: [product(name)], page, totalPages: 3, total: 3 });
const order = { _id: "order1", total: 130000, createdAt: "2026-10-15", shippingMethod: "VNPAY", status: "PENDING", paymentStatus: "UNPAID", canCancel: true, items: [] };
const address = { receiverName: "Customer", phone: "0901234567", addressLine: "1 Test Street", ward: "Ward", district: "District", city: "City" };

async function page(t, html, script, respond, url = "https://shop.test/", setup = () => {}) {
  const dom = new JSDOM(html ? read(html) : "<!doctype html><body><button id='action'>Action</button></body>", {
    url, runScripts: "outside-only", virtualConsole: new VirtualConsole()
  });
  const w = dom.window, calls = [], alerts = [];
  t.after(() => w.close());
  await new Promise(resolve => w.document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  Object.defineProperty(w.HTMLElement.prototype, "innerText", { get() { return this.textContent; }, set(value) { this.textContent = value; } });
  w.localStorage.setItem("token", "user-token");
  w.localStorage.setItem("user", JSON.stringify({ id: "user1" }));
  w.localStorage.setItem("adminToken", "admin-token");
  w.localStorage.setItem("adminUser", JSON.stringify({ id: "admin1", role: "ADMIN" }));
  w.DOMPurify = createDOMPurify(w);
  w.alert = message => alerts.push(message);
  w.confirm = () => true;
  w.scrollTo = () => {};
  w.Swiper = function () {};
  w.Chart = function () { this.destroy = () => {}; };
  w.editor = { getData: () => "", setData() {} };
  w.fetch = async (url, options = {}) => {
    calls.push({ url: new URL(url), ...options });
    return respond(new URL(url), options);
  };
  w.AppConfig = { apiBase: "https://api.test/api", socketUrl: "https://api.test" };
  w.eval(read("js/api.js"));
  w.eval(read("js/payment-create.js"));
  w.eval(read("js/safe-html.js"));
  w.eval(read("js/chat-sync.js"));
  setup(w);
  if (script) w.eval(read(script));
  if (["js/auth.js", "js/account-address.js", "js/account-orders.js"].includes(script)) w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await settle();
  return { w, calls, alerts, find: selector => w.document.querySelector(selector) };
}

for (const scope of ["user", "admin"]) {
  test(scope + " 401 clears only its own session, keeps unresolved checkout and presents correct login", async t => {
    const p = await page(t, null, null, () => response({ message: "Internal detail" }, 401));
    p.w.sessionStorage.setItem("checkoutAttempt:user1", "unresolved");
    await assert.rejects(p.w.Api[scope]("https://api.test/private"), error => error.status === 401);
    assert.equal(p.w.localStorage.getItem(scope === "admin" ? "adminToken" : "token"), null);
    assert.ok(p.w.localStorage.getItem(scope === "admin" ? "token" : "adminToken"));
    assert.equal(p.w.sessionStorage.getItem("checkoutAttempt:user1"), "unresolved");
    assert.equal(p.find("#api-notice a").pathname, scope === "admin" ? "/admin/login" : "/login");
    assert.doesNotMatch(p.find("#api-notice").textContent, /Internal detail/);
  });
}
test("a late 401 cannot remove a newer login", async t => {
  const gate = deferred();
  const p = await page(t, null, null, () => gate.promise);
  const pending = p.w.Api.user("https://api.test/private");
  p.w.localStorage.setItem("token", "new-token");
  gate.resolve(response({}, 401));
  await assert.rejects(pending, error => error.status === 401);
  assert.equal(p.w.localStorage.getItem("token"), "new-token");
});
for (const status of [400, 403, 404, 409, 500]) {
  test("HTTP " + status + " is a rejected request, not successful application data", async t => {
    const p = await page(t, null, null, () => response({ message: "Database SECRET" }, status));
    await assert.rejects(p.w.Api.fetch("https://api.test/items"), error => {
      assert.equal(error.status, status);
      if (status === 500) assert.doesNotMatch(error.message, /SECRET/);
      return true;
    });
  });
}
test("malformed JSON is recoverable and a retry works", async t => {
  let broken = true;
  const p = await page(t, null, null, () => broken ? { ok: true, status: 200, json: async () => { throw new SyntaxError("raw stack secret"); } } : response({ value: 1 }));
  await assert.rejects(p.w.Api.fetch("https://api.test/items"), error => error.code === "INVALID_RESPONSE" && !error.message.includes("secret"));
  broken = false;
  assert.equal((await (await p.w.Api.fetch("https://api.test/items")).json()).value, 1);
});
test("network failures release action buttons; duplicate clicks cannot start a second write", async t => {
  const gate = deferred();
  const p = await page(t, null, null, () => gate.promise);
  const button = p.find("#action");
  const work = () => p.w.Api.user("https://api.test/action", { method: "POST" });
  const pending = p.w.Api.action("write", button, work);
  await p.w.Api.action("write", button, work);
  assert.equal(p.calls.length, 1);
  assert.equal(button.disabled, true);
  gate.reject(new TypeError("network details"));
  await pending;
  assert.equal(button.disabled, false);
  assert.equal(p.alerts.length, 1);
  assert.doesNotMatch(p.alerts[0], /details/);
});
test("address rejection preserves modal/input; retry saves once and restores focus", async t => {
  const gate = deferred();
  let saved = [], writes = 0;
  const p = await page(t, "pages/account.html", "js/account-address.js", (url, options) => {
    if (!options.method) return response(saved);
    if (++writes === 1) return gate.promise;
    saved = [{ _id: "address1", ...JSON.parse(options.body) }];
    return response(saved[0]);
  });
  p.find("#add-address-btn").click();
  for (const [key, value] of Object.entries(address)) p.find("#" + key).value = value;
  const first = p.find("#save-address").onclick();
  await p.find("#save-address").onclick();
  assert.equal(writes, 1);
  assert.equal(p.find("#save-address").disabled, true);
  gate.resolve(response({ message: "Địa chỉ không hợp lệ" }, 400));
  await first;
  assert.equal(p.find("#address-modal").style.display, "flex");
  assert.equal(p.find("#addressLine").value, address.addressLine);
  assert.equal(p.find("#save-address").disabled, false);
  assert.match(p.find('#address-modal [role="alert"]').textContent, /không hợp lệ/);
  await p.find("#save-address").onclick();
  assert.equal(writes, 2);
  assert.equal(p.find("#address-modal").style.display, "none");
  assert.match(p.find("#address-list").textContent, /1 Test Street/);
  assert.equal(p.w.document.activeElement, p.find("#add-address-btn"));
});
for (const form of ["login", "register"]) {
  test(form + " keeps fields after rejection, restores button and suppresses duplicate submits", async t => {
    const gate = deferred();
    const p = await page(t, "pages/login.html", "js/auth.js", () => gate.promise);
    for (const [key, value] of Object.entries({ email: "test@example.com", password: "password1", name: "Customer", phone: "0901234567" })) {
      const input = p.find("#" + form + "-" + key); if (input) input.value = value;
    }
    const node = p.find("." + form + "__form"), button = node.querySelector("button");
    node.dispatchEvent(new p.w.Event("submit", { cancelable: true }));
    node.dispatchEvent(new p.w.Event("submit", { cancelable: true }));
    assert.equal(p.calls.length, 1);
    assert.equal(button.disabled, true);
    gate.resolve(response({ message: "Rejected" }, form === "login" ? 401 : 409));
    await settle();
    assert.equal(button.disabled, false);
    assert.equal(p.find("#" + form + "-email").value, "test@example.com");
    assert.equal(p.find("#" + form + "-password").value, "password1");
    assert.ok(p.w.localStorage.getItem("adminToken"));
    assert.equal(p.alerts.some(message => /thành công/.test(message)), false);
  });
}
test("cancel and payment retry release their buttons after failure and do not double-send", async t => {
  const gate = deferred();
  const p = await page(t, "pages/account.html", "js/account-orders.js", (url, options) => options.method ? gate.promise : response([order]));
  const button = p.find(".btn-pay-again");
  button.click(); button.click();
  assert.equal(p.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(button.disabled, true);
  p.find(".cancel-order").click();
  assert.equal(p.calls.filter(call => call.method === "PUT").length, 0);
  gate.resolve(response({}, 500));
  await settle();
  assert.equal(button.disabled, false);
  p.find(".cancel-order").click();
  await settle();
  assert.equal(p.find(".cancel-order").disabled, false);
  assert.equal(p.alerts.some(message => /thành công/.test(message)), false);
});

test("search responses A/B in reverse order leave B and its URL/title visible", async t => {
  const a = deferred(), b = deferred();
  const p = await page(t, "pages/search.html", "js/search.js", url =>
    url.searchParams.get("search") === "A" ? a.promise : url.searchParams.get("search") === "B" ? b.promise : catalog("initial"), "https://shop.test/search");
  p.w.history.replaceState({}, "", "/search?q=A"); const first = p.w.fetchProducts();
  p.w.history.replaceState({}, "", "/search?q=B"); const second = p.w.fetchProducts();
  b.resolve(catalog("Product B")); await second;
  a.resolve(catalog("Product A")); await first;
  assert.match(p.find("#products-list").textContent, /Product B/);
  assert.doesNotMatch(p.find("#products-list").textContent, /Product A/);
  assert.match(p.find("#search-count").textContent, /"B"/);
  assert.equal(new URL(p.w.location.href).searchParams.get("q"), "B");
});
test("filter responses A/B in reverse order and an old error cannot overwrite the latest view", async t => {
  const a = deferred(), b = deferred();
  const p = await page(t, "pages/shop.html", "js/shop.js", url => {
    if (url.pathname.endsWith("/filters")) return response({ sizes: ["M", "L"], colors: [], categories: [] });
    return url.searchParams.get("size") === "M" ? a.promise : url.searchParams.get("size") === "L" ? b.promise : catalog("initial");
  }, "https://shop.test/shop");
  p.find("#filter-size").value = "M"; const first = p.w.fetchProducts();
  p.find("#filter-size").value = "L"; const second = p.w.fetchProducts();
  b.resolve(catalog("Large")); await second;
  a.reject(new Error("old failure")); await first;
  assert.match(p.find("#products-list").textContent, /Large/);
  assert.equal(p.find("#api-notice"), null);
  assert.equal(new URL(p.w.location.href).searchParams.get("size"), "L");
});
test("home pagination ignores a late previous page", async t => {
  const two = deferred(), three = deferred();
  const p = await page(t, "pages/index.html", "js/index.js", url => url.pathname.endsWith("/banners") ? response([])
    : url.searchParams.get("page") === "2" ? two.promise : url.searchParams.get("page") === "3" ? three.promise : catalog("one"));
  p.w.updateURL(2); const first = p.w.fetchProducts();
  p.w.updateURL(3); const second = p.w.fetchProducts();
  three.resolve(catalog("three", 3)); await second;
  two.resolve(catalog("two", 2)); await first;
  assert.match(p.find("#products-list").textContent, /three/);
  assert.equal(p.find("#pagination .active").textContent, "3");
});
test("admin product search guards out-of-order responses and records page/search in the URL", async t => {
  const a = deferred(), b = deferred();
  const p = await page(t, "admin/products.html", "admin/js/products.js", url => url.pathname.endsWith("/categories") ? response([])
    : url.searchParams.get("search") === "A" ? a.promise : url.searchParams.get("search") === "B" ? b.promise : catalog("initial"), "https://shop.test/admin/products");
  p.find("#searchInput").value = "A"; const first = p.w.loadProducts();
  p.find("#searchInput").value = "B"; const second = p.w.loadProducts();
  b.resolve(catalog("B")); await second;
  a.resolve(catalog("A")); await first;
  assert.equal(p.find("#productTable tr td:nth-child(2)").textContent, "B");
  assert.equal(new URL(p.w.location.href).searchParams.get("search"), "B");
});

async function traverse(w, direction) {
  const done = new Promise(resolve => w.addEventListener("popstate", resolve, { once: true }));
  w.history[direction](); await done; await settle();
}
for (const screen of ["shop", "search", "index"]) {
  test(screen + " Back/Forward refetches the URL state without pushing history", async t => {
    const route = screen === "index" ? "/" : "/" + screen;
    const p = await page(t, "pages/" + screen + ".html", "js/" + screen + ".js", url => {
      if (url.pathname.endsWith("/filters")) return response({ sizes: ["M"], colors: ["black"], categories: ["Shirts"] });
      if (url.pathname.endsWith("/banners")) return response([]);
      return catalog("Page " + url.searchParams.get("page") + " " + (url.searchParams.get("size") || ""), Number(url.searchParams.get("page")));
    }, "https://shop.test" + route + (screen === "search" ? "?q=shirt" : ""));
    let pushes = 0;
    const push = p.w.history.pushState.bind(p.w.history);
    p.w.history.pushState = (...args) => { pushes++; return push(...args); };
    if (screen === "shop") {
      for (const [key, value] of Object.entries({ size: "M", color: "black", category: "Shirts", sort: "price_desc" })) p.find("#filter-" + key).value = value;
      await p.w.fetchProducts(1);
      await p.w.fetchProducts(2);
    } else if (screen === "index") { p.w.updateURL(2); await p.w.fetchProducts(); }
    else await p.w.fetchProducts(2);
    const count = pushes, length = p.w.history.length;
    await traverse(p.w, "back");
    assert.equal(p.find("#pagination .active").textContent, "1");
    await traverse(p.w, "forward");
    assert.equal(p.find("#pagination .active").textContent, "2");
    assert.equal(pushes, count);
    assert.equal(p.w.history.length, length);
    if (screen === "shop") {
      assert.equal(p.find("#filter-size").value, "M");
      assert.equal(p.find("#filter-color").value, "black");
      assert.equal(p.find("#filter-category").value, "Shirts");
      assert.equal(p.find("#filter-sort").value, "price_desc");
    }
    if (screen === "search") assert.equal(new URL(p.w.location.href).searchParams.get("q"), "shirt");
  });
}
test("catalog HTTP errors are visible with recovery instead of rendering an error object", async t => {
  let failed = true;
  const p = await page(t, "pages/search.html", "js/search.js", () => failed ? response({ message: "Missing" }, 404) : catalog("Recovered"), "https://shop.test/search?q=shirt");
  assert.match(p.find("#products-list").textContent, /Không tải/);
  assert.doesNotMatch(p.find("#products-list").textContent, /undefined/);
  failed = false;
  p.find("#api-notice button").click(); await settle();
  assert.match(p.find("#products-list").textContent, /Recovered/);
  assert.equal(p.find("#api-notice"), null);
});

test("admin products Back/Forward restores search and pagination without new entries", async t => {
  const p = await page(t, "admin/products.html", "admin/js/products.js", url => url.pathname.endsWith("/categories") ? response([])
    : catalog((url.searchParams.get("search") || "all") + " page " + url.searchParams.get("page"), Number(url.searchParams.get("page"))), "https://shop.test/admin/products");
  let pushes = 0;
  const push = p.w.history.pushState.bind(p.w.history);
  p.w.history.pushState = (...args) => { pushes++; return push(...args); };
  p.find("#searchInput").value = "shirt"; p.w.searchProducts(); await settle();
  p.w.nextPage(); await settle();
  const count = pushes, length = p.w.history.length;
  await traverse(p.w, "back");
  assert.match(p.find("#productTable").textContent, /shirt page 1/);
  await traverse(p.w, "back");
  assert.equal(p.find("#searchInput").value, "");
  assert.match(p.find("#productTable").textContent, /all page 1/);
  await traverse(p.w, "forward"); await traverse(p.w, "forward");
  assert.equal(p.find("#searchInput").value, "shirt");
  assert.match(p.find("#productTable").textContent, /shirt page 2/);
  assert.equal(pushes, count);
  assert.equal(p.w.history.length, length);
});

test("admin orders Back/Forward restores local search, status and page without new history", async t => {
  const orders = Array.from({ length: 12 }, (_, i) => ({ ...order, _id: "order" + i,
    idUser: { name: "Customer", email: "buyer@example.com" }, status: i < 7 ? "PENDING" : "DONE" }));
  const p = await page(t, "admin/orders.html", "admin/js/order.js", () => response(orders), "https://shop.test/admin/orders");
  let pushes = 0;
  const push = p.w.history.pushState.bind(p.w.history);
  p.w.history.pushState = (...args) => { pushes++; return push(...args); };
  p.find('[data-page="2"]').click();
  p.find("#statusFilter").value = "DONE"; p.find("#statusFilter").onchange();
  p.find("#searchOrder").value = "buyer"; p.find("#searchOrder").oninput();
  const count = pushes, length = p.w.history.length;
  await traverse(p.w, "back");
  assert.equal(p.find("#searchOrder").value, "");
  assert.equal(p.find("#statusFilter").value, "DONE");
  await traverse(p.w, "back");
  assert.equal(p.find("#statusFilter").value, "");
  assert.equal(p.find(".page-btn.active").textContent.trim(), "2");
  await traverse(p.w, "forward"); await traverse(p.w, "forward");
  assert.equal(p.find("#searchOrder").value, "buyer");
  assert.equal(p.find("#statusFilter").value, "DONE");
  assert.equal(p.find(".page-btn.active").textContent.trim(), "1");
  assert.equal(pushes, count);
  assert.equal(p.w.history.length, length);
});

test("admin rejected status update restores the actual status and permits retry", async t => {
  let fail = true, writes = 0;
  const gate = deferred();
  const p = await page(t, "admin/orders.html", "admin/js/order.js", (url, options) => {
    if (options.method === "PUT") { writes++; return gate.promise; }
    return fail ? response([{ ...order, allowedTransitions: ["SHIPPING"] }]) : response({}, 500);
  }, "https://shop.test/admin/orders");
  const select = p.find(".status-select");
  select.value = "SHIPPING";
  const pending = select.onchange();
  await select.onchange();
  assert.equal(writes, 1);
  assert.equal(select.disabled, true);
  fail = false; gate.resolve(response({}, 409)); await pending;
  assert.equal(select.value, "PENDING");
  assert.equal(select.disabled, false);
  assert.ok(p.find("#api-notice"));
});

test("invalid dashboard payload does not render undefined and can be retried", async t => {
  let broken = true;
  const p = await page(t, "admin/dashboard.html", "admin/js/dashboard.js", url => url.pathname.endsWith("/dashboard")
    ? response(broken ? {} : { totalProducts: 4, totalOrders: 3, totalUsers: 2, revenue: 100, statusStats: { PENDING: 3 } }) : response([]));
  assert.doesNotMatch(p.find("#totalProducts").textContent, /undefined/);
  assert.ok(p.find("#api-notice"));
  broken = false; p.find("#api-notice button").click(); await settle();
  assert.equal(p.find("#totalProducts").textContent, "4");
});

test("all HTML entry points load API and chat helpers before scripts that require them", () => {
  for (const directory of ["pages", "admin"]) {
    for (const file of fs.readdirSync(path.join(__dirname, "../public", directory)).filter(name => name.endsWith(".html"))) {
      const dom = new JSDOM(read(directory + "/" + file));
      const scripts = [...dom.window.document.querySelectorAll("script[src]")].map(element => element.getAttribute("src"))
        .filter(src => !/^(https?:)?\/\//.test(src)).map(src => src.startsWith("/") ? src.slice(1) : path.posix.join(directory, src));
      for (const [i, script] of scripts.entries()) {
        if (script.startsWith("vendor/") || script === "runtime-config.js") continue; // Express serves installed vendor packages.
        const code = read(script);
        for (const [usage, helper] of [[/\bApi\./, "js/api.js"], [/\bChatSync\./, "js/chat-sync.js"], [/\bPaymentCreate\./, "js/payment-create.js"]]) {
          if (usage.test(code)) assert.ok(scripts.indexOf(helper) >= 0 && scripts.indexOf(helper) < i, directory + "/" + file + ": " + helper);
        }
      }
      dom.window.close();
    }
  }
});
test("payment 401 shows login without claiming payment failure or deleting the admin session", async t => {
  const p = await page(t, "pages/payment-result.html", "js/payment-result.js", () => response({}, 401), "https://shop.test/payment-result?reference=ref1");
  assert.equal(p.find("#payment-title").textContent, "Đăng nhập để kiểm tra");
  assert.equal(p.find("#payment-login").hidden, false);
  assert.equal(p.find("#payment-refresh").disabled, false);
  assert.ok(p.w.localStorage.getItem("adminToken"));
});

function socketFake() {
  const handlers = {}, manager = {}, sent = [];
  return { handlers, manager, sent, connected: true, auth: {},
    io: { on(name, handler) { manager[name] = handler; } },
    on(name, handler) { handlers[name] = handler; },
    emit(name, data, ack) {
      sent.push({ name, data, ack });
      if (name === "joinConversation") ack?.({ ok: true });
      else this.sendAck?.(ack, data);
    },
    disconnect() { this.connected = false; handlers.disconnect?.("io client disconnect"); },
    connect() { this.connected = true; handlers.connect?.(); }
  };
}
const message = (id, conversationId = "conversation1", content = id) => ({ _id: id, idConversation: conversationId,
  idUser: { _id: "user1", name: "Customer" }, content, createdAt: "2026-10-15T01:00:00Z" });
async function chatPage(t, admin, history, socket = socketFake()) {
  const p = await page(t, admin ? "admin/chat.html" : "pages/search.html", admin ? "admin/js/admin-chat.js" : "js/chat-widget.js", (url, options) => {
    if (url.pathname.endsWith("/conversation")) return response({ _id: "conversation1" });
    if (url.pathname.endsWith("/conversations")) return response([1, 2].map(number => ({
      idUser: { _id: "user" + number, name: "Customer " + number }, idConversation: { _id: "conversation" + number }
    })));
    if (url.pathname.endsWith("/me")) return response({ id: admin ? "admin1" : "user1", role: admin ? "ADMIN" : "USER" });
    return history(url, options);
  }, "https://shop.test/" + (admin ? "admin/chat" : ""), w => { w.io = () => socket; });
  if (admin) { p.find("#userList li").click(); await settle(); }
  return { ...p, socket, input: p.find(admin ? "#messageInput" : "#chat-input"),
    send: p.find(admin ? "#sendBtn" : "#chat-send"), messages: p.find(admin ? "#chatMessages" : "#chat-messages") };
}
for (const admin of [false, true]) {
  test((admin ? "admin" : "customer") + " reconnect refreshes auth, rejoins and resyncs missing messages by stable ID", async t => {
    let history = [message("first")];
    const p = await chatPage(t, admin, () => response(history));
    assert.equal(p.messages.querySelectorAll(".message-bubble").length, 1);
    const before = p.calls.filter(call => call.url.pathname.includes("/messages/")).length;
    p.socket.connected = false; p.socket.handlers.disconnect("transport close");
    p.input.value = "Unsent draft";
    const key = admin ? "adminToken" : "token";
    p.w.localStorage.setItem(key, "refreshed-token");
    p.socket.manager.reconnect_attempt();
    assert.equal(p.socket.auth.token, "refreshed-token");
    history = [message("first"), message("missed")];
    p.socket.connect(); await settle();
    assert.equal(p.socket.sent.filter(event => event.name === "joinConversation").length, 2);
    assert.ok(p.calls.filter(call => call.url.pathname.includes("/messages/")).length > before);
    assert.equal(p.messages.querySelectorAll(".message-bubble").length, 2);
    assert.equal(p.input.value, "Unsent draft");
    p.socket.handlers.newMessage(message("missed"));
    assert.equal(p.messages.querySelectorAll(".message-bubble").length, 2);
  });
  test((admin ? "admin" : "customer") + " socket event during history fetch is merged without dropping or duplicating messages", async t => {
    let next = null;
    const p = await chatPage(t, admin, () => next ? next.promise : response([]));
    next = deferred();
    p.socket.connect(); await settle();
    p.socket.handlers.newMessage(message("live"));
    p.socket.handlers.newMessage(message("foreign", "conversation2"));
    next.resolve(response([message("old"), message("live")]));
    await settle();
    assert.equal(p.messages.querySelectorAll(".message-bubble").length, 2);
    assert.match(p.messages.textContent, /live/);
    assert.match(p.messages.textContent, /old/);
    assert.doesNotMatch(p.messages.textContent, /foreign/);
  });
  test((admin ? "admin" : "customer") + " send waits for ACK, preserves failed draft and permits explicit retry", async t => {
    const p = await chatPage(t, admin, () => response([]));
    p.input.value = "Draft";
    const pending = p.send.onclick();
    p.send.click();
    assert.equal(p.socket.sent.filter(event => event.name === "sendMessage").length, 1);
    assert.equal(p.input.value, "Draft");
    assert.equal(p.send.disabled, true);
    p.socket.sent.at(-1).ack({ ok: false, status: 403, message: "Denied" });
    await pending;
    assert.equal(p.input.value, "Draft");
    assert.equal(p.send.disabled, false);
    assert.match(p.find(".chat-status").textContent, /Denied/);
    p.socket.sendAck = ack => ack({ ok: true, messageId: "sent1" });
    await p.send.onclick();
    assert.equal(p.input.value, "");
    assert.equal(p.send.disabled, false);
    assert.equal(p.socket.sent.filter(event => event.name === "sendMessage").length, 2);
    const sends = p.socket.sent.filter(event => event.name === "sendMessage");
    assert.equal(sends[0].data.clientMessageId, sends[1].data.clientMessageId);
    assert.match(sends[0].data.clientMessageId, /^[0-9a-f-]{36}$/i);
  });
}
test("admin conversation A/B histories returning in reverse order render only B", async t => {
  const a = deferred(), b = deferred();
  let delay = false;
  const p = await chatPage(t, true, url => delay
    ? (url.pathname.endsWith("conversation1") ? a.promise : b.promise) : response([]));
  delay = true;
  const first = p.w.selectUser({ name: "A", conversationId: "conversation1" }); await settle();
  const second = p.w.selectUser({ name: "B", conversationId: "conversation2" }); await settle();
  b.resolve(response([message("B message", "conversation2")])); await second;
  a.resolve(response([message("A message")])); await first;
  assert.equal(p.find("#chatHeader").textContent, "Chat với: B");
  assert.match(p.messages.textContent, /B message/);
  assert.doesNotMatch(p.messages.textContent, /A message/);
});
test("ACK for conversation A cannot erase a draft typed after switching to B", async t => {
  const p = await chatPage(t, true, () => response([]));
  p.input.value = "Draft A";
  const pending = p.send.onclick();
  const ack = p.socket.sent.at(-1).ack;
  await p.w.selectUser({ name: "B", conversationId: "conversation2" });
  p.input.value = "Draft B";
  ack({ ok: true, messageId: "sent-a" }); await pending;
  assert.equal(p.input.value, "Draft B");
  assert.equal(p.send.disabled, false);
});
test("lost chat ACK retains draft, resyncs history and never automatically resends", async t => {
  const p = await chatPage(t, false, () => response([message("committed", "conversation1", "Draft")]));
  const timers = [];
  const original = p.w.setTimeout.bind(p.w);
  p.w.setTimeout = (callback, delay) => delay === 8000 ? (timers.push(callback), 999) : original(callback, delay);
  p.input.value = "Draft";
  const pending = p.send.onclick();
  timers[0](); await pending; await settle();
  assert.equal(p.input.value, "Draft");
  assert.equal(p.send.disabled, false);
  assert.match(p.find(".chat-status").textContent, /kiểm tra lịch sử/);
  assert.equal(p.socket.sent.filter(event => event.name === "sendMessage").length, 1);
  assert.equal(p.messages.querySelectorAll(".message-bubble").length, 1);
});
test("chat authentication failure clears only the customer session and removes private history", async t => {
  const p = await chatPage(t, false, () => response([message("private")]));
  p.w.fetch = async () => response({}, 401);
  p.socket.connected = false;
  p.socket.handlers.disconnect("io server disconnect"); await settle();
  assert.equal(p.w.localStorage.getItem("token"), null);
  assert.ok(p.w.localStorage.getItem("adminToken"));
  assert.equal(p.messages.textContent, "");
  assert.match(p.find(".chat-status").textContent, /đăng nhập/);
});
