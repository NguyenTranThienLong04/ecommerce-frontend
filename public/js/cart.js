
const BASE = window.AppConfig.apiBase;
const API_URL = BASE;
let cartHasUnavailable = false;
let cartRequest = 0;

async function loadCart() {
  const request = ++cartRequest;
  try {
    const token = localStorage.getItem("token");

    if (!token) {
      document.querySelector(".cart-items").innerHTML =
        "<p>Bạn cần đăng nhập</p>";
      return;
    }

    const res = await Api.user(`${API_URL}/cart`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) throw new Error("Lỗi load cart");

    const data = await res.json();
    if (request !== cartRequest) return;

    const items =
      data.items ||
      data.cart?.items ||
      data.data?.items ||
      [];

    if (items.length === 0) {
      cartHasUnavailable = false;
      document.querySelector(".cart-items").innerHTML =
        "<p>Giỏ hàng trống</p>";
      document.getElementById("cartTotal").innerText = "0 đ";
      return;
    }

    await renderCart(Api.list(items), request);

  } catch (err) {
    if (request !== cartRequest) return;
    if (err.status === 401) document.querySelector(".cart-items").textContent = "Bạn cần đăng nhập";
    Api.report(err, loadCart);
  }
}

async function renderCart(items, request = cartRequest) {
  const container = document.querySelector(".cart-items");
  const rows = [];

  let totalMoney = 0;
  let hasUnavailable = false;

  for (const item of items) {

    const variant = item.idProductVariant || {};
    let product = typeof variant.idProduct === "object" ? variant.idProduct : null;
    // Compatibility with older API responses; even a failed lookup keeps the removable row.
    if (!product && variant.idProduct) {
      try {
        const response = await Api.fetch(`${API_URL}/products/${variant.idProduct}`);
        if (response.ok) product = (await response.json()).product;
      } catch { /* The unavailable row below still renders. */ }
    }
    const available = !!product && item.availability?.available !== false;
    const reason = item.availability?.message || "Sản phẩm không còn khả dụng. Vui lòng xóa khỏi giỏ.";
    product ||= {};
    hasUnavailable ||= !available;

    const price = variant.price || 0;
    const quantity = item.quantity || 0;
    const total = price * quantity;

    if (available) totalMoney += total;

    rows.push(SafeHTML.html`
      <div class="cart-row" data-item-id="${item._id}">

        <div class="cart-product">
        <a href="${SafeHTML.productPath(product.slug)}">
          <img 
            src="${SafeHTML.url(product.images?.[0])}"
            width="80"
            class="cart-product-image"
          >
          <div>
            <h4>${product.nameProduct || 'Sản phẩm không còn thông tin'}</h4></a>
            ${!available ? SafeHTML.html`<p class="cart-unavailable" role="status">${reason}</p>` : ""}
            <p>Size: ${variant.size || ''}</p>
            <p>Color: ${variant.color || ''}</p>
            <span>${price.toLocaleString("vi-VN")} đ</span>
          </div>
        </div>

        <div class="cart-quantity">
          <button data-action="quantity" data-id="${item._id}" data-quantity="${quantity - 1}" ${!available ? SafeHTML.html`disabled` : ""}>-</button>
          <span>${quantity}</span>
          <button data-action="quantity" data-id="${item._id}" data-quantity="${quantity + 1}" ${!available ? SafeHTML.html`disabled` : ""}>+</button>
        </div>

        <div class="cart-total">
          ${available ? total.toLocaleString("vi-VN") + " đ" : "—"}
        </div>

        <div class="cart-remove">
          <button data-action="remove" data-id="${item._id}">X</button>
        </div>

      </div>
    `);
  }
  if (request !== cartRequest) return;
  container.innerHTML = rows.join("");
  cartHasUnavailable = hasUnavailable;
  document.getElementById("cartTotal").innerText =
    totalMoney.toLocaleString("vi-VN") + " đ";
}

/* ===== UPDATE QUANTITY ===== */
async function changeQuantity(idItem, quantity, button) {

  if (quantity < 1) return;

  return Api.action("cart:" + idItem, button, async () => {
  const token = localStorage.getItem("token");
  await Api.user(`${API_URL}/cart/update`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({
      idItem,
      quantity
    })
  });

  await loadCart();
  });
}

/* ===== REMOVE ITEM ===== */
async function removeItem(idItem, button) {
  return Api.action("cart:" + idItem, button, async () => {

  const token = localStorage.getItem("token");

  await Api.user(`${API_URL}/cart/remove/${idItem}`, {
    method: "DELETE",
    headers: {
      Authorization: "Bearer " + token
    }
  });

  await loadCart();
  });
}

function goCheckout() {
  if (cartHasUnavailable) return alert("Vui lòng xóa các dòng không còn khả dụng trước khi thanh toán.");
  const token = localStorage.getItem("token");

  if (!token) {
    alert("Bạn cần đăng nhập");
    return;
  }

  window.location.href = "/checkout";
}

document.querySelector(".cart-items")?.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "quantity") changeQuantity(button.dataset.id, Number(button.dataset.quantity), button);
  if (button.dataset.action === "remove") removeItem(button.dataset.id, button);
});
document.querySelector(".cart-items")?.addEventListener("error", event => {
  if (event.target.matches("img.cart-product-image") && !event.target.src.endsWith("/default.png")) event.target.src = "/default.png";
}, true);

/* LOAD CART */
if (document.querySelector(".cart-items")) {
  loadCart();
}
