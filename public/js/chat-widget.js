(function () {
  const BASE = window.AppConfig.apiBase;
  const API_URL = `${BASE}/chat`;

  let socket = null;
  let conversationId = null;

  const token = localStorage.getItem("token");

  let userId = null;
  const userData = localStorage.getItem("user");

  if (userData) {
    try {
      const user = JSON.parse(userData);
      userId = user.id || user._id;
    } catch (e) {
      console.log("Parse user error");
    }
  }

  if (!userId) {
    console.log("Không có userId trong localStorage");
  }

  // ================= UI (chèn trước — không phụ thuộc socket) =================

  const chatHTML = `
<div id="chat-widget">

<button id="chat-button" type="button" aria-label="Mở chat" aria-controls="chat-box" aria-expanded="false"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 9h9M7 13h6"/></svg></button>

<div id="chat-box" role="region" aria-label="Hỗ trợ Karma Club">

<div id="chat-header">
<div>Chat với shop<small>Karma Club / Hỗ trợ khách hàng</small></div>
<button id="chat-close" type="button" aria-label="Đóng chat">✖</button>
</div>

<div id="chat-messages" role="log" aria-label="Tin nhắn"></div>
<p id="chat-status" class="chat-status" role="status"></p>
<button id="chat-retry" type="button" hidden>Kết nối / tải lại</button>

<div id="chat-input-area">
<input id="chat-input" aria-label="Tin nhắn" placeholder="Nhập tin nhắn..."/>
<button id="chat-send" type="button">Gửi</button>
</div>

</div>

</div>
`;

  document.body.insertAdjacentHTML("beforeend", chatHTML);



  const chatButton = document.getElementById("chat-button");
  const chatBox = document.getElementById("chat-box");
  const chatClose = document.getElementById("chat-close");
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const chatSend = document.getElementById("chat-send");

  chatButton.onclick = () => {
    chatBox.style.display = "flex";
    chatInput.focus();
  };

  chatClose.onclick = () => {
    chatBox.style.display = "none";
    chatButton.focus();
  };
  if (new URLSearchParams(location.search).get("chat") === "1") chatButton.click();

  const status = document.getElementById("chat-status");
  const retry = document.getElementById("chat-retry");
  const messages = new Map();
  let historyVersion = 0, syncVersion = 0, initialized = false, joined = false;
  function state(message = "", recover = false) {
    status.textContent = message;
    retry.hidden = !recover;
  }
  function receive(incoming) {
    const ordered = ChatSync.merge(messages, incoming, conversationId);
    chatMessages.replaceChildren();
    ordered.forEach(renderMessage);
  }
  async function loadMessages() {
    if (!conversationId || !ChatSync.isCurrent("user")) return;
    const request = ++historyVersion;
    const id = conversationId;
    const res = await Api.user(`${API_URL}/messages/${encodeURIComponent(id)}`);
    const history = Api.list(await res.json());
    if (request !== historyVersion || id !== conversationId) return;
    receive(history); // Merge live events received while the snapshot was in flight.
  }
  async function resync() {
    if (!conversationId || !socket?.connected || !ChatSync.isCurrent("user")) return;
    const sync = ++syncVersion;
    joined = false;
    try {
      await ChatSync.ack(socket, "joinConversation", conversationId, "user");
      if (sync !== syncVersion || !socket.connected) return;
      joined = true;
      await loadMessages();
      if (sync === syncVersion) state();
    } catch (error) { if (sync === syncVersion) state(error.message, error.status !== 401); }
  }
  async function initChat() {
    if (initialized || !ChatSync.isCurrent("user")) return;
    initialized = true;
    try {
      const res = await Api.user(`${API_URL}/conversation`, { method: "POST" });
      const data = await res.json();
      if (typeof data?._id !== "string") throw Api.error(502);
      conversationId = data._id;
      if (socket?.connected) await resync();
      else await loadMessages();
    } catch (error) { state(error.message, error.status !== 401); }
    finally { initialized = false; }
  }
  async function recoverConnection() {
    if (!ChatSync.isCurrent("user")) return;
    try {
      await Api.user(`${BASE}/auth/me`);
      if (!socket) connectSocket();
      else if (!socket.connected) {
        socket.auth = { token: localStorage.getItem("token") };
        socket.connect();
      } else if (!conversationId) await initChat();
      else await resync();
    } catch (error) { state(error.message, error.status !== 401); }
  }
  function connectSocket() {
    if (!ChatSync.isCurrent("user") || typeof io === "undefined") return;
    socket = ChatSync.socket("user");
    socket.io?.on("reconnect_attempt", () => { socket.auth = { token: localStorage.getItem("token") }; });
    socket.on("connect", () => { if (conversationId) resync(); else initChat(); });
    socket.on("disconnect", reason => {
      ++syncVersion;
      joined = false;
      ++historyVersion;
      state("Chat đang mất kết nối. Bản nháp được giữ lại.", true);
      if (reason === "io server disconnect") recoverConnection();
    });
    socket.on("connect_error", () => {
      joined = false;
      state("Không kết nối được chat.", true);
      if (ChatSync.isCurrent("user")) Api.user(`${BASE}/auth/me`).catch(error => state(error.message, error.status !== 401));
    });
    socket.on("newMessage", message => receive([message]));
    if (socket.connected) { if (conversationId) resync(); else initChat(); }
  }
  retry.onclick = () => Api.action("chat-recover", retry, recoverConnection);
  chatSend.onclick = sendMessage;
  chatInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); sendMessage(); } });
  function sendMessage() {
    const draft = chatInput.value;
    const content = draft.trim();
    if (!content) return;
    if (!localStorage.getItem("token")) { state("Đăng nhập để gửi tin nhắn."); return; }
    if (!joined || !socket?.connected) { state("Chat chưa sẵn sàng. Vui lòng kết nối lại.", true); return; }
    return Api.action("chat-send", chatSend, async () => {
      const payload = ChatSync.intent("user", conversationId, content);
      const ack = await ChatSync.ack(socket, "sendMessage", payload, "user");
      if (!ack.messageId) throw Api.error(502);
      ChatSync.confirmed(payload);
      if (chatInput.value === draft) chatInput.value = "";
      state();
      await loadMessages();
    }, error => {
      state(error.message, error.status !== 401);
      // Never resend automatically after an ambiguous ACK timeout.
      if (error.code === "CHAT_ACK_TIMEOUT") loadMessages().catch(() => {});
    });
  }
  window.addEventListener("session-expired", event => {
    if (event.detail.scope !== "user") return;
    ++historyVersion;
    ++syncVersion;
    joined = false;
    socket?.disconnect();
    messages.clear();
    chatMessages.replaceChildren();
    state("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  });
  if (!token) state("Đăng nhập để chat với shop.");
  connectSocket();

  function renderMessage(msg) {
    if (!msg) return;

    const senderId = msg?.idUser?._id || msg?.idUser;

    const row = document.createElement("div");

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.innerText = msg.content;

    const name = document.createElement("div");
    name.className = "message-name";

    if (senderId == userId) {
      row.className = "message-row message-me";
      name.innerText = "Bạn";
    } else {
      row.className = "message-row message-other";
      name.innerText = "ADMIN";
    }

    row.appendChild(name);
    row.appendChild(bubble);
    const date = new Date(msg.createdAt);
    if (!Number.isNaN(date.getTime())) {
      const time = document.createElement("time");
      time.className = "message-time";
      time.dateTime = date.toISOString();
      time.textContent = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      time.title = date.toLocaleString("vi-VN");
      row.appendChild(time);
    }

    chatMessages.appendChild(row);

    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  initChat();
})();
