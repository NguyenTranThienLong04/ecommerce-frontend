(function () {
  function merge(items, incoming) {
    for (const row of incoming) {
      if (typeof row?._id !== "string") continue;
      const previous = items.get(row._id);
      // Read is monotonic. An older HTTP snapshot cannot undo a successful PATCH.
      items.set(row._id, { ...row, readAt: row.readAt || previous?.readAt || null });
    }
    return [...items.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b._id.localeCompare(a._id));
  }
  function destination(item, scope) {
    const id = encodeURIComponent(item.relatedEntityId);
    if (item.relatedEntityType === "CONVERSATION") return scope === "admin" ? `/admin/chat?conversation=${id}` : "/account?chat=1";
    if (item.relatedEntityType === "PAYMENT") return scope === "admin" ? `/admin/orders?search=${encodeURIComponent(item.relatedOrderId || "")}` : `/payment-result?reference=${id}`;
    if (item.relatedEntityType === "ORDER") return scope === "admin" ? `/admin/orders?search=${id}` : `/account?order=${id}`;
    return scope === "admin" ? "/admin/dashboard" : "/account";
  }
  window.NotificationSync = Object.freeze({ merge, destination });

  const scope = location.pathname.startsWith("/admin") ? "admin" : "user";
  const tokenKey = scope === "admin" ? "adminToken" : "token";
  const token = localStorage.getItem(tokenKey);
  if (!token || !ChatSync.isCurrent(scope)) return;
  const endpoint = window.AppConfig.apiBase + "/notifications";
  const request = (path = "", options = {}) => Api[scope](endpoint + path, { cache: "no-store", ...options });
  let mounted = false;
  function mount() {
    const host = document.querySelector(scope === "admin" ? ".admin-topbar" : ".header__icons, .checkout-brand");
    if (!host || mounted || localStorage.getItem(tokenKey) !== token) return;
    mounted = true;
    observer.disconnect();
    const root = document.createElement("div");
    root.className = "notifications";
    root.innerHTML = `<button class="notification-bell" type="button" aria-label="Thông báo" aria-expanded="false" aria-controls="notification-panel">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>
      <span class="notification-badge" hidden aria-hidden="true"></span></button>
      <span class="sr-only notification-announcement" role="status" aria-atomic="true"></span>
      <section id="notification-panel" class="notification-panel" aria-label="Thông báo gần đây" hidden>
        <div class="notification-heading"><strong>Thông báo</strong><button class="notification-read-all" type="button">Đọc tất cả</button></div>
        <p class="notification-status">Đang tải thông báo…</p>
        <button class="notification-retry" type="button" hidden>Thử lại</button>
        <ul class="notification-list"></ul>
        <button class="notification-more" type="button" hidden>Xem thêm</button>
      </section>`;
    host.appendChild(root);
    const bell = root.querySelector(".notification-bell"), panel = root.querySelector(".notification-panel");
    const badge = root.querySelector(".notification-badge"), announcement = root.querySelector(".notification-announcement");
    const list = root.querySelector(".notification-list"), status = root.querySelector(".notification-status");
    const readAll = root.querySelector(".notification-read-all"), retry = root.querySelector(".notification-retry");
    const more = root.querySelector(".notification-more"), items = new Map();
    let unreadCount = 0, nextCursor = null, stopped = false, running = null, dirty = false, revision = 0, generation = 0;
    let loaded = false, failure = "", realtime = false, loadingMore = false, markingAll = false;
    const socket = ChatSync.socket(scope);
    function active() { return !stopped && localStorage.getItem(tokenKey) === token; }
    function render() {
      if (!active()) return;
      badge.hidden = unreadCount === 0;
      badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      bell.setAttribute("aria-label", `Thông báo, ${unreadCount} chưa đọc`);
      const text = `${unreadCount} thông báo chưa đọc${realtime ? ". Có thông báo mới." : "."}`;
      if (announcement.textContent !== text) announcement.textContent = text;
      status.textContent = failure || (!loaded ? "Đang tải thông báo…" : items.size ? (realtime ? "Vừa nhận thông báo mới." : "") : "Bạn chưa có thông báo.");
      retry.hidden = !failure;
      readAll.disabled = markingAll || !loaded || unreadCount === 0;
      more.hidden = !nextCursor;
      const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.notificationId : null;
      list.replaceChildren();
      for (const item of merge(items, [])) {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.className = "notification-item" + (item.readAt ? "" : " notification-unread");
        link.dataset.notificationId = item._id;
        link.href = destination(item, scope);
        const title = document.createElement("strong"), message = document.createElement("span"), meta = document.createElement("small");
        title.textContent = item.title;
        message.textContent = item.message;
        meta.textContent = `${item.readAt ? "Đã đọc" : "Chưa đọc"} · ${new Date(item.createdAt).toLocaleString("vi-VN")}`;
        link.append(title, message, meta);
        link.onclick = event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          Api.action("notification:" + item._id, null, async () => {
            if (!item.readAt) {
              const response = await request("/" + encodeURIComponent(item._id) + "/read", { method: "PATCH" });
              if (!active()) return;
              const { item: saved } = await response.json();
              ++revision; merge(items, [saved]);
            }
            if (active()) location.assign(link.href);
          }, error => { failure = error.message; render(); });
        };
        li.appendChild(link); list.appendChild(li);
        if (item._id === focusedId) link.focus({ preventScroll: true });
      }
    }
    // Coalesce invalidations. If a live event/read overlaps HTTP, fetch again before
    // accepting the count. IDs merge once, including events already in the snapshot.
    function refresh() {
      dirty = true;
      if (running) return running;
      running = (async () => {
        try {
          while (dirty && active()) {
            dirty = false;
            const started = revision;
            const response = await request("?limit=20" + (scope === "admin" ? "&scope=admin" : ""));
            const snapshot = await response.json();
            if (!active()) return;
            merge(items, Api.list(snapshot.items));
            if (started !== revision) { dirty = true; continue; }
            // A refresh returns the recent page; old loaded pages are deliberately
            // dropped so read-all and cross-tab read state cannot remain stale.
            const keep = new Set(snapshot.items.map(item => item._id));
            for (const id of items.keys()) if (!keep.has(id)) items.delete(id);
            unreadCount = snapshot.unreadCount; nextCursor = snapshot.nextCursor;
            loaded = true; failure = ""; render();
          }
        } catch (error) { failure = error.message; render(); }
        finally { running = null; }
      })();
      return running;
    }
    async function recover() {
      if (!active()) return;
      const current = ++generation;
      try {
        const response = await Api[scope](window.AppConfig.apiBase + "/auth/me");
        const user = await response.json();
        if (!active() || current !== generation) return;
        if (scope === "admin" && user.role !== "ADMIN") { Api.expire(scope, token); return; }
        await ChatSync.ack(socket, "joinNotifications", {}, scope);
        if (active() && current === generation && socket.connected) await refresh();
      } catch (error) { failure = error.message; render(); }
    }
    function incoming(item) {
      if (!active()) return;
      const unseen = !items.has(item._id);
      merge(items, [item]); ++revision;
      if (unseen) realtime = true;
      render(); refresh();
    }
    function changed() { ++revision; refresh(); }
    function disconnected(reason) {
      ++generation;
      if (!active()) return;
      failure = "Mất kết nối realtime. Bạn vẫn có thể tải lại thông báo."; render();
      if (reason === "io server disconnect") reconnect();
    }
    async function reconnect() {
      if (!active()) return;
      try {
        await Api[scope](window.AppConfig.apiBase + "/auth/me");
        if (!active()) return;
        if (socket.connected) await recover();
        else { socket.auth = { token }; socket.connect(); await refresh(); }
      } catch (error) { failure = error.message; render(); }
    }
    socket.on("connect", recover);
    socket.on("disconnect", disconnected);
    socket.on("connect_error", () => { if (active()) { failure = "Chưa kết nối realtime. Có thể thử lại."; render(); } });
    socket.on("notification:new", incoming);
    socket.on("notification:changed", changed);
    if (socket.connected) recover();
    refresh(); // HTTP works even if websocket transport is unavailable.
    bell.onclick = () => {
      panel.hidden = !panel.hidden;
      bell.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) { positionPanel(); realtime = false; refresh(); }
    };
    function positionPanel() {
      if (scope === "admin" && innerWidth <= 600) {
        const top = Math.max(16, Math.min(bell.getBoundingClientRect().bottom + 8, innerHeight - 160));
        panel.style.top = top + "px";
        panel.style.maxHeight = Math.max(120, innerHeight - top - 16) + "px";
      } else { panel.style.top = ""; panel.style.maxHeight = ""; }
    }
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, { passive: true });
    function close() { panel.hidden = true; bell.setAttribute("aria-expanded", "false"); }
    document.addEventListener("click", event => { if (!root.contains(event.target)) close(); });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel.hidden) { close(); bell.focus(); }
    });
    root.addEventListener("focusout", event => { if (event.relatedTarget && !root.contains(event.relatedTarget)) close(); });
    readAll.onclick = async () => {
      if (markingAll) return;
      markingAll = true;
      try {
        await Api.action("notification:read-all", readAll, async () => {
          await request("/read-all", { method: "PATCH" }); ++revision; await refresh();
        }, error => { failure = error.message; render(); });
      } finally { markingAll = false; render(); }
    };
    retry.onclick = () => Api.action("notification:retry", retry, async () => { await refresh(); await reconnect(); });
    more.onclick = () => Api.action("notification:more", more, async () => {
      if (!nextCursor || loadingMore) return;
      loadingMore = true;
      const started = revision, cursor = nextCursor;
      try {
        const response = await request("?limit=20&before=" + encodeURIComponent(cursor));
        const snapshot = await response.json();
        if (!active() || started !== revision || cursor !== nextCursor) return;
        merge(items, Api.list(snapshot.items)); unreadCount = snapshot.unreadCount; nextCursor = snapshot.nextCursor; render();
      } finally { loadingMore = false; }
    }, error => { failure = error.message; render(); });
    window.addEventListener("focus", () => { if (active()) refresh(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && active()) refresh(); });
    function stop() { stopped = true; ++generation; items.clear(); root.remove(); socket.disconnect(); }
    window.addEventListener("session-expired", event => { if (event.detail.scope === scope) stop(); });
    window.addEventListener("storage", event => { if (event.key === tokenKey && event.newValue !== token) stop(); });
    render();
  }
  const observer = new MutationObserver(mount);
  observer.observe(document.body, { childList: true, subtree: true });
  mount();
})();
