const BASE = window.AppConfig.apiBase;
const API_URL = BASE;
let usersRequest = 0;

async function loadUsers() {
  const request = ++usersRequest;
  try {

  const token = localStorage.getItem("adminToken");

  const res = await Api.admin(`${API_URL}/users`, {
    headers: {
      "Authorization": "Bearer " + token
    }
  });

  const users = Api.list(await res.json());
  if (request !== usersRequest) return;

  const table = document.getElementById("userTable");

  table.innerHTML = "";

  users.forEach(user => {

    const row = document.createElement("tr");
    row.innerHTML = SafeHTML.html`
<td>${user.name || ""}</td>
      <td>${user.email}</td>
      <td>${user.phone || ""}</td>

      <td>
        <select class="user-role">
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
      </td>

      <td>
      <button data-action="editUser">Sửa</button>
        <button data-action="deleteUser">Xóa</button>
      </td>
    `;
    row.querySelector('[data-action="editUser"]').addEventListener("click", () => editUser(user._id, user.name, user.phone || ""));
    row.querySelector('[data-action="deleteUser"]').addEventListener("click", () => deleteUser(user._id));
    const roleSelect = row.querySelector(".user-role");
    roleSelect.value = user.role;
    roleSelect.addEventListener("change", () => changeRole(user._id, roleSelect.value, roleSelect, user.role));
    table.appendChild(row);

  });
  if (!users.length) table.innerHTML = '<tr><td colspan="5" class="empty-state">Chưa có người dùng.</td></tr>';

  } catch (error) { if (request === usersRequest) Api.report(error, loadUsers); }
}

loadUsers();



async function deleteUser(id) {

  const token = localStorage.getItem("adminToken");

  if (!confirm("Bạn có chắc muốn xóa user?")) return;
  return Api.action("delete-user:" + id, [...document.querySelectorAll('[data-action="deleteUser"]')], async () => {

  await Api.admin(`${API_URL}/users/${id}`, {
    method: "DELETE",
    headers: {
      "Authorization": "Bearer " + token
    }
  });

  await loadUsers();
  });
}

async function editUser(id, name, phone){

  const newName = prompt("Tên mới:", name);
  const newPhone = prompt("Số điện thoại:", phone);
  const newPassword = prompt("Mật khẩu mới (bỏ trống nếu không đổi):");

  if(!newName || newPhone === null || newPassword === null) return;

  const token = localStorage.getItem("adminToken");

  const bodyData = {
    name: newName,
    phone: newPhone
  };

  if(newPassword){
    bodyData.password = newPassword;
  }

  const submit = async () => {
  await Api.admin(`${API_URL}/users/${id}`,{

    method:"PUT",

    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer " + token
    },

    body:JSON.stringify(bodyData)

  });

  await loadUsers();
  };
  const save = () => Api.action("edit-user:" + id, [...document.querySelectorAll('[data-action="editUser"]')], submit,
    error => Api.report(error, save));
  return save();

}

async function changeRole(id, role, select, previousRole) {
  return Api.action("role:" + id, select, async () => {

  const token = localStorage.getItem("adminToken");

  await Api.admin(`${API_URL}/users/${id}`, {

    method: "PUT",

    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },

    body: JSON.stringify({
      role
    })

  });
  await loadUsers();
  }, error => {
    if (select) select.value = previousRole;
    Api.report(error);
  });
}
