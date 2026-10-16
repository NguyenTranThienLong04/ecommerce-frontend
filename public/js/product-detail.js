
const BASE = window.AppConfig.apiBase;
const API_URL = BASE;

const slug = window.location.pathname.split("/")[1];

let allVariants = [];
let selectedSize = null;
let selectedColor = null;
let selectedVariant = null;

async function loadProduct() {
  try {
  const res = await Api.fetch(`${API_URL}/products/${slug}`);
  const data = await res.json();
  if (!data.product) throw Api.error(502);
  Api.list(data.variants);
  renderProduct(data);
  } catch (error) {
    document.getElementById("productName").textContent = error.status === 404 ? "Sản phẩm không còn khả dụng" : "Không tải được sản phẩm";
    document.getElementById("addToCartBtn").disabled = true;
    Api.report(error, loadProduct);
  }
}

function renderProduct(data) {
  const { product, variants } = data;

  allVariants = variants;

  document.getElementById("productName").innerText =
    product.nameProduct;

  document.getElementById("productDescription").innerHTML =
  SafeHTML.richText(product.description);

  // ===== Giá min mặc định =====
  updateMinPrice();

  // ===== Gallery =====
  const mainImage = document.getElementById("mainImage");
  const thumbnails = document.getElementById("thumbnails");

  mainImage.src = SafeHTML.url(product.images[0]);
  mainImage.alt = product.nameProduct;

  thumbnails.innerHTML = "";
  product.images.forEach(img => {
    const thumbnail = document.createElement("img");
    thumbnail.src = SafeHTML.url(img);
    thumbnail.addEventListener("click", () => changeImage(img));
    thumbnails.appendChild(thumbnail);
  });

  renderSizes();
  renderColors();
  updateOptions();
}

function updateMinPrice() {
  const prices = allVariants.map(v => v.price);
  const minPrice = Math.min(...prices);
  document.getElementById("productPrice").innerText =
    formatPrice(minPrice);
}

function changeImage(img) {
  document.getElementById("mainImage").src =
     SafeHTML.url(img);
}

/* =========================
   RENDER SIZE & COLOR
========================= */

function renderSizes() {
  const sizeContainer = document.getElementById("sizes");
  sizeContainer.innerHTML = "";

  const sizes = [...new Set(allVariants.map(v => v.size))];

  sizes.forEach(size => {
    const button = document.createElement("button");
    button.textContent = size;
    button.addEventListener("click", () => selectSize(size));
    sizeContainer.appendChild(button);
  });
}

function renderColors() {
  const colorContainer = document.getElementById("colors");
  colorContainer.innerHTML = "";

  const colors = [...new Set(allVariants.map(v => v.color))];

  colors.forEach(color => {
    const button = document.createElement("button");
    button.textContent = color;
    button.addEventListener("click", () => selectColor(color));
    colorContainer.appendChild(button);
  });
}

/* =========================
   SELECT (TOGGLE SUPPORT)
========================= */

function selectSize(size) {

  // Toggle nếu click lại chính nó
  if (selectedSize === size) {
    selectedSize = null;
    highlightActive("sizes", null);
    updateOptions();
    updateVariant();
    return;
  }

  selectedSize = size;
  highlightActive("sizes", size);
  updateOptions();
  updateVariant();
}

function selectColor(color) {

  // Toggle nếu click lại chính nó
  if (selectedColor === color) {
    selectedColor = null;
    highlightActive("colors", null);
    updateOptions();
    updateVariant();
    return;
  }

  selectedColor = color;
  highlightActive("colors", color);
  updateOptions();
  updateVariant();
}

/* =========================
   DISABLE LOGIC
========================= */

function updateOptions() {
  const sizeButtons =
    document.getElementById("sizes")
      .querySelectorAll("button");

  const colorButtons =
    document.getElementById("colors")
      .querySelectorAll("button");

  // Disable SIZE theo COLOR
  sizeButtons.forEach(btn => {
    const size = btn.textContent;

    const valid = allVariants.some(v =>
      v.size === size &&
      (!selectedColor || v.color === selectedColor)
    );

    btn.disabled = !valid;
  });

  // Disable COLOR theo SIZE
  colorButtons.forEach(btn => {
    const color = btn.textContent;

    const valid = allVariants.some(v =>
      v.color === color &&
      (!selectedSize || v.size === selectedSize)
    );

    btn.disabled = !valid;
  });
}

/* =========================
   UPDATE VARIANT
========================= */

function updateVariant() {
  const addBtn = document.getElementById("addToCartBtn");
  const availability = document.getElementById("variant-availability");
  if (availability) {
    availability.textContent = "Chọn kích thước và màu sắc để xem tình trạng sản phẩm.";
    delete availability.dataset.available;
  }

  // Nếu chưa chọn đủ
  if (!selectedSize || !selectedColor) {
    selectedVariant = null;
    addBtn.disabled = true;
    updateMinPrice();
    return;
  }

  const found = allVariants.find(v =>
    v.size === selectedSize &&
    v.color === selectedColor
  );

  if (!found) {
    selectedVariant = null;
    addBtn.disabled = true;
    return;
  }

  selectedVariant = found;

  document.getElementById("productPrice").innerText =
    formatPrice(found.price);

  addBtn.disabled = found.stock === 0;
  if (availability) {
    availability.textContent = found.stock === 0 ? "Hết hàng với lựa chọn này." : "Còn " + found.stock + " sản phẩm.";
    availability.dataset.available = String(found.stock > 0);
  }
}

/* =========================
   UI HELPERS
========================= */

function highlightActive(containerId, value) {
  const buttons =
    document.getElementById(containerId)
      .querySelectorAll("button");

  buttons.forEach(btn => {
    if (value && btn.textContent === value) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function formatPrice(price) {
  return price.toLocaleString("vi-VN") + " đ";
}

function showPopup() {
  const popup = document.getElementById("cartPopup");

  document.getElementById("popupImage").src =
    document.getElementById("mainImage").src;

  document.getElementById("popupName").innerText =
    document.getElementById("productName").innerText;

  document.getElementById("popupVariant").innerText =
    `Size: ${selectedSize} | Color: ${selectedColor}`;

  popup.classList.remove("hidden");
}

function closePopup() {
  document.getElementById("cartPopup")
    .classList.add("hidden");
}

function continueShopping() {
  closePopup();
  // ở lại trang hiện tại
}

function goToCart() {
  window.location.href = "/cart";
}
/* =========================
   ADD TO CART
========================= */

document.getElementById("addToCartBtn")
  .addEventListener("click", async () => {

    if (!selectedVariant) {
      alert("Vui lòng chọn size và màu");
      return;
    }

    const token = localStorage.getItem("token");

    if (!token) {
      alert("Bạn cần đăng nhập");
      window.location.href = "/login";
      return;
    }

    return Api.action("add-to-cart", document.getElementById("addToCartBtn"), async () => {
      const res = await Api.user(`${API_URL}/cart/add`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          idProductVariant: selectedVariant._id,
          quantity: 1
        })
      });

      if (!res.ok) {
        throw new Error("Lỗi thêm giỏ hàng");
      }

      showPopup();

    });
});

if (document.getElementById("productName")) {
  loadProduct();
}
