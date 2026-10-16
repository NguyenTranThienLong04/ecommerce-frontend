const BASE = window.AppConfig.apiBase;
const API_URL = BASE;

let page = 1;
let totalPages = 1;

let editingProductId = null;
let oldImages = [];
let productsRequest = 0, editRequest = 0;

// LOAD CATEGORY
async function loadCategoriesToSelect() {
  try {

  const res = await Api.admin(`${API_URL}/categories`);
  const categories = Api.list(await res.json());

  const select = document.getElementById("categorySelect");

  select.innerHTML = "";

  categories.forEach(c => {

    select.innerHTML += SafeHTML.html`
      <option value="${c._id}">
        ${c.nameCategory}
      </option>
    `;

  });

  } catch (error) { Api.report(error, loadCategoriesToSelect); }
}

// LOAD PRODUCTS
async function loadProducts(navigate = true) {
  const request = ++productsRequest;
  try {

  const search = document.getElementById("searchInput").value;
  if (navigate) {
    const params = new URLSearchParams({ page, search });
    const next = location.pathname + "?" + params.toString();
    if (location.pathname + location.search !== next) history.pushState({}, "", next);
  }
  document.getElementById("productTable").replaceChildren();
  document.getElementById("pageInfo").textContent = "Đang tải...";

  const res = await Api.admin(
    `${API_URL}/products/admin?page=${page}&limit=10&search=${encodeURIComponent(search)}`,
    { headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}` } }
  );

  const data = await res.json();
  if (request !== productsRequest) return;
  Api.list(data.products);

  totalPages = data.totalPages;

  document.getElementById("pageInfo").innerText =
    `Page ${page} / ${totalPages}`;

  const table = document.getElementById("productTable");

  table.innerHTML = "";

  data.products.forEach(product => {

    const image = product.images?.[0] || "";
   // tạo tag cho từng product
    const tags = [
      ...(product.selectedTags || []),
      ...(product.customTags || [])
    ].join(", ");
    const row = document.createElement("tr");
    row.innerHTML = SafeHTML.html`
<td>
          <img src="${SafeHTML.url(image)}" width="60" alt="" loading="lazy">
        </td>

        <td>${product.nameProduct}${product.archivedAt ? " (Ngừng bán)" : ""}</td>

        <td>
          ${SafeHTML.textFromHTML(product.description).slice(0,80)}...
        </td>

        <td>${product.minPrice || 0} đ</td>

        <td>${product.totalStock || 0}</td>

        <td>${tags}</td>

        <td>

          <button data-action="goToVariants">
            Variants
          </button>

          <button data-action="editProduct">
            Edit
          </button>

          <button data-action="deleteProduct">
            Ngừng bán
          </button>

        </td>
    `;
    row.querySelector('[data-action="goToVariants"]').addEventListener("click", () => goToVariants(product._id));
    row.querySelector('[data-action="editProduct"]').addEventListener("click", () => editProduct(product._id));
    row.querySelector('[data-action="deleteProduct"]').addEventListener("click", () => deleteProduct(product._id));
    table.appendChild(row);

  });
  if (!data.products.length) table.innerHTML = '<tr><td colspan="7" class="empty-state">Không có sản phẩm phù hợp.</td></tr>';

  } catch (error) {
    if (request === productsRequest) {
      document.getElementById("pageInfo").textContent = "Không tải được sản phẩm";
      Api.report(error, () => loadProducts(false));
    }
  }
}

// ADD / UPDATE PRODUCT
async function addProduct() {
  return Api.action("save-product", document.querySelector('button[onclick="addProduct()"]'), async () => {

  const name = document.getElementById("productName").value;

  const description = editor.getData();

  const categoryId = document.getElementById("categorySelect").value;

  const files = document.getElementById("productImages").files;
for (let file of files) {
  if (file.size > 1 * 1024 * 1024) {
    alert("Mỗi ảnh phải < 1MB");
    return;
  }
}
  const formData = new FormData();

  formData.append("nameProduct", name);
  formData.append("description", description);
  formData.append("idCategory", categoryId);

  formData.append("oldImages", JSON.stringify(oldImages));

  for (let i = 0; i < files.length; i++) {
    formData.append("images", files[i]);
  }

  let url = `${API_URL}/products`;
  let method = "POST";

  if (editingProductId) {
    url = `${API_URL}/products/${editingProductId}`;
    method = "PATCH";
  }
const selectedTags = [];

document
.querySelectorAll(".tag-checkbox:checked")
.forEach(cb=>{
  selectedTags.push(cb.value);
});

const customTags = document
.getElementById("customTags")
.value
.split(",")
.map(t=>t.trim())
.filter(Boolean);

formData.append(
"selectedTags",
JSON.stringify(selectedTags)
);

formData.append(
"customTags",
JSON.stringify(customTags)
);
  const res = await Api.admin(url, {
    method: method,
    headers: {
    Authorization: `Bearer ${localStorage.getItem("adminToken")}`
  },
    body: formData
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.message);
    return;
  }

  clearForm();

  await loadProducts();
  });
}

// EDIT PRODUCT
async function editProduct(id) {
  const request = ++editRequest;
  try {

  const res = await Api.admin(`${API_URL}/products/admin/${id}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}` }
  });

  const data = await res.json();
  if (request !== editRequest) return;
  if (!data.product) throw Api.error(502);

  const product = data.product;

  document.getElementById("productName").value =
    product.nameProduct;

  editor.setData(String(SafeHTML.richText(product.description)));

  document.getElementById("categorySelect").value =
    product.idCategory?._id;

  oldImages = product.images || [];

  editingProductId = id;
 // RESET checkbox
  document.querySelectorAll(".tag-checkbox")
  .forEach(cb => cb.checked = false);

  // SET selectedTags
  if(product.selectedTags){

    product.selectedTags.forEach(tag=>{

      const checkbox = [...document.querySelectorAll(".tag-checkbox")]
        .find(input => input.value === tag);

      if(checkbox) checkbox.checked = true;

    });

  }

  // SET customTags
  if(product.customTags){

    document.getElementById("customTags").value =
      product.customTags.join(", ");

  }
  } catch (error) { if (request === editRequest) Api.report(error, () => editProduct(id)); }
}

// DELETE
async function deleteProduct(id) {

  if (!confirm("Ngừng bán sản phẩm và tất cả biến thể?")) return;
  return Api.action("archive-product:" + id, [...document.querySelectorAll('[data-action="deleteProduct"]')], async () => {

  const res = await Api.admin(`${API_URL}/products/${id}`, {
    method: "DELETE",
    headers: {
    Authorization: `Bearer ${localStorage.getItem("adminToken")}`
  }
  });

  if (!res.ok) return alert((await res.json()).message || "Không thể ngừng bán sản phẩm");
  await loadProducts();
  });
}

// VARIANTS
function goToVariants(productId) {

  window.location.href =
    `/admin/variants.html?id=${encodeURIComponent(productId)}`;

}

// PAGINATION
function nextPage() {

  if (page < totalPages) {

    page++;

    loadProducts();

  }

}

function prevPage() {

  if (page > 1) {

    page--;

    loadProducts();

  }

}

// RESET FORM
function clearForm() {
  ++editRequest;

  editingProductId = null;

  oldImages = [];

  document.getElementById("productName").value = "";

  editor.setData("");

  document.getElementById("productImages").value = "";
document
.querySelectorAll(".tag-checkbox")
.forEach(cb => cb.checked = false);

document.getElementById("customTags").value = "";
}

// INIT
loadCategoriesToSelect();
function searchProducts() { page = 1; loadProducts(); }
function restoreProductsURL() {
  const params = new URLSearchParams(location.search);
  page = Math.max(1, parseInt(params.get("page")) || 1);
  document.getElementById("searchInput").value = params.get("search") || "";
  loadProducts(false);
}
window.addEventListener("popstate", restoreProductsURL);
restoreProductsURL();
