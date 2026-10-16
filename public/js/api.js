/* Checked JSON requests. No automatic retry of writes: callers own recovery semantics. */
(function () {
  const pending = new Set();
  const keys = scope => scope === "admin" ? ["adminToken", "adminUser"] : ["token", "user"];
  function stored(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  }
  function error(status = 0, data = {}, code) {
    const messages = { 400: "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.", 401: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
      403: "Bạn không có quyền thực hiện thao tác này.", 404: "Không tìm thấy dữ liệu yêu cầu.",
      409: "Dữ liệu đã thay đổi. Vui lòng kiểm tra và thử lại." };
    const message = status >= 500 ? "Máy chủ tạm thời gặp lỗi. Vui lòng thử lại."
      : status === 401 ? messages[401] : typeof data?.message === "string" && data.message.length <= 300
        ? data.message : messages[status] || "Không kết nối được máy chủ. Vui lòng thử lại.";
    return Object.assign(new Error(message), { status, code: code || data?.code || "REQUEST_FAILED", itemId: data?.itemId,
      errors: Array.isArray(data?.errors) ? data.errors : [] });
  }
  function expire(scope, sentToken) {
    if (scope === "none") return;
    const [tokenKey, userKey] = keys(scope);
    // A late 401 from the old login must not log out a newer session.
    if (localStorage.getItem(tokenKey) !== sentToken) return;
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(userKey);
    // Checkout attempts remain in sessionStorage until their result is resolved.
    window.dispatchEvent(new CustomEvent("session-expired", { detail: { scope } }));
    report(error(401), null, scope);
  }
  function report(failure, retry, scope) {
    if (failure?.status === undefined) failure = error();
    let panel = document.getElementById("api-notice");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "api-notice";
      panel.setAttribute("role", "alert");
      (document.body || document.documentElement).prepend(panel);
    }
    // Keep the login link when a page's catch also reports the same 401.
    if (failure?.status === 401 && !scope && panel.querySelector("a")) return;
    panel.replaceChildren(document.createTextNode(failure?.message || "Không tải được dữ liệu. Vui lòng thử lại."));
    if (failure?.status === 401) {
      const link = document.createElement("a");
      link.href = scope === "admin" ? "/admin/login" : "/login";
      link.textContent = " Đăng nhập lại";
      panel.appendChild(link);
    } else if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Thử lại";
      button.onclick = () => action(button, button, async () => {
        panel.remove();
        await retry();
      }, failure => report(failure, retry, scope));
      panel.appendChild(button);
    }
  }
  async function request(url, options = {}, scope = "none") {
    const { timeoutMs = 15000, allowHttpErrors = false, ...init } = options;
    const sentToken = scope === "none" ? null : localStorage.getItem(keys(scope)[0]);
    if (scope !== "none" && !sentToken) { expire(scope, sentToken); throw error(401); }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init.signal?.aborted) abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, { ...init, signal: controller.signal,
            headers: { ...init.headers, ...(scope === "none" ? {} : { Authorization: "Bearer " + sentToken }) } });
          if (response.status === 401) expire(scope, sentToken);
          let data;
          try { data = response.status === 204 ? null : await response.json(); }
          catch { throw error(response.ok ? 502 : response.status, {}, "INVALID_RESPONSE"); }
          if (scope !== "none" && localStorage.getItem(keys(scope)[0]) !== sentToken && response.status !== 401) {
            throw error(401, {}, "SESSION_CHANGED");
          }
          if (!response.ok && (!allowHttpErrors || response.status === 401)) throw error(response.status, data);
          if (!response.ok) {
            const failure = error(response.status, data);
            data = { code: failure.code, message: failure.message, itemId: failure.itemId, errors: failure.errors };
          }
          return { ok: response.ok, status: response.status, json: async () => data };
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(error(0,
            { message: "Chưa nhận được kết quả. Vui lòng kiểm tra lại trước khi thử lại." }, "REQUEST_TIMEOUT")); }, timeoutMs);
        })
      ]);
    } catch (failure) {
      if (failure.status !== undefined) throw failure;
      if (failure.name === "AbortError") throw error(0, { message: "Yêu cầu đã dừng." }, "REQUEST_ABORTED");
      throw error(0, {}, "NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  }
  async function action(key, buttons, work, onError = failure => alert(failure.message)) {
    if (pending.has(key)) return;
    pending.add(key);
    const controls = (Array.isArray(buttons) ? buttons : [buttons]).filter(Boolean);
    const disabled = controls.map(button => button.disabled);
    controls.forEach(button => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
    try { return await work(); }
    catch (failure) { await onError(failure?.status !== undefined ? failure : error()); }
    finally {
      pending.delete(key);
      controls.forEach((button, index) => { button.disabled = disabled[index]; button.removeAttribute("aria-busy"); });
    }
  }
  function list(data) { if (!Array.isArray(data)) throw error(502, {}, "INVALID_RESPONSE"); return data; }
  window.Api = Object.freeze({ fetch: request, user: (url, options) => request(url, options, "user"),
    admin: (url, options) => request(url, options, "admin"), error, expire, report, action, stored, list });
})();
