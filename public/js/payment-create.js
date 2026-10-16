(function () {
  async function create(userId, orderId, endpoint = "create") {
    if (typeof userId !== "string" || !userId || typeof orderId !== "string" || !orderId ||
        !["create", "recreate"].includes(endpoint)) throw Api.error(400);
    const storageKey = "paymentCreate:" + userId + ":" + orderId;
    let intent, serialized;
    try {
      const saved = sessionStorage.getItem(storageKey);
      intent = saved === null ? { orderId, idempotencyKey: crypto.randomUUID() } : JSON.parse(saved);
      if (intent?.orderId !== orderId || typeof intent.idempotencyKey !== "string" ||
          !/^[A-Za-z0-9_-]{16,128}$/.test(intent.idempotencyKey)) throw new Error();
      serialized = JSON.stringify(intent);
      // Persist before POST; network/timeout/401/malformed responses keep this exact key.
      sessionStorage.setItem(storageKey, serialized);
    } catch {
      throw Api.error(409, { message: "Không đọc hoặc lưu được yêu cầu thanh toán. Vui lòng kiểm tra đơn hàng trước khi tiếp tục." }, "PAYMENT_STORAGE_ERROR");
    }
    const response = await Api.user(window.AppConfig.apiBase + "/vnpay/" + endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: serialized
    });
    const data = await response.json();
    if (typeof data?.reference !== "string" || !/^[A-Za-z0-9]{1,100}$/.test(data.reference)) throw Api.error(502);
    let destination;
    if (data.paymentUrl === null) {
      // A resolved/expired attempt is still the same attempt. Inspect its server status.
      destination = "/payment-result?reference=" + encodeURIComponent(data.reference);
    } else {
      try {
        const url = new URL(data.paymentUrl);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
        destination = url.href;
      } catch { throw Api.error(502); }
    }
    // Only a known response completes the intent. A later explicit payment action gets a new key.
    if (sessionStorage.getItem(storageKey) === serialized) sessionStorage.removeItem(storageKey);
    return destination;
  }
  window.PaymentCreate = Object.freeze({ create });
})();
