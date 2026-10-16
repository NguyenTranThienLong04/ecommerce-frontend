const BASE = window.AppConfig.apiBase;
const API_URL = BASE;

// ===============================
// LOAD USER
// ===============================

async function loadUser(){

const token = localStorage.getItem("token");

if(!token){
window.location.href="/login";
return;
}

const res = await Api.user(`${API_URL}/auth/me`,{
headers:{ Authorization:`Bearer ${token}` }
});

const user = await res.json();
if (!user || typeof user.email !== "string") throw Api.error(502);

document.getElementById("sidebar-name").innerText = user.name || "";
document.getElementById("hello-user").innerText = `Xin chào, ${user.name || ""}`;
document.getElementById("account-name").innerText = user.name || "";
document.getElementById("account-email").innerText = user.email;
document.getElementById("loyalty").innerText = user.loyaltyPoints ?? 0;

}

loadUser().catch(error => Api.report(error, loadUser));
document.querySelector("#password form")?.addEventListener("submit", event => {
  event.preventDefault();
  Api.report(Api.error(400, { message: "Chức năng đổi mật khẩu hiện chưa được hỗ trợ." }));
});



// ===============================
// TAB SWITCH
// ===============================

const tabs = document.querySelectorAll(".account-sidebar li[data-tab]");

tabs.forEach(tab=>{

tab.onclick = ()=>{

document.querySelectorAll(".account-sidebar li")
.forEach(li=>li.classList.remove("active"));

tab.classList.add("active");

const tabName = tab.dataset.tab;

document.querySelectorAll(".tab")
.forEach(t=>t.classList.remove("active"));

document.getElementById(tabName).classList.add("active");

};

});



// ===============================
// LOGOUT
// ===============================

document.getElementById("logout-btn").onclick = ()=>{

localStorage.removeItem("token");
localStorage.removeItem("user");

window.location.href="/";

};
