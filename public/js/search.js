const BASE = window.AppConfig.apiBase;
const API_URL = `${BASE}/products`;


const ITEMS_PER_PAGE = 40;

let currentPage = 1;
let totalPages = 1;
let products = [];


let searchQuery = "";
let productRequest = 0;


async function fetchProducts(page = 1, navigate = true){
const request = ++productRequest;
const params = new URLSearchParams(window.location.search);
searchQuery = params.get("q") || "";
currentPage = Math.max(1, Number(page) || 1);
if (navigate) {
  params.set("page", currentPage);
  const next = "/search?" + params.toString();
  if (location.pathname + location.search !== next) history.pushState({}, "", next);
}
document.getElementById("products-list").innerHTML = '<div class="ui-loading" role="status">Đang tải sản phẩm…<div class="ui-skeleton" aria-hidden="true"></div></div>';
document.getElementById("pagination").replaceChildren();
document.getElementById("search-count").textContent = "";

try{

const urlParams = new URLSearchParams();

urlParams.append("page",page);
urlParams.append("limit",ITEMS_PER_PAGE);

if(searchQuery){
urlParams.append("search",searchQuery);
}

const res = await Api.fetch(`${API_URL}?${urlParams.toString()}`);

const data = await res.json();
if (request !== productRequest) return;
products = Api.list(data.products);

currentPage = data.page;

totalPages = data.totalPages;

renderProducts();

renderPagination();

updateTitle(data.total);

}catch(error){
if (request !== productRequest) return;
document.getElementById("products-list").textContent = "Không tải được kết quả tìm kiếm.";
Api.report(error, () => fetchProducts(currentPage, false));
}

}

function buildBadges(product) {

  let badges = [];

  // =========================
  // PCS / SOLD OUT
  // =========================
  if (product.selectedTags?.includes("PCS")) {

    if (product.totalStock > 0) {
      badges.push(`${product.totalStock} PCS`);
    } else {
      badges.push("SOLD OUT");
    }

  }

  // =========================
  // admin tags
  // =========================
  if (product.selectedTags) {
    product.selectedTags.forEach(tag => {
      if (tag !== "PCS") {
        badges.push(tag);
      }
    });
  }

  // =========================
  // custom tags
  // =========================
  if (product.customTags) {
    badges.push(...product.customTags);
  }

  // tối đa 3 tag
  return badges.slice(0, 3);
}

function updateTitle(total){

const count = document.getElementById("search-count");

if(!searchQuery) { count.textContent = ""; return; }

if(total === 0){

count.innerHTML = SafeHTML.html`
Không tìm thấy nội dung với từ khóa "<b>${searchQuery}</b>".
<br>
Vui lòng tìm kiếm với từ khóa khác.
`;

}else{

count.innerText = `Tìm thấy ${total} kết quả với từ khóa "${searchQuery}"`;

}

}



function renderProducts(){

const productList = document.getElementById("products-list");
productList.innerHTML = "";

// Không có sản phẩm
if (!products.length) {

document.getElementById("pagination").innerHTML = "";

return;

}

products.forEach(product=>{

const img = product.images?.[0] || "/assets/images/product-placeholder.svg";

const price = product.minPrice
? product.minPrice.toLocaleString("vi-VN")
: "Liên hệ";

// 🔥 build tag
const badges = buildBadges(product);

const badgeHTML = badges
.map(tag => SafeHTML.html`<span class="product__badge">${tag}</span>`);

productList.innerHTML += SafeHTML.html`

<div class="product__item"
data-slug="${product.slug}">

<div class="product__image">

<img src="${SafeHTML.url(img)}" alt="${product.nameProduct}" loading="lazy">

<div class="product__badges">
${badgeHTML}
</div>

</div>

<h3 class="product__name">
${product.nameProduct}
</h3>

<div class="product__price">
${price} đ
</div>

</div>

`;

});

}



function renderPagination(){

const pagination = document.getElementById("pagination");

pagination.innerHTML="";

for(let i=1;i<=totalPages;i++){

const btn=document.createElement("button");

btn.innerText=i;

if(i===currentPage){
btn.classList.add("active");
}

btn.onclick=()=>{

fetchProducts(i);

window.scrollTo({
top:0,
behavior:"smooth"
});

};

pagination.appendChild(btn);

}

}



document.getElementById("products-list").addEventListener("click", event => {
  const card = event.target.closest(".product__item");
  if (card) goToDetail(card.dataset.slug);
});

function goToDetail(slug){

window.location.href=SafeHTML.productPath(slug);

}


function restoreSearch() {
  fetchProducts(new URLSearchParams(location.search).get("page") || 1, false);
}
window.addEventListener("popstate", restoreSearch);
restoreSearch();
