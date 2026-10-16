const BASE = window.AppConfig.apiBase;
const API_URL = BASE;

let allOrders = [];
let currentPage = 1;
const perPage = 5;
let ordersRequest = 0;

async function loadOrders(){
const request = ++ordersRequest;
try {

const token = localStorage.getItem("adminToken");

const res = await Api.admin(`${API_URL}/orders`,{
headers:{
Authorization:`Bearer ${token}`
}
});

const data = Api.list(await res.json());
if (request !== ordersRequest) return;
allOrders = data;

renderStats();

renderOrders();
} catch (error) { if (request === ordersRequest) Api.report(error, loadOrders); }
}

function renderStats(){

document.getElementById("totalOrders").innerText = allOrders.length;

document.getElementById("pendingOrders").innerText =
allOrders.filter(o=>o.status==="PENDING").length;

document.getElementById("shippingOrders").innerText =
allOrders.filter(o=>o.status==="SHIPPING").length;

document.getElementById("doneOrders").innerText =
allOrders.filter(o=>o.status==="DONE").length;

}

function renderOrders(navigate = false){

const list = document.getElementById("order-list");

let orders = filterOrders();
currentPage = Math.min(currentPage, Math.max(1, Math.ceil(orders.length / perPage)));
if (navigate) updateOrdersURL();

const start = (currentPage-1)*perPage;
const paginated = orders.slice(start,start+perPage);

list.innerHTML="";

paginated.forEach(order=>{

const date=new Date(order.createdAt)
.toLocaleDateString("vi-VN");

const items=order.items || [];

const itemsHtml = items.map(item=>{

const product=item.idProductVariant?.idProduct || {};
const variant=item.idProductVariant || {};
const snapshot=item.productSnapshot;

const img=(snapshot ? snapshot.image : product.images?.[0]) || "/assets/images/product-placeholder.svg";

return SafeHTML.html`

<div class="order-item">

<img src="${SafeHTML.url(img)}" alt="" loading="lazy">

<div class="order-item-info">
<div><b>${(snapshot ? snapshot.nameProduct : product.nameProduct) || "Sản phẩm không còn thông tin"}</b></div>
<div>Size ${(snapshot ? snapshot.size : variant.size) || "—"} | ${(snapshot ? snapshot.color : variant.color) || "—"}</div>
</div>

<div>x${item.quantity}</div>

<div>${item.price == null ? "—" : item.price.toLocaleString()}₫</div>

</div>

`;

});

list.innerHTML+=SafeHTML.html`

<tr>

<td>#${order._id.slice(-6)}</td>

<td>
<b>${order.idUser?.name}</b><br>
${order.idUser?.email}
</td>

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
${order.shippingMethod || "COD"} 
</td>
<td>

<select class="status-select" data-id="${order._id}">
${[order.status, ...(order.allowedTransitions || [])].map(status =>
  SafeHTML.html`<option value="${status}">${status}</option>`)}
</select>

<button class="view-order" data-id="${order._id}">
Chi tiết
</button>

</td>

</tr>

<tr class="order-detail" id="detail-${order._id}" style="display:none">

<td colspan="7">

<div class="order-products">

<div class="customer-box">

<div><b>Receiver:</b> ${order.receiverName}</div>
<div><b>Phone:</b> ${order.phone}</div>
<div><b>Address:</b> ${order.addressLine}, ${order.district}, ${order.city}</div>

</div>

${itemsHtml}

</div>

</td>

</tr>

`;

});

renderPagination(orders.length);
if (!paginated.length) list.innerHTML = '<tr><td colspan="7" class="empty-state">Không có đơn hàng phù hợp.</td></tr>';

bindEvents();

}

function filterOrders(){

const search=document.getElementById("searchOrder").value.toLowerCase();

const status=document.getElementById("statusFilter").value;

return allOrders.filter(order=>{

const matchSearch=
order._id.includes(search) ||
order.idUser?.email?.toLowerCase().includes(search);

const matchStatus=
!status || order.status===status;

return matchSearch && matchStatus;

});

}

function renderPagination(total){

const pageCount=Math.ceil(total/perPage);

const container=document.getElementById("pagination");

container.innerHTML="";

for(let i=1;i<=pageCount;i++){

container.innerHTML+=SafeHTML.html`
<button class="page-btn ${i===currentPage?"active":""}" data-page="${i}">
${i}
</button>
`;

}

document.querySelectorAll(".page-btn").forEach(btn=>{
btn.onclick=()=>{
currentPage=Number(btn.dataset.page);
renderOrders(true);
}
});

}

function bindEvents(){

document.querySelectorAll(".view-order").forEach(btn=>{

btn.onclick=()=>{

const id=btn.dataset.id;

const row=document.getElementById("detail-"+id);

row.style.display=row.style.display==="none"
?"table-row"
:"none";

}

});

document.querySelectorAll(".status-select").forEach(select=>{

const order=allOrders.find(o=>o._id===select.dataset.id);
select.value=order.status;
select.disabled=!(order.allowedTransitions || []).length;

select.onchange=async()=>{
if (select.disabled) return;

const id=select.dataset.id;
const status=select.value;

return Api.action("order-status:" + id, select, async () => {
await Api.admin(`${API_URL}/orders/${id}/status`,{

method:"PUT",

headers:{
"Content-Type":"application/json",
Authorization:`Bearer ${localStorage.getItem("adminToken")}`
},

body:JSON.stringify({status})

});

await loadOrders();
}, async error => {
select.value=order.status;
alert(error.message);
Api.report(error);
if (error.status === 409) await loadOrders();
});

};

});

}

document.getElementById("searchOrder").oninput=()=>{
currentPage=1;
renderOrders(true);
};

document.getElementById("statusFilter").onchange=()=>{
currentPage=1;
renderOrders(true);
};

function updateOrdersURL() {
const params = new URLSearchParams({ page: currentPage,
  search: document.getElementById("searchOrder").value,
  status: document.getElementById("statusFilter").value });
const next = location.pathname + "?" + params.toString();
if (location.pathname + location.search !== next) history.pushState({}, "", next);
}
function restoreOrdersURL(render = true) {
const params = new URLSearchParams(location.search);
currentPage = Math.max(1, parseInt(params.get("page")) || 1);
document.getElementById("searchOrder").value = params.get("search") || "";
document.getElementById("statusFilter").value = params.get("status") || "";
if (render) renderOrders();
}
window.addEventListener("popstate", () => restoreOrdersURL());
restoreOrdersURL(false);
loadOrders();
