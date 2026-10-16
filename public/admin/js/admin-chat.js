const chatApi = window.AppConfig.apiBase + "/chat";
const socket = io(window.AppConfig.socketUrl, { auth: { token: localStorage.getItem("adminToken") } });
const userList = document.getElementById("userList");
const chatMessages = document.getElementById("chatMessages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const chatHeader = document.getElementById("chatHeader");
const admin = Api.stored("adminUser") || {};
const messages = new Map(), drafts = new Map();
let currentUser = null, selection = 0, historyVersion = 0, usersVersion = 0, joined = null;
const status = document.createElement("p");
status.className = "chat-status";
status.setAttribute("role", "status");
const retry = document.createElement("button");
retry.type = "button";
retry.textContent = "Kết nối / tải lại";
retry.hidden = true;
chatMessages.after(status, retry);
messageInput.setAttribute("aria-label", "Tin nhắn");
function state(message = "", recover = false) { status.textContent = message; retry.hidden = !recover; }

async function loadUsers() {
  const request = ++usersVersion;
  try {
    const res = await Api.admin(chatApi + "/admin/conversations");
    const users = Api.list(await res.json());
    if (request !== usersVersion) return;
    userList.replaceChildren();
    for (const item of users) {
      if (!item.idUser?._id || !item.idConversation?._id) continue;
      const li = document.createElement("li");
      li.dataset.conversationId = item.idConversation._id;
      li.classList.toggle("active", item.idConversation._id === currentUser?.conversationId);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.idUser.name || "Unknown";
      button.setAttribute("aria-pressed", String(item.idConversation._id === currentUser?.conversationId));
      li.appendChild(button);
      li.onclick = () => selectUser({ userId: item.idUser._id, name: button.textContent, conversationId: item.idConversation._id });
      userList.appendChild(li);
    }
    if (!userList.children.length) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "Chưa có hội thoại.";
      userList.appendChild(empty);
    }
  } catch (error) {
    if (request !== usersVersion) return;
    if (error.status === 401) userList.replaceChildren();
    state(error.message, error.status !== 401);
  }
}
function receive(incoming) {
  if (!currentUser) return;
  const ordered = ChatSync.merge(messages, incoming, currentUser.conversationId);
  chatMessages.replaceChildren();
  ordered.forEach(addMessage);
}
async function loadHistory(user = currentUser) {
  if (!user) return;
  const request = ++historyVersion, selected = selection;
  const res = await Api.admin(chatApi + "/messages/" + encodeURIComponent(user.conversationId));
  const history = Api.list(await res.json());
  if (request !== historyVersion || selected !== selection || user.conversationId !== currentUser?.conversationId) return;
  receive(history);
}
async function resync() {
  const user = currentUser, selected = ++selection;
  joined = null;
  if (!user) return;
  try {
    if (socket.connected) {
      await ChatSync.ack(socket, "joinConversation", user.conversationId, "admin");
      if (selected !== selection || !socket.connected) return;
      joined = user.conversationId;
    }
    await loadHistory(user);
    if (selected === selection) state(socket.connected ? "" : "Chat đang mất kết nối.", !socket.connected);
  } catch (error) { if (selected === selection) state(error.message, error.status !== 401); }
}
async function selectUser(user) {
  if (currentUser) drafts.set(currentUser.conversationId, messageInput.value);
  ++selection;
  ++historyVersion;
  currentUser = user;
  userList.querySelectorAll("li").forEach(li => {
    const selected = li.dataset.conversationId === user.conversationId;
    li.classList.toggle("active", selected);
    li.querySelector("button")?.setAttribute("aria-pressed", String(selected));
  });
  messages.clear();
  chatMessages.replaceChildren();
  messageInput.value = drafts.get(user.conversationId) || "";
  chatHeader.textContent = "Chat với: " + user.name;
  state("Đang tải hội thoại...");
  await resync();
}
function addMessage(msg) {
  const senderId = msg?.idUser?._id || msg?.idUser;
  const row = document.createElement("div");
  row.className = senderId === (admin.id || admin._id) ? "message admin" : "message user";
  const name = document.createElement("div");
  name.className = "message-name";
  name.textContent = senderId === (admin.id || admin._id) ? "ADMIN" : msg.idUser?.name || "Khách";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = msg.content;
  row.append(name, bubble);
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
function sendMessage() {
  const user = currentUser, draft = messageInput.value, content = draft.trim();
  if (!user || !content) return;
  if (!socket.connected || joined !== user.conversationId) return state("Chat chưa sẵn sàng. Vui lòng kết nối lại.", true);
  drafts.set(user.conversationId, draft);
  return Api.action("admin-chat-send", sendBtn, async () => {
    const payload = ChatSync.intent("admin", user.conversationId, content);
    const ack = await ChatSync.ack(socket, "sendMessage", payload, "admin");
    if (!ack.messageId) throw Api.error(502);
    ChatSync.confirmed(payload);
    if (drafts.get(user.conversationId) === draft) drafts.delete(user.conversationId);
    if (currentUser?.conversationId !== user.conversationId) return;
    if (messageInput.value === draft) messageInput.value = "";
    state();
    await loadHistory(user);
  }, error => {
    if (currentUser?.conversationId !== user.conversationId) return;
    state(error.message, error.status !== 401);
    if (error.code === "CHAT_ACK_TIMEOUT") loadHistory(user).catch(() => {});
  });
}
async function recoverConnection() {
  try {
    const res = await Api.admin(window.AppConfig.apiBase + "/auth/me");
    if ((await res.json()).role !== "ADMIN") { Api.expire("admin", localStorage.getItem("adminToken")); return; }
    await loadUsers();
    if (!socket.connected) {
      socket.auth = { token: localStorage.getItem("adminToken") };
      socket.connect();
    } else await resync();
  } catch (error) { state(error.message, error.status !== 401); }
}
retry.onclick = () => Api.action("admin-chat-recover", retry, recoverConnection);
sendBtn.onclick = sendMessage;
messageInput.addEventListener("input", () => { if (currentUser) drafts.set(currentUser.conversationId, messageInput.value); });
messageInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); sendMessage(); } });
socket.io?.on("reconnect_attempt", () => { socket.auth = { token: localStorage.getItem("adminToken") }; });
socket.on("connect", () => { loadUsers(); resync(); });
socket.on("disconnect", reason => {
  ++selection; ++historyVersion; joined = null;
  state("Chat đang mất kết nối. Bản nháp được giữ lại.", true);
  if (reason === "io server disconnect") recoverConnection();
});
socket.on("connect_error", () => {
  joined = null;
  state("Không kết nối được chat.", true);
  Api.admin(window.AppConfig.apiBase + "/auth/me")
    .catch(error => state(error.message, error.status !== 401));
});
socket.on("newMessage", message => receive([message]));
window.addEventListener("session-expired", event => {
  if (event.detail.scope !== "admin") return;
  ++selection; ++historyVersion; ++usersVersion;
  joined = null;
  socket.disconnect();
  messages.clear();
  chatMessages.replaceChildren();
  userList.replaceChildren();
  state("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
});
loadUsers();
