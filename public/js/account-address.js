document.addEventListener("DOMContentLoaded", function () {
  const api = window.AppConfig.apiBase + "/addresses";
  const modal = document.getElementById("address-modal");
  if (!modal) return;
  const list = document.getElementById("address-list");
  const save = document.getElementById("save-address");
  const cancel = document.getElementById("cancel-address");
  const add = document.getElementById("add-address-btn");
  const fields = ["receiverName", "phone", "addressLine", "ward", "district", "city"];
  let editingId = null, addresses = [], version = 0, returnFocus;
  const notice = document.createElement("p");
  notice.setAttribute("role", "alert");
  modal.querySelector(".modal-content").appendChild(notice);
  function open(address, trigger) {
    returnFocus = trigger || document.activeElement;
    editingId = address?._id || null;
    fields.forEach(key => { document.getElementById(key).value = address?.[key] || ""; });
    document.getElementById("modal-title").textContent = address ? "Chỉnh sửa địa chỉ" : "Thêm địa chỉ";
    notice.textContent = "";
    modal.style.display = "flex";
    document.getElementById("receiverName").focus();
  }
  function close() {
    modal.style.display = "none";
    editingId = null;
    returnFocus?.focus();
  }
  async function loadAddresses() {
    const request = ++version;
    try {
      const res = await Api.user(api);
      const data = Api.list(await res.json());
      if (request !== version) return;
      addresses = data;
      list.innerHTML = addresses.length ? addresses.map(addr => SafeHTML.html`
        <div class="address-item">
          <p><b>${addr.receiverName}</b>${addr.isDefault ? SafeHTML.html`<span style="color:green">(Mặc định)</span>` : ""}</p>
          <p>${addr.phone}</p><p>${addr.addressLine}, ${addr.ward}, ${addr.district}, ${addr.city}</p>
          <div class="address-actions">
            <button data-action="editAddress" data-id="${addr._id}">Sửa</button>
            <button data-action="setDefaultAddress" data-id="${addr._id}">Đặt mặc định</button>
            <button data-action="deleteAddress" data-id="${addr._id}">Xóa</button>
          </div>
        </div>`).join("") : "<p>Chưa có địa chỉ</p>";
    } catch (error) {
      if (request !== version) return;
      if (error.status === 401) list.replaceChildren();
      Api.report(error, loadAddresses);
    }
  }
  list.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (button) window[button.dataset.action]?.(button.dataset.id, button);
  });
  add.onclick = () => open(null, add);
  cancel.onclick = () => { if (!save.disabled) close(); };
  save.onclick = () => Api.action("save-address", [save, cancel, add], async () => {
    const data = Object.fromEntries(fields.map(key => [key, document.getElementById(key).value.trim()]));
    const missing = fields.find(key => !data[key]);
    if (missing) {
      document.getElementById(missing).focus();
      throw Api.error(400, { message: "Vui lòng điền đầy đủ địa chỉ." });
    }
    if (!/^(0|\+84)[3-9][0-9]{8}$/.test(data.phone)) throw Api.error(400, { message: "Số điện thoại không hợp lệ." });
    await Api.user(api + (editingId ? "/" + encodeURIComponent(editingId) : ""), {
      method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    });
    close();
    await loadAddresses();
  }, error => { notice.textContent = error.message; }).then(() => {
    if (modal.style.display === "none") returnFocus?.focus();
  });
  window.editAddress = (id, button) => {
    if (save.disabled) return;
    const address = addresses.find(address => address._id === id);
    if (!address) return Api.report(Api.error(404), loadAddresses);
    open(address, button);
  };
  window.deleteAddress = (id, button) => Api.action("address:" + id, button, async () => {
    await Api.user(api + "/" + encodeURIComponent(id), { method: "DELETE" });
    await loadAddresses();
  });
  window.setDefaultAddress = (id, button) => Api.action("address:" + id, button, async () => {
    await Api.user(api + "/default/" + encodeURIComponent(id), { method: "PUT" });
    await loadAddresses();
  });
  modal.addEventListener("keydown", event => {
    if (event.key === "Escape" && !save.disabled) close();
    if (event.key !== "Tab") return;
    const controls = [...modal.querySelectorAll("input, button")].filter(control => !control.disabled);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  loadAddresses();
});
