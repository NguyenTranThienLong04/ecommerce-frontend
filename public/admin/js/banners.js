const BASE = window.AppConfig.apiBase;
const API_URL = `${BASE}/banners`;
// LOAD BANNERS
async function loadBanners(){
try {

const res = await Api.admin(API_URL);
const banners = Api.list(await res.json());

const tbody = document.querySelector("#banner-table tbody");

tbody.innerHTML = "";

banners.forEach(banner => {

const row = document.createElement("tr");
    row.innerHTML = SafeHTML.html`
<td>
<img src="${SafeHTML.url(banner.image)}" width="120">
</td>

<td>${banner.title || ""}</td>

<td>${banner.order}</td>

<td>${banner.status ? "Active" : "Hidden"}</td>

<td>
<button data-action="editBanner">Edit</button>
<button data-action="deleteBanner">Delete</button>
</td>
    `;
    row.querySelector('[data-action="editBanner"]').addEventListener("click", () => editBanner(banner._id));
    row.querySelector('[data-action="deleteBanner"]').addEventListener("click", () => deleteBanner(banner._id));
    tbody.appendChild(row);

});

} catch (error) { Api.report(error, loadBanners); }
}

loadBanners();


// ADD BANNER
async function addBanner(){
return Api.action("save-banner", document.querySelector('button[onclick="addBanner()"]'), async () => {

const image = document.getElementById("image").files[0];
if (!image) {
  alert("Chọn ảnh");
  return;
}

if (image.size > 2 * 1024 * 1024) {
  alert("Ảnh phải nhỏ hơn 2MB ");
  return;
}
const title = document.getElementById("title").value;
const link = document.getElementById("link").value;
const order = document.getElementById("order").value;

const formData = new FormData();

formData.append("image", image);
formData.append("title", title);
formData.append("link", link);
formData.append("order", order);

await Api.admin(API_URL,{
method:"POST",
 headers: {
    Authorization: `Bearer ${localStorage.getItem("adminToken")}`
  },
body:formData
});

document.getElementById("title").value="";
document.getElementById("link").value="";
document.getElementById("order").value="";
document.getElementById("image").value="";

await loadBanners();
});
}

async function editBanner(id){

const title = prompt("New title");
const link = prompt("New link");
const order = prompt("New order");
if ([title, link, order].some(value => value === null)) return;
const submit = async () => {

await Api.admin(`${API_URL}/${id}`,{
method:"PUT",
headers:{
    Authorization: `Bearer ${localStorage.getItem("adminToken")}`,
"Content-Type":"application/json"
},
body:JSON.stringify({
title,
link,
order
})
});

await loadBanners();
};
const save = () => Api.action("edit-banner:" + id, [...document.querySelectorAll('[data-action="editBanner"]')], submit,
  error => Api.report(error, save));
return save();
}

// DELETE
async function deleteBanner(id){

if(!confirm("Delete banner?")) return;
return Api.action("delete-banner:" + id, [...document.querySelectorAll('[data-action="deleteBanner"]')], async () => {

await Api.admin(`${API_URL}/${id}`,{
method:"DELETE",headers:{ 
    Authorization: `Bearer ${localStorage.getItem("adminToken")}`
},
});

await loadBanners();
});
}
