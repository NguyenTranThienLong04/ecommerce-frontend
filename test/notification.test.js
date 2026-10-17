const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const read = file => fs.readFileSync(path.join(__dirname, "../public", file), "utf8");
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const row = (id, changes = {}) => ({ _id: id, type: "ORDER_STATUS_CHANGED", title: "Cập nhật đơn hàng", message: "Đã xác nhận",
  relatedEntityType: "ORDER", relatedEntityId: "order1", readAt: null, createdAt: "2026-10-17T01:00:00.000Z", ...changes });
function fakeSocket() {
  const handlers = new Map(), manager = {}, calls = [];
  const socket = { connected: true, auth: {}, calls, manager,
    io: { on(event, work) { manager[event] = work; } },
    on(event, work) { handlers.set(event, [...(handlers.get(event) || []), work]); return this; },
    fire(event, ...args) { for (const work of handlers.get(event) || []) work(...args); },
    emit(event, payload, ack) { calls.push({ event, payload }); ack({ ok: true }); },
    connect() { this.connected = true; this.fire("connect"); },
    disconnect() { if (!this.connected) return; this.connected = false; this.fire("disconnect", "io client disconnect"); }
  };
  return socket;
}
async function setup(t, { admin = false, initial = [], guest = false, delayed = false } = {}) {
  const dom = new JSDOM(`<body>${delayed ? "" : admin ? '<header class="admin-topbar"></header>' : '<header class="header__icons"></header>'}</body>`, {
    url: "https://shop.test/" + (admin ? "admin/orders" : "account"), runScripts: "outside-only", pretendToBeVisual: true
  });
  t.after(() => dom.window.close());
  const w = dom.window, socket = fakeSocket(), requests = [];
  let items = initial, hook, sockets = 0;
  w.AppConfig = { apiBase: "https://api.test/api", socketUrl: "https://api.test" };
  if (!guest) w.localStorage.setItem(admin ? "adminToken" : "token", "session");
  w.fetch = async (url, options) => {
    requests.push({ url, options });
    const route = new URL(url);
    if (route.pathname.endsWith("/auth/me")) return { ok: true, status: 200, json: async () => ({ role: admin ? "ADMIN" : "USER" }) };
    if (options.method === "PATCH") {
      const id = route.pathname.split("/").at(-2);
      items = items.map(item => route.pathname.endsWith("/read-all") || item._id === id ? { ...item, readAt: "2026-10-17T02:00:00Z" } : item);
      return { ok: true, status: 200, json: async () => ({ item: items.find(item => item._id === id), modifiedCount: items.length }) };
    }
    if (hook) return hook(route);
    return { ok: true, status: 200, json: async () => ({ items, unreadCount: items.filter(item => !item.readAt).length, nextCursor: null }) };
  };
  w.io = () => { sockets++; return socket; };
  for (const file of ["js/api.js", "js/chat-sync.js", "js/notifications.js"]) w.eval(read(file));
  await settle();
  return { w, socket, requests, setItems(value) { items = value; }, setHook(value) { hook = value; }, sockets: () => sockets,
    find: selector => w.document.querySelector(selector), links: () => [...w.document.querySelectorAll(".notification-item")] };
}
test("guest opens no notification connection; delayed header mounts one accessible bell", async t => {
  const guest = await setup(t, { guest: true }); assert.equal(guest.sockets(), 0); assert.equal(guest.find(".notifications"), null);
  const p = await setup(t, { delayed: true });
  p.w.document.body.innerHTML = '<header class="header__icons"></header>'; await settle();
  assert.equal(p.sockets(), 1); assert.ok(p.find(".notification-bell"));
  assert.equal(p.find(".notification-panel").hidden, true);
  p.find(".notification-bell").click(); assert.equal(p.find(".notification-panel").hidden, false);
  p.find(".notification-bell").dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(p.find(".notification-panel").hidden, true); assert.equal(p.w.document.activeElement, p.find(".notification-bell"));
  assert.match(p.find(".notification-status").textContent, /chưa có thông báo/);
});
for (const admin of [false, true]) {
  test((admin ? "admin" : "customer") + " reconnect reauthenticates, joins, snapshots and deduplicates live/HTTP overlap", async t => {
    const p = await setup(t, { admin, initial: [row("first")] });
    assert.equal(p.sockets(), 1); assert.equal(p.w.ChatSync.socket(admin ? "admin" : "user"), p.socket); assert.equal(p.sockets(), 1);
    p.socket.disconnect();
    p.setItems([row("first"), row("missed")]);
    const start = p.requests.length;
    p.socket.connect(); await settle();
    assert.ok(p.requests[start].url.endsWith("/auth/me"));
    assert.equal(p.socket.calls.filter(call => call.event === "joinNotifications").length, 2);
    assert.equal(p.links().length, 2);
    p.socket.fire("notification:new", row("missed")); await settle();
    assert.equal(p.links().length, 2); assert.equal(p.find(".notification-badge").textContent, "2");
    assert.ok(p.requests.filter(call => call.url.includes("/notifications")).every(call => call.options.headers.Authorization === "Bearer session"));
  });
}
test("incoming event during stale HTTP snapshot preserves one row and refreshes authoritative count", async t => {
  const p = await setup(t, { initial: [row("old")] }), pending = deferred();
  let calls = 0;
  p.setHook(() => ++calls === 1 ? pending.promise : Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [row("old"), row("live")], unreadCount: 2, nextCursor: null }) }));
  p.find(".notification-bell").click(); await settle();
  p.socket.fire("notification:new", row("live")); p.socket.fire("notification:new", row("live"));
  pending.resolve({ ok: true, status: 200, json: async () => ({ items: [row("old")], unreadCount: 1, nextCursor: null }) });
  await settle(); assert.equal(p.links().length, 2); assert.equal(p.find(".notification-badge").textContent, "2");
  assert.match(p.find(".notification-announcement").textContent, /Có thông báo mới/);
});
test("read-all suppresses duplicate clicks, refreshes all states and keeps new later notifications unread", async t => {
  const p = await setup(t, { initial: [row("a"), row("b")] });
  p.find(".notification-bell").click(); await settle();
  const pending = p.find(".notification-read-all").onclick(); p.find(".notification-read-all").click(); await pending; await settle();
  assert.equal(p.requests.filter(call => call.options.method === "PATCH").length, 1);
  assert.equal(p.find(".notification-badge").hidden, true);
  assert.equal(p.find(".notification-read-all").disabled, true);
  assert.equal(p.w.document.querySelectorAll(".notification-unread").length, 0);
  p.w.document.body.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(p.find(".notification-panel").hidden, true);
  const readAt = "2026-10-17T02:00:00Z";
  p.setItems([row("a", { readAt }), row("b", { readAt }), row("new")]);
  p.socket.fire("notification:new", row("new")); await settle();
  assert.equal(p.find(".notification-badge").textContent, "1");
});
test("read state never regresses on duplicate stale event; read change from another tab refreshes badge", async t => {
  const p = await setup(t, { initial: [row("a")] });
  const data = new p.w.Map();
  p.w.NotificationSync.merge(data, [row("a", { readAt: "2026-10-17T02:00:00Z" })]);
  assert.ok(p.w.NotificationSync.merge(data, [row("a")])[0].readAt);
  p.setItems([row("a", { readAt: "2026-10-17T02:00:00Z" })]); p.socket.fire("notification:changed"); await settle();
  assert.equal(p.find(".notification-badge").hidden, true);
});
test("pagination merges IDs, preserves newest-first order and uses inbox unread count", async t => {
  const p = await setup(t, { initial: [row("new", { createdAt: "2026-10-17T05:00:00Z" })] });
  p.setHook(url => Promise.resolve({ ok: true, status: 200, json: async () => ({ items: url.searchParams.has("before") ? [row("old"), row("new", { createdAt: "2026-10-17T05:00:00Z" })] : [row("new", { createdAt: "2026-10-17T05:00:00Z" })], unreadCount: 7, nextCursor: url.searchParams.has("before") ? null : "cursor" }) }));
  p.find(".notification-bell").click(); await settle(); await p.find(".notification-more").onclick();
  assert.deepEqual(p.links().map(link => link.dataset.notificationId), ["new", "old"]);
  assert.equal(p.find(".notification-badge").textContent, "7"); assert.equal(p.find(".notification-more").hidden, true);
});
test("notification content is text and destinations use only encoded internal routes", async t => {
  const p = await setup(t, { initial: [row("xss", { title: '<img src=x onerror="alert(1)">', message: "<script>bad()</script>", relatedEntityId: "javascript:alert(1)" })] });
  assert.equal(p.links()[0].querySelector("img, script"), null); assert.match(p.links()[0].textContent, /<img/);
  assert.equal(new URL(p.links()[0].href).pathname, "/account");
  assert.equal(p.w.NotificationSync.destination(row("a", { relatedEntityType: "PAYMENT", relatedEntityId: "ref" }), "user"), "/payment-result?reference=ref");
  assert.equal(p.w.NotificationSync.destination(row("a", { relatedEntityType: "CONVERSATION", relatedEntityId: "chat" }), "admin"), "/admin/chat?conversation=chat");
});
test("late HTTP result after session expiry cannot restore private notifications", async t => {
  const p = await setup(t, { initial: [row("private")] }), pending = deferred();
  p.setHook(() => pending.promise); p.find(".notification-bell").click(); await settle();
  p.w.Api.expire("user", "session");
  pending.resolve({ ok: true, status: 200, json: async () => ({ items: [row("private")], unreadCount: 1, nextCursor: null }) });
  await settle(); assert.equal(p.find(".notifications"), null); assert.equal(p.socket.connected, false);
});
test("old notification connection cannot send auth requests under a replacement session", async t => {
  const p = await setup(t, { initial: [row("private")] });
  const before = p.requests.length;
  p.w.localStorage.setItem("token", "replacement");
  p.socket.fire("connect"); p.socket.fire("disconnect", "io server disconnect"); await settle();
  assert.equal(p.requests.length, before);
  assert.equal(p.w.localStorage.getItem("token"), "replacement");
});
test("shared socket rejects an ACK request under a different login before any event is sent", async t => {
  const p = await setup(t);
  p.socket.auth = { token: "session" };
  p.w.localStorage.setItem("token", "replacement");
  const before = p.socket.calls.length;
  await assert.rejects(p.w.ChatSync.ack(p.socket, "joinConversation", "private", "user"), error => error.code === "SESSION_CHANGED");
  assert.equal(p.socket.calls.length, before);
  assert.equal(p.w.localStorage.getItem("token"), "replacement");
});
test("late-loading chat and notification widgets never start requests for a replaced document session", async t => {
  const dom = new JSDOM('<body><header class="header__icons"></header></body>', { url: "https://shop.test/account", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.AppConfig = { apiBase: "https://api.test/api", socketUrl: "https://api.test" };
  w.localStorage.setItem("token", "original"); w.localStorage.setItem("user", JSON.stringify({ id: "user1" }));
  w.eval(read("js/api.js")); w.eval(read("js/chat-sync.js"));
  w.localStorage.setItem("token", "replacement");
  let requests = 0, sockets = 0;
  w.fetch = async () => { requests++; throw new Error("unexpected request"); };
  w.io = () => { sockets++; return fakeSocket(); };
  w.eval(read("js/notifications.js")); w.eval(read("js/chat-widget.js")); await settle();
  assert.equal(requests, 0); assert.equal(sockets, 0); assert.equal(w.localStorage.getItem("token"), "replacement");
});
test("loading/error recovery and read action failures keep inbox reviewable without navigating", async t => {
  const p = await setup(t, { initial: [row("one")] });
  p.setHook(() => Promise.reject(new Error("offline"))); p.find(".notification-bell").click(); await settle();
  assert.equal(p.find(".notification-retry").hidden, false); assert.equal(p.links().length, 1);
  p.setHook(null); await p.find(".notification-retry").onclick(); await settle(); assert.equal(p.find(".notification-retry").hidden, true);
  p.w.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  p.links()[0].click(); await settle();
  assert.equal(p.w.location.pathname, "/account"); assert.match(p.find(".notification-status").textContent, /Máy chủ/);
});
