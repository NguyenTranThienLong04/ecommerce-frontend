(function () {
  const BASE = "https://ecommerce-backend-w960.onrender.com/api";
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

<div id="chat-button" type="button" aria-label="Mở chat">💬</div>

<div id="chat-box">

<div id="chat-header">
Chat với shop
<span id="chat-close">✖</span>
</div>

<div id="chat-messages"></div>

<div id="chat-input-area">
<input id="chat-input" placeholder="Nhập tin nhắn..."/>
<button id="chat-send" type="button">Gửi</button>
</div>

</div>

</div>
`;

  document.body.insertAdjacentHTML("beforeend", chatHTML);

  const style = document.createElement("style");
  style.innerHTML = `

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
  };

  chatClose.onclick = () => {
    chatBox.style.display = "none";
  };

  // ================= Socket (sau UI — không chặn hiển thị nút) =================

  function connectSocket() {
    if (typeof io === "undefined") {
      console.warn("chat-widget: Socket.io client chưa load (kiểm tra script socket.io trước chat-widget.js).");
      return;
    }
    try {
      socket = io("https://ecommerce-backend-w960.onrender.com");
      socket.on("newMessage", function (msg) {
        renderMessage(msg);
      });
    } catch (err) {
      console.warn("chat-widget: không khởi tạo socket:", err);
    }
  }

  connectSocket();

  async function initChat() {
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/conversation`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
        },
      });

      const data = await res.json();

      if (!data || !data._id) {
        console.log("Conversation không tạo được");
        return;
      }

      conversationId = data._id;

      if (socket) {
        socket.emit("joinConversation", conversationId);
      }

      loadMessages();
    } catch (err) {
      console.log("Init chat error:", err);
    }
  }

  async function loadMessages() {
    if (!conversationId) return;

    try {
      const res = await fetch(`${API_URL}/messages/${conversationId}`, {
        headers: {
          Authorization: "Bearer " + token,
        },
      });

      const messages = await res.json();

      if (!Array.isArray(messages)) return;

      chatMessages.innerHTML = "";

      messages.forEach(renderMessage);
    } catch (err) {
      console.log("Load messages error:", err);
    }
  }

  chatSend.onclick = sendMessage;

  chatInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") sendMessage();
  });

  function sendMessage() {
    const content = chatInput.value.trim();

    if (!content) return;

    if (!conversationId) {
      console.log("conversation chưa tạo");
      return;
    }

    if (!socket) {
      console.log("Socket chưa kết nối");
      return;
    }

    socket.emit("sendMessage", {
      conversationId: conversationId,
      userId: userId,
      content: content,
      type: "TEXT",
    });

    chatInput.value = "";
  }

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
