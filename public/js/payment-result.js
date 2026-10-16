(() => {
  const api = window.AppConfig.apiBase;
  const reference = new URLSearchParams(window.location.search).get("reference");
  const title = document.getElementById("payment-title");
  const message = document.getElementById("payment-message");
  const refresh = document.getElementById("payment-refresh");
  const states = {
    PAID: ["Đã thanh toán", "Hệ thống đã xác nhận thanh toán cho đơn hàng."],
    PROCESSING: ["Đang chờ xác nhận", "Chưa nhận được xác nhận thanh toán. Nếu bạn đã trả tiền, vui lòng chờ và không thanh toán thêm."],
    FAILED: ["Thanh toán không thành công", "Đơn vị thanh toán đã xác nhận lần thanh toán này không thành công. Bạn có thể kiểm tra đơn hàng để thử lại."],
    CANCELLED: ["Đơn hàng đã hủy", "Đơn đã hủy. Kết quả thanh toán có thể vẫn đang chờ xác nhận; nếu đã trả tiền, vui lòng liên hệ hỗ trợ."],
    EXPIRED: ["Liên kết thanh toán đã hết hạn", "Hết hạn liên kết không có nghĩa thanh toán thất bại. Nếu đã trả tiền, vui lòng chờ xác nhận hoặc liên hệ hỗ trợ."],
    REQUIRES_REVIEW: ["Thanh toán cần kiểm tra", "Hệ thống đã ghi nhận thông tin cần đối soát. Vui lòng liên hệ hỗ trợ và không thanh toán thêm."]
  };
  let busy = false, timer, polls = 0, active = true, version = 0, controller;
  async function check() {
    if (busy || !active) return;
    clearTimeout(timer);
    if (!reference || !/^[a-zA-Z0-9]{1,100}$/.test(reference)) {
      title.textContent = "Chưa xác định được thanh toán";
      message.textContent = "Vui lòng kiểm tra trạng thái trong mục đơn hàng.";
      refresh.disabled = true;
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) {
      title.textContent = "Đăng nhập để kiểm tra";
      message.textContent = "Đăng nhập bằng tài khoản đã đặt đơn để xem kết quả thanh toán.";
      document.getElementById("payment-login").hidden = false;
      return;
    }
    busy = true;
    refresh.disabled = true;
    const request = ++version;
    controller = new AbortController();
    try {
      const res = await Api.user(`${api}/vnpay/status/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal
      });
      if (!res.ok) throw new Error("Status unavailable");
      const data = await res.json();
      if (request !== version || !active) return;
      const display = states[data?.state];
      if (!display || typeof data.orderId !== "string" || !data.orderId) throw new Error("Unknown status");
      document.getElementById("payment-login").hidden = true;
      title.textContent = display[0];
      message.textContent = display[1];
      document.getElementById("payment-order").textContent = "Mã đơn hàng: " + data.orderId;
      // Poll briefly; absence of IPN is never converted into failure.
      if (["PROCESSING", "EXPIRED", "CANCELLED"].includes(data.state) && polls++ < 15) {
        timer = setTimeout(check, 2000);
      }
    } catch (error) {
      if (request !== version || !active) return;
      if (error.status === 401) {
        title.textContent = "Đăng nhập để kiểm tra";
        message.textContent = error.message;
        document.getElementById("payment-login").hidden = false;
        return;
      }
      title.textContent = "Chưa kiểm tra được kết quả";
      message.textContent = "Vui lòng thử kiểm tra lại. Lỗi kết nối không có nghĩa thanh toán thất bại.";
    } finally {
      if (request === version) {
        busy = false;
        refresh.disabled = false;
      }
    }
  }
  refresh.addEventListener("click", () => { polls = 0; check(); });
  window.addEventListener("pagehide", () => {
    active = false;
    version++;
    clearTimeout(timer);
    controller?.abort();
    busy = false;
    refresh.disabled = false;
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    active = true;
    polls = 0;
    check();
  });
  check();
})();
