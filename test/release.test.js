const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const config = require("../config");
const { createApp } = require("../app");
test("frontend rejects missing/unsafe deployment origins", () => {
  for (const BACKEND_URL of [undefined, "javascript:alert(1)", "https://user:secret@example.com", "https://api.example.com/path"]) {
    assert.throws(() => config({ BACKEND_URL }), /BACKEND_URL/);
  }
  assert.throws(() => config({ NODE_ENV: "production", BACKEND_URL: "http://api.example.com" }), /HTTPS/);
});
test("runtime config is public-only, uncached and supplies the locally served socket client", async t => {
  const settings = config({ BACKEND_URL: "http://api.example.com", JWT_SECRET: "must-not-appear" });
  const server = createApp(settings).listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(base + "/runtime-config.js");
  const source = await response.text();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(source, /JWT_SECRET|must-not-appear/);
  const context = { window: {} }; vm.runInNewContext(source, context);
  assert.equal(context.window.AppConfig.apiBase, "http://api.example.com/api");
  assert.equal((await fetch(base + "/vendor/socket.io.min.js")).status, 200);
});
test("unresolved logical chat send reuses its UUID; confirmed same-text sends get new IDs and contexts stay separate", t => {
  const dom = new JSDOM("<body></body>", { url: "https://shop.test", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, "../public/js/api.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(__dirname, "../public/js/chat-sync.js"), "utf8"));
  w.localStorage.setItem("user", JSON.stringify({ id: "customer1" }));
  const first = w.ChatSync.intent("user", "conversation1", "Hello");
  assert.equal(w.ChatSync.intent("user", "conversation1", "Hello").clientMessageId, first.clientMessageId);
  assert.notEqual(w.ChatSync.intent("admin", "conversation1", "Hello").clientMessageId, first.clientMessageId);
  assert.notEqual(w.ChatSync.intent("user", "conversation2", "Hello").clientMessageId, first.clientMessageId);
  w.ChatSync.confirmed(first);
  assert.notEqual(w.ChatSync.intent("user", "conversation1", "Hello").clientMessageId, first.clientMessageId);
});
