(function () {
  const pending = new Map();
  function intent(scope, conversationId, content, type = "TEXT") {
    const user = Api.stored(scope === "admin" ? "adminUser" : "user");
    const key = [scope, user?.id || user?._id || "", conversationId].join(":");
    const previous = pending.get(key);
    if (previous?.content === content && previous.type === type) return previous;
    const payload = { conversationId, content, type, clientMessageId: crypto.randomUUID() };
    pending.set(key, payload);
    return payload;
  }
  function confirmed(payload) {
    for (const [key, value] of pending) if (value.clientMessageId === payload.clientMessageId) pending.delete(key);
  }
  function ack(socket, event, payload, scope, timeout = 8000) {
    if (!socket?.connected) return Promise.reject(Api.error(0, { message: "Chat đang mất kết nối. Vui lòng kết nối lại." }));
    const token = localStorage.getItem(scope === "admin" ? "adminToken" : "token");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Api.error(0, {
        message: "Chưa xác nhận được kết quả. Hãy kiểm tra lịch sử trước khi gửi lại."
      }, "CHAT_ACK_TIMEOUT")), timeout);
      socket.emit(event, payload, result => {
        clearTimeout(timer);
        if (localStorage.getItem(scope === "admin" ? "adminToken" : "token") !== token) return reject(Api.error(401));
        if (result?.status === 401) Api.expire(scope, token);
        if (!result?.ok) return reject(Api.error(result?.status || 500, result));
        resolve(result);
      });
    });
  }
  function merge(messages, incoming, conversationId) {
    for (const message of incoming) {
      const conversation = message?.idConversation?._id || message?.idConversation;
      if (typeof message?._id !== "string" || String(conversation) !== String(conversationId)) continue;
      messages.set(message._id, message);
    }
    return [...messages.values()].sort((a, b) =>
      (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a._id.localeCompare(b._id));
  }
  window.ChatSync = Object.freeze({ ack, merge, intent, confirmed });
})();
