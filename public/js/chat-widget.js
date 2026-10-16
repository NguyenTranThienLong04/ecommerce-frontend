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

<button id="chat-button" type="button" aria-label="Mở chat">💬</button>

<div id="chat-box">

<div id="chat-header">
Chat với shop
<button id="chat-close" type="button" aria-label="Đóng chat">✖</button>
</div>

<div id="chat-messages"></div>
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

  const style = document.createElement("style");
  style.textContent = `

#chat-widget{
position:fixed;
bottom:max(20px, env(safe-area-inset-bottom, 0px));
right:max(20px, env(safe-area-inset-right, 0px));
font-family:Arial, sans-serif;
z-index:100050;
pointer-events:auto;
}

#chat-button{
width:60px;
height:60px;
background:#ff4d4f;
color:white;
border-radius:50%;
display:flex;
align-items:center;
justify-content:center;
font-size:28px;
cursor:pointer;
box-shadow:0 4px 10px rgba(0,0,0,0.2);
border:none;
padding:0;
}

#chat-box{
width:min(320px, calc(100vw - 32px));
height:420px;
max-height:min(420px, 70vh);
background:white;
border-radius:12px;
box-shadow:0 0 15px rgba(0,0,0,0.25);
display:none;
flex-direction:column;
overflow:hidden;
}

#chat-header{
background:#ff4d4f;
color:white;
padding:12px;
display:flex;
justify-content:space-between;
align-items:center;
font-weight:bold;
}

#chat-messages{
flex:1;
padding:12px;
overflow-y:auto;
display:flex;
flex-direction:column;
gap:8px;
background:#f5f5f5;
}

.message-row{
display:flex;
flex-direction:column;
max-width:75%;
}

.message-me{
align-self:flex-end;
text-align:right;
}

.message-other{
align-self:flex-start;
}

.message-name{
font-size:11px;
margin-bottom:2px;
color:#666;
}

.message-bubble{
padding:8px 12px;
border-radius:16px;
font-size:14px;
line-height:1.4;
word-break:break-word;
}

.message-me .message-bubble{
background:#ff4d4f;
color:white;
border-bottom-right-radius:4px;
}

.message-other .message-bubble{
background:white;
border:1px solid #e5e5e5;
border-bottom-left-radius:4px;
}

#chat-input-area{
display:flex;
border-top:1px solid #eee;
}

#chat-input{
flex:1;
border:none;
padding:10px;
outline:none;
}

#chat-send{
width:70px;
border:none;
background:#ff4d4f;
color:white;
cursor:pointer;
}

`;

  document.head.appendChild(style);

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
    if (!conversationId) return;
    const request = ++historyVersion;
    const id = conversationId;
    const res = await Api.user(`${API_URL}/messages/${encodeURIComponent(id)}`);
    const history = Api.list(await res.json());
    if (request !== historyVersion || id !== conversationId) return;
    receive(history); // Merge live events received while the snapshot was in flight.
  }
  async function resync() {
    if (!conversationId || !socket?.connected) return;
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
    if (initialized || !localStorage.getItem("token")) return;
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
    if (!localStorage.getItem("token") || typeof io === "undefined") return;
    socket = io(window.AppConfig.socketUrl, { auth: { token: localStorage.getItem("token") } });
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
      Api.user(`${BASE}/auth/me`).catch(error => state(error.message, error.status !== 401));
    });
    socket.on("newMessage", message => receive([message]));
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

    chatMessages.appendChild(row);

    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  initChat();
})();
