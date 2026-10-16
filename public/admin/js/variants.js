const BASE = window.AppConfig.apiBase;
const API_URL = BASE;

const urlParams = new URLSearchParams(window.location.search);
const productId = urlParams.get("id");

let editingId = null;
let inventoryEdit = null;

async function loadVariants() {
  try {

  const res = await Api.admin(`${API_URL}/products/admin/${productId}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}` }
  });
  const product = await res.json();
  Api.list(product.variants);

  const table = document.getElementById("variantTable");
  table.innerHTML = "";

  product.variants.forEach(v => {

    const row = document.createElement("tr");
    row.innerHTML = SafeHTML.html`
<td>${v.size}${v.archivedAt ? " (Ngừng bán)" : ""}</td>
        <td>${v.color}</td>
        <td>${v.price}</td>
        <td>${v.stock}</td>
        <td>
          <button data-action="editVariant">Edit</button>
          <button data-action="editStock">Điều chỉnh tồn kho</button>
          <button data-action="deleteVariant">Ngừng bán</button>
        </td>
    `;
    row.querySelector('[data-action="editVariant"]').addEventListener("click", () => editVariant(v._id, v.size, v.color, v.price, v.stock));
    row.querySelector('[data-action="editStock"]').addEventListener("click", () => editStock(v));
    row.querySelector('[data-action="deleteVariant"]').addEventListener("click", () => deleteVariant(v._id));
    table.appendChild(row);

  });
  } catch (error) { Api.report(error, loadVariants); }
}

async function addVariant() {
  return Api.action("save-variant", document.querySelector('button[onclick="addVariant()"]'), async () => {

  const size = document.getElementById("size").value;
  const color = document.getElementById("color").value;
  const price = document.getElementById("price").value;
  const stock = document.getElementById("stock").value;

  if (editingId) {

    const res = await Api.admin(`${API_URL}/variants/${editingId}`, {
      method: "PATCH",
     headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("adminToken")}`
  },
      body: JSON.stringify({
        size,
        color,
        price
      })
    });

    if (!res.ok) return alert((await res.json()).message || "Không thể cập nhật biến thể");
    editingId = null;

  } else {

    const res = await Api.admin(`${API_URL}/variants`, {
      method: "POST",
      headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("adminToken")}`
  },
      body: JSON.stringify({
        idProduct: productId,
        size,
        color,
        price,
        stock
      })
    });
    if (!res.ok) return alert((await res.json()).message || "Không thể tạo biến thể");
  }

  clearForm();
  await loadVariants();
  });
}

function editVariant(id, size, color, price, stock) {

  document.getElementById("size").value = size;
  document.getElementById("color").value = color;
  document.getElementById("price").value = price;
  document.getElementById("stock").value = stock;

  editingId = id;
  document.getElementById("stock").disabled = true;
  document.querySelector('button[onclick="addVariant()"]').textContent = "Lưu thông tin";
}

function editStock(variant) {
  inventoryEdit = { id: variant._id, expectedStock: variant.stock, expectedVersion: variant.inventoryVersion ?? 0 };
  document.getElementById("inventoryForm").hidden = false;
  document.getElementById("inventoryCurrent").textContent = "Tồn kho đã tải: " + variant.stock;
  document.getElementById("newStock").value = variant.stock;
  document.getElementById("inventoryMessage").textContent = "";
}

async function saveStock() {
  if (!inventoryEdit) return;
  return Api.action("save-stock", document.getElementById("saveStock"), async () => {
    const edit = inventoryEdit;
    const stock = Number(document.getElementById("newStock").value);
    if (document.getElementById("newStock").value === "" || !Number.isSafeInteger(stock) || stock < 0) {
      throw Api.error(400, { message: "Tồn kho phải là số nguyên không âm." });
    }
    await Api.admin(`${API_URL}/variants/${edit.id}/stock`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock, expectedStock: edit.expectedStock, expectedVersion: edit.expectedVersion })
    });
    inventoryEdit = null;
    document.getElementById("inventoryForm").hidden = true;
    await loadVariants();
  }, async error => {
    document.getElementById("inventoryMessage").textContent = error.message;
    if (error.status === 409) {
      inventoryEdit = null; // Never automatically retry the new quantity against a refreshed version.
      await loadVariants();
      document.getElementById("inventoryMessage").textContent += " Chọn lại Điều chỉnh tồn kho để xem số lượng mới.";
    }
  });
}
document.getElementById("saveStock").addEventListener("click", saveStock);
document.getElementById("cancelStock").addEventListener("click", () => {
  inventoryEdit = null;
  document.getElementById("inventoryForm").hidden = true;
});

async function deleteVariant(id) {

  if (!confirm("Ngừng bán biến thể này?")) return;
  return Api.action("archive-variant:" + id, [...document.querySelectorAll('[data-action="deleteVariant"]')], async () => {

  const res = await Api.admin(`${API_URL}/variants/${id}`, {
    method: "DELETE",
    headers: {
    Authorization: `Bearer ${localStorage.getItem("adminToken")}`
  }
  });

  if (!res.ok) return alert((await res.json()).message || "Không thể ngừng bán biến thể");
  await loadVariants();
  });
}

function clearForm() {
  editingId = null;
  document.getElementById("stock").disabled = false;
  document.querySelector('button[onclick="addVariant()"]').textContent = "Thêm";

  document.getElementById("size").value = "";
  document.getElementById("color").value = "";
  document.getElementById("price").value = "";
  document.getElementById("stock").value = "";

}

loadVariants();
