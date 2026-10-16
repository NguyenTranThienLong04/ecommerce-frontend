document.addEventListener("DOMContentLoaded", function () {

  const BASE = window.AppConfig.apiBase;
const API_URL = BASE;
  const list = document.getElementById("order-list");

  if (!list) return;
  let orderRequest = 0;
  const orderOwners = new Map();

  // ==========================
  // LOAD ORDERS
  // ==========================
  async function loadOrders() {
    const request = ++orderRequest;
    try {

    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await Api.user(`${API_URL}/orders/my`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const orders = Api.list(await res.json());
    if (request !== orderRequest) return;

    if (!orders.length) {
      list.innerHTML = `
        <tr><td colspan="5">Không có đơn hàng</td></tr>
      `;
      return;
    }

    list.innerHTML = "";

    orders.forEach(order => {
      orderOwners.set(order._id, order.idUser);

      const date = new Date(order.createdAt)
        .toLocaleDateString("vi-VN");

      list.innerHTML += SafeHTML.html`
        <tr>
          <td>#${order._id.slice(-6)}</td>
          <td>${date}</td>
          <td>${order.total.toLocaleString()}₫</td>
          <td>
            <span class="order-status ${order.status}">
              ${order.status}
            </span>
             <br>
  <span class="payment-status" data-paid="${order.paymentStatus === 'PAID'}">
    ${order.paymentStatus === 'PAID' ? 'Đã thanh toán' : 'Chưa thanh toán'}
  </span>
          </td>

          <td>
            <button class="btn-outline view-order" data-id="${order._id}">
              Xem chi tiết
            </button>
  
              ${order.status === "PENDING" && order.paymentStatus !== "PAID" &&order.shippingMethod==="VNPAY"
    ? SafeHTML.html`<button class="btn-pay-again" data-id="${order._id}">Hoàn tất thanh toán VNPAY</button>`
    : ""} 

            ${
              order.canCancel === true
                ? SafeHTML.html`<button class="btn-cancel cancel-order" data-id="${order._id}">
                    Hủy
                   </button>`
                : ""
            }
          </td>
        </tr>

        <tr class="order-detail" id="detail-${order._id}" style="display:none">
          <td colspan="5">

            <div class="order-products">

              ${(order.items || []).map(item => {

                const variant = item.idProductVariant || {};
                const product = variant.idProduct || {};
                const snapshot = item.productSnapshot;

                const img = (snapshot ? snapshot.image : product.images?.[0]) || "/assets/images/product-placeholder.svg";

                return SafeHTML.html`
                  <div class="order-item">
                    <img src="${SafeHTML.url(img)}" alt="" loading="lazy">

                    <div class="order-item-info">
                      <div class="name">${(snapshot ? snapshot.nameProduct : product.nameProduct) || "Sản phẩm không còn thông tin"}</div>
                      <div class="variant">
                        Size ${(snapshot ? snapshot.size : variant.size) || "—"} | Màu ${(snapshot ? snapshot.color : variant.color) || "—"}
                      </div>
                    </div>

                    <div class="qty">x${item.quantity}</div>

                    <div class="order-price">
                      ${item.price == null ? "—" : item.price.toLocaleString()}₫
                    </div>
                  </div>
                `;
              })}

            </div>

          </td>
        </tr>
      `;
    });
    } catch (error) {
      if (request !== orderRequest) return;
      if (error.status === 401) list.replaceChildren();
      Api.report(error, loadOrders);
    }
  }

  loadOrders();

  // ==========================
  // EVENT DELEGATION (🔥 CHUẨN)
  // ==========================
  document.addEventListener("click", async (e) => {

    const token = localStorage.getItem("token");

    // 👁️ TOGGLE DETAIL
    const viewBtn = e.target.closest(".view-order");

    if (viewBtn) {
      const id = viewBtn.dataset.id;
      const detail = document.getElementById("detail-" + id);

      detail.style.display =
        detail.style.display === "none"
          ? "table-row"
          : "none";
    }

    // Thanh toan vnpay
    // 🔹 PAY AGAIN VNPay
const payAgainBtn = e.target.closest(".btn-pay-again");

if (payAgainBtn) {
  const orderId = payAgainBtn.dataset.id;

  if (!token) {
    return alert("Bạn cần đăng nhập");
  }

  return Api.action("order:" + orderId, payAgainBtn, async () => {
    const userId = orderOwners.get(orderId) || Api.stored("user")?.id;
    window.location.href = await PaymentCreate.create(userId, orderId, "recreate");

  });
}
    // ❌ CANCEL ORDER
    const cancelBtn = e.target.closest(".cancel-order");

    if (cancelBtn) {
      const id = cancelBtn.dataset.id;

      if (!confirm("Bạn có chắc muốn hủy đơn này?")) return;
      return Api.action("order:" + id, cancelBtn, async () => {
      const res = await Api.user(`${API_URL}/orders/${id}/cancel`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.message);
        return;
      }

      alert("Hủy thành công");

      await loadOrders();
      });
    }

  });

});
