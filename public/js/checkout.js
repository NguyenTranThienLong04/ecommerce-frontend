const BASE = window.AppConfig.apiBase;

const API_URL =BASE;

let addressList = [];
let checkoutCart = null;
let checkoutEstimate = null;
let checkoutPending = null;
let checkoutStorageKey = null;
let checkoutBusy = false;
let checkoutFinished = false;
let checkoutStateInvalid = false;
let paymentMethods = ["COD"];
const shippingFields = ["receiverName", "phone", "addressLine", "ward", "district", "city"];


/* ===============================
   VALIDATE
================================ */

function validateCheckout(data) {
  const errors = {};

  // trim
  for (let key in data) {
    if (typeof data[key] === "string") {
      data[key] = data[key].trim();
    }
  }

  if (!data.receiverName) {
    errors.receiverName = "Tên người nhận không được để trống";
  }

  if (!data.phone) {
    errors.phone = "SĐT không được để trống";
  } else {
    const phoneRegex = /^(0|\+84)[3-9][0-9]{8}$/;
    if (!phoneRegex.test(data.phone)) {
      errors.phone = "SĐT không hợp lệ";
    }
  }

  if (!data.addressLine) {
    errors.addressLine = "Địa chỉ không được để trống";
  }

  if (!data.ward) {
    errors.ward = "Phường/Xã không được để trống";
  }

  if (!data.district) {
    errors.district = "Quận/Huyện không được để trống";
  }

  if (!data.city) {
    errors.city = "Tỉnh/Thành phố không được để trống";
  }

  return errors;
}

function showErrors(errors) {
  document.querySelectorAll(".error-text").forEach(e => {
    const input = e.parentElement.querySelector("input");
    input?.removeAttribute("aria-invalid");
    input?.removeAttribute("aria-describedby");
    e.remove();
  });

  for (let key in errors) {
    const input = document.getElementById(key);
    if (!input) continue;

    const error = document.createElement("p");
    error.className = "error-text";
    error.id = input.id + "-error";
    error.setAttribute("role", "alert");
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", error.id);
    error.innerText = errors[key];

    input.parentNode.appendChild(error);
  }
  document.querySelector('[aria-invalid="true"]')?.focus();
}

// clear lỗi realtime
document.querySelectorAll("input").forEach(input => {
  input.addEventListener("input", () => {
    const err = input.parentNode.querySelector(".error-text");
    if (err) err.remove();
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  });
});


/* ===============================
   LOAD CART
================================ */

async function loadCheckoutCart(){

const token = localStorage.getItem("token");

if(!token){
alert("Bạn cần đăng nhập");
window.location.href="/login";
return;
}

const res = await Api.user(`${API_URL}/cart`,{
headers:{Authorization:"Bearer "+token}
});

if (!res.ok) throw new Error("Không tải được giỏ hàng");
const data = await res.json();
const items = data.items || [];
checkoutCart = data.cart;
checkoutEstimate = data.checkout;
paymentMethods = Array.isArray(data.paymentMethods) ? data.paymentMethods.filter(method => ["COD", "VNPAY"].includes(method)) : ["COD"];
document.querySelectorAll('input[name="payment"]').forEach(input => {
  input.closest("label").hidden = !paymentMethods.includes(input.value);
});
if (!paymentMethods.includes(getSelectedPayment())) document.querySelector('input[value="COD"]').checked = true;
checkoutStorageKey = "checkoutAttempt:" + checkoutCart.idUser;
checkoutStateInvalid = false;
try {
  const saved = sessionStorage.getItem(checkoutStorageKey);
  checkoutPending = saved === null ? null : JSON.parse(saved);
  if (saved !== null && (!checkoutPending?.payload ||
      ["idempotencyKey", "cartId", "cartSnapshot", "shippingMethod"].some(key => typeof checkoutPending.payload[key] !== "string" || !checkoutPending.payload[key]))) {
    throw new Error("Invalid saved attempt");
  }
} catch {
  checkoutPending = null;
  // Do not discard an unresolved key and silently create another order.
  checkoutStateInvalid = true;
}

const container = document.getElementById("orderItems");
container.innerHTML="";

for(const item of items){

const variant = item.idProductVariant || {};
let product = typeof variant.idProduct === "object" ? variant.idProduct : null;
if (!product && variant.idProduct) {
  try {
    const response = await Api.fetch(`${API_URL}/products/${variant.idProduct}`);
    if (response.ok) product = (await response.json()).product;
  } catch { /* Keep the stale row visible. */ }
}
const available = !!product && item.availability?.available !== false;
product ||= {};

const quantity = item.quantity || 0;
const line = checkoutEstimate?.lines?.find(line => line.itemId === item._id);
const itemTotal = line?.lineTotal;

container.innerHTML += SafeHTML.html`
<div class="order-item" data-item-id="${item._id}">

<div class="order-product">

<img
src="${SafeHTML.url(product.images?.[0], "/assets/images/product-placeholder.svg")}"
class="checkout-product-image" alt=""
>

<div class="order-info">
<p class="order-name">${product.nameProduct || "Sản phẩm không còn thông tin"}</p>
${!available ? SafeHTML.html`<p class="cart-unavailable">${item.availability?.message || "Sản phẩm không còn khả dụng"}</p><a href="/cart">Về giỏ hàng để xóa dòng này</a>` : ""}
<p>Size: ${variant.size}</p>
<p>Color: ${variant.color}</p>
<p>Số lượng: ${quantity}</p>
</div>

</div>

<div class="order-price">
${itemTotal == null ? "—" : itemTotal.toLocaleString("vi-VN") + " đ"}
</div>

</div>
`;
}

displayTotals(checkoutEstimate);
if (checkoutStateInvalid) {
  checkoutMessage("Không đọc được lần đặt hàng đã lưu. Vui lòng kiểm tra mục Đơn hàng trong tài khoản hoặc liên hệ hỗ trợ trước khi đặt thêm.");
} else if (!checkoutEstimate?.snapshot && !checkoutPending) {
  checkoutMessage(checkoutEstimate?.message || "Giỏ hàng chưa sẵn sàng");
}
updateCheckoutButton();

}


/* ===============================
   LOAD USER EMAIL
================================ */

async function loadUserInfo(){

const token = localStorage.getItem("token");

const res = await Api.user(`${API_URL}/auth/me`,{
headers:{Authorization:"Bearer "+token}
});

const user = await res.json();

if(user.email){
document.getElementById("email").value=user.email;
}

}


/* ===============================
   LOAD ADDRESS BOOK
================================ */

async function loadAddressBook(){

const token = localStorage.getItem("token");

const res = await Api.user(`${API_URL}/addresses`,{
headers:{Authorization:"Bearer "+token}
});

const addresses = Api.list(await res.json());

addressList = addresses;

const select = document.getElementById("addressBook");

select.innerHTML=`<option value="">Địa chỉ khác...</option>`;

addresses.forEach(addr=>{

const option=document.createElement("option");

option.value=addr._id;

option.textContent=
addr.receiverName+" - "+addr.addressLine;

select.appendChild(option);

if(addr.isDefault){
fillAddress(addr);
select.value=addr._id;
}

});

}


function fillAddress(addr){

document.getElementById("receiverName").value=addr.receiverName||"";
document.getElementById("phone").value=addr.phone||"";
document.getElementById("addressLine").value=addr.addressLine||"";
document.getElementById("city").value=addr.city||"";
document.getElementById("district").value=addr.district||"";
document.getElementById("ward").value=addr.ward||"";

}


document.addEventListener("change",function(e){

if(e.target.id==="addressBook"){

const id=e.target.value;

const addr=addressList.find(a=>a._id===id);

if(addr) fillAddress(addr);

}

});
// Editing a saved address means using the existing free-form address flow.
shippingFields.forEach(field => document.getElementById(field).addEventListener("input", () => {
  document.getElementById("addressBook").value = "";
}));
//
function getSelectedPayment(){
  const checked = document.querySelector('input[name="payment"]:checked');
  return checked ? checked.value : "COD";
}

function checkoutMessage(message) {
  document.getElementById("checkoutMessage").textContent = message;
}

function displayTotals(quote) {
  for (const [id, field] of [["subTotal", "subtotal"], ["shippingFee", "shippingFee"], ["orderTotal", "total"]]) {
    document.getElementById(id).textContent = quote?.[field] == null ? "—" : quote[field].toLocaleString("vi-VN") + " đ";
  }
}

function updateCheckoutButton() {
  const button = document.getElementById("checkoutBtn");
  button.disabled = checkoutBusy || checkoutFinished || checkoutStateInvalid || (!checkoutPending && !checkoutEstimate?.snapshot);
  button.textContent = checkoutPending ? "Thử lại đặt hàng" : "Đặt hàng";
  const locked = !!checkoutPending || checkoutFinished;
  shippingFields.forEach(field => { document.getElementById(field).readOnly = locked; });
  document.getElementById("addressBook").disabled = locked;
  document.querySelectorAll('input[name="payment"]').forEach(input => { input.disabled = locked || !paymentMethods.includes(input.value); });
}

function saveAttempt(attempt) {
  if (attempt) sessionStorage.setItem(checkoutStorageKey, JSON.stringify(attempt));
  else sessionStorage.removeItem(checkoutStorageKey);
  checkoutPending = attempt;
}

function restoreAttempt() {
  if (!checkoutPending) return;
  const payload = checkoutPending.payload;
  shippingFields.forEach(field => { document.getElementById(field).value = payload[field] || ""; });
  document.getElementById("addressBook").value = payload.addressId || "";
  document.querySelectorAll('input[name="payment"]').forEach(input => {
    input.checked = input.value === payload.shippingMethod;
  });
  checkoutMessage("Lần đặt hàng trước chưa được xác nhận. Bấm thử lại để kiểm tra kết quả; giỏ hàng hiện tại sẽ không bị đặt thêm.");
  updateCheckoutButton();
}

async function handleCheckout() {
  if (checkoutBusy || checkoutFinished || checkoutStateInvalid) return;
  checkoutBusy = true;
  updateCheckoutButton();
  try {
    await checkoutReady;
    if (checkoutStateInvalid || !checkoutCart || (!checkoutPending && !checkoutEstimate?.snapshot)) return;
    if (!checkoutPending) {
      if (!paymentMethods.includes(getSelectedPayment())) throw Api.error(409,
        { message: "Phương thức thanh toán này hiện không khả dụng. Vui lòng chọn COD." });
      const address = Object.fromEntries(shippingFields.map(field => [field, document.getElementById(field).value]));
      const errors = validateCheckout(address);
      if (Object.keys(errors).length) { showErrors(errors); return; }
      const addressId = document.getElementById("addressBook").value;
      // Persist the immutable intent BEFORE sending. Timeout/reload retries keep this key and snapshot.
      saveAttempt({ payload: {
        ...address, ...(addressId ? { addressId } : {}), shippingMethod: getSelectedPayment(),
        cartId: checkoutCart._id, cartSnapshot: checkoutEstimate.snapshot, idempotencyKey: crypto.randomUUID()
      } });
    }
    updateCheckoutButton();
    checkoutMessage("Đang xác nhận đơn hàng...");
    const token = localStorage.getItem("token");
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
    const res = await Api.user(`${API_URL}/orders`, {
      method: "POST", headers, body: JSON.stringify(checkoutPending.payload), allowHttpErrors: true
    });
    const result = await res.json();
    if (!res.ok) {
      // A definitive rejection permits a new attempt; ambiguous outcomes keep the original key.
      if (res.status < 500 && result.code !== "CHECKOUT_RETRY") {
        saveAttempt(null);
        await loadCheckoutCart();
      }
      checkoutMessage(result.message || "Chưa xác nhận được đơn hàng. Vui lòng thử lại.");
      return;
    }
    const order = result.order;
    if (!order?._id) throw new Error("Missing order confirmation");
    displayTotals(order);
    if (order.status === "CANCEL") {
      saveAttempt(null);
      await loadCheckoutCart();
      checkoutMessage("Đơn hàng trước đã bị hủy. Vui lòng kiểm tra giỏ hàng trước khi đặt lại.");
      return;
    }
    let destination = "/";
    if (order.shippingMethod === "VNPAY" && order.paymentStatus !== "PAID") {
      // A payment-link failure retries checkout with the SAME key, then uses that same order ID.
      destination = await PaymentCreate.create(checkoutCart.idUser, order._id);
    } else if (order.paymentStatus === "PAID") {
      destination = "/account";
    }
    checkoutFinished = true;
    saveAttempt(null);
    checkoutMessage("Đặt hàng thành công!");
    window.location.href = destination;
  } catch (error) {
    checkoutMessage(error.status === 401 ? error.message : "Chưa xác nhận được kết quả. Bấm thử lại để kiểm tra lần đặt hàng này.");
  } finally {
    checkoutBusy = false;
    updateCheckoutButton();
  }
}

document.getElementById("orderItems").addEventListener("error", event => {
  if (event.target.matches("img.checkout-product-image") && !event.target.src.endsWith("/assets/images/product-placeholder.svg")) event.target.src = "/assets/images/product-placeholder.svg";
}, true);
const checkoutReady = Promise.all([loadCheckoutCart(), loadUserInfo(), loadAddressBook()])
  .then(restoreAttempt)
  .catch(error => {
    checkoutMessage(error.message || "Không tải được thông tin thanh toán. Vui lòng tải lại trang.");
    Api.report(error, async () => {
      await Promise.all([loadCheckoutCart(), loadUserInfo(), loadAddressBook()]);
      restoreAttempt();
    });
  });
