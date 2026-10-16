const token = localStorage.getItem("adminToken");

if (!token) {
  window.location.href = "/admin/login";
}
