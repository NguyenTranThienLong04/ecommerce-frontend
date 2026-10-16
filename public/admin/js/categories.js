const BASE = window.AppConfig.apiBase;
const API_URL = BASE;

let editingId = null; // lưu id đang sửa

// ================= LOAD =================
async function loadCategories() {
  try {
    const res = await Api.admin(`${API_URL}/categories`);
    const categories = Api.list(await res.json());

    const table = document.getElementById("categoryTable");
    table.innerHTML = "";

    categories.forEach(category => {
      const row = document.createElement("tr");
    row.innerHTML = SafeHTML.html`
<td>${category.nameCategory}</td>
          <td>
            <button data-action="startEdit">
              Sửa
            </button>
            <button data-action="deleteCategory">
              Xóa
            </button>
          </td>
    `;
    row.querySelector('[data-action="startEdit"]').addEventListener("click", () => startEdit(category._id, category.nameCategory));
    row.querySelector('[data-action="deleteCategory"]').addEventListener("click", () => deleteCategory(category._id));
    table.appendChild(row);
    });
    if (!categories.length) table.innerHTML = '<tr><td colspan="2" class="empty-state">Chưa có danh mục.</td></tr>';

  } catch (error) {
    Api.report(error, loadCategories);
  }
}

// ================= ADD / UPDATE =================
async function addCategory() {
  return Api.action("save-category", document.querySelector('button[onclick="addCategory()"]'), async () => {
  const name = document.getElementById("categoryName").value;

  if (!name) {
    alert("Nhập tên danh mục");
    return;
  }

  // Nếu đang edit thì gọi PUT
  if (editingId) {
    await Api.admin(`${API_URL}/categories/${editingId}`, {
      method: "PUT",
       headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("adminToken")}`
  },
      body: JSON.stringify({
        nameCategory: name
      })
    });

    editingId = null;
    document.querySelector("button[onclick='addCategory()']").innerText = "Thêm";

  } else {
    // Nếu không edit thì POST
    await Api.admin(`${API_URL}/categories`, {
      method: "POST",
      headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("adminToken")}`
  },
      body: JSON.stringify({
        nameCategory: name
      })
    });
  }

  document.getElementById("categoryName").value = "";
  await loadCategories();
  });
}

// ================= START EDIT =================
function startEdit(id, name) {
  editingId = id;
  document.getElementById("categoryName").value = name;
  document.querySelector("button[onclick='addCategory()']").innerText = "Cập nhật";
}

// ================= DELETE =================
async function deleteCategory(id) {
  if (!confirm("Bạn chắc chắn muốn xóa?")) return;
  return Api.action("delete-category:" + id, [...document.querySelectorAll('[data-action="deleteCategory"]')], async () => {

  await Api.admin(`${API_URL}/categories/${id}`, {
    method: "DELETE" ,headers:{ 
      Authorization: `Bearer ${localStorage.getItem("adminToken")}`
    },
  });

  await loadCategories();
  });
}

loadCategories();
