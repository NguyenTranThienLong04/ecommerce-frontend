async function login() {
  return Api.action("admin-login", document.querySelector('button[onclick="login()"]'), async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const res = await Api.fetch(window.AppConfig.apiBase + "/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.user?.role !== "ADMIN") throw Api.error(403);
    if (typeof data.token !== "string") throw Api.error(502);
    localStorage.setItem("adminToken", data.token);
    localStorage.setItem("adminUser", JSON.stringify(data.user));
    window.location.href = "/admin/dashboard";
  });
}
function logout() {
  localStorage.removeItem("adminToken");
  localStorage.removeItem("adminUser");
  window.location.replace("/admin/login");
}
function checkAdmin() {
  if (!localStorage.getItem("adminToken") || Api.stored("adminUser")?.role !== "ADMIN") logout();
}
const adminLoginPage = ["/admin/login", "/admin/login.html"].includes(window.location.pathname);
if (adminLoginPage && localStorage.getItem("adminToken") && Api.stored("adminUser")?.role === "ADMIN") {
  window.location.replace("/admin/dashboard");
} else if (!adminLoginPage) checkAdmin();
