
const BASE = window.AppConfig.apiBase;
const API_URL = `${BASE}/products`;
const BANNER_API = `${BASE}/banners`;
const ITEMS_PER_PAGE = 40;

let allProducts = [];
let currentPage = 1;
let productRequest = 0;

// ==============================
// Lấy page từ URL
// ==============================
function getPageFromURL() {
  const params = new URLSearchParams(window.location.search);
  return parseInt(params.get("page")) || 1;
}

// ==============================
// Cập nhật URL không reload
// ==============================
function updateURL(page) {
  const newURL = `?page=${page}`;
  if (location.search !== newURL) window.history.pushState({ page }, "", newURL);
}

// ==============================
// Fetch sản phẩm
// ==============================
async function fetchProducts() {
  const request = ++productRequest;
  document.getElementById("products-list").textContent = "Đang tải...";
  document.getElementById("pagination").replaceChildren();
  try {

    currentPage = getPageFromURL();

    const res = await Api.fetch(`${API_URL}?page=${currentPage}&limit=${ITEMS_PER_PAGE}`);
    const data = await res.json();
    if (request !== productRequest) return;
    allProducts = Api.list(data.products);

    renderProducts();

    renderPagination(data.totalPages);

  } catch (error) {
    if (request !== productRequest) return;
    document.getElementById("products-list").textContent = "Không tải được sản phẩm.";
    Api.report(error, fetchProducts);
  }
}
// ==============================
// Render sản phẩm
// ==============================
function renderProducts() {

  const productList = document.getElementById("products-list");
  productList.innerHTML = "";

  const productsToShow = allProducts;

  productsToShow.forEach(product => {

    const firstImage = product.images[0] || "default.jpg";

    let badges = [];

    // =========================
    // PCS / SOLD OUT
    // =========================
    if (product.selectedTags?.includes("PCS")) {

      if (product.totalStock > 0) {
        badges.push(`${product.totalStock} PCS`);
      } else {
        badges.push("SOLD OUT");
      }

    }

    // =========================
    // admin tags
    // =========================
    if (product.selectedTags) {
      product.selectedTags.forEach(tag => {
        if (tag !== "PCS") {
          badges.push(tag);
        }
      });
    }

    // =========================
    // custom tags
    // =========================
    if (product.customTags) {
      badges.push(...product.customTags);
    }

    // tối đa 3 tag
    badges = badges.slice(0,3);

    const badgeHTML = badges
.map(tag => SafeHTML.html`<span class="product__badge">${tag}</span>`);

const html = SafeHTML.html`
<div class="product__item" data-slug="${product.slug}">

  <div class="product__image">

    <img src="${SafeHTML.url(firstImage)}" alt="${product.nameProduct}">

    <div class="product__badges">
      ${badgeHTML}
    </div>

  </div>

  <h3 class="product__name">${product.nameProduct}</h3>

  <div class="product__price">
    ${product.minPrice || "Liên hệ"} VND
  </div>

</div>
`;

    productList.innerHTML += html;

  });

}

// ==============================
// Render phân trang
// ==============================
function renderPagination(totalPages) {
  const pagination = document.getElementById("pagination");
  pagination.innerHTML = "";

  for (let i = 1; i <= totalPages; i++) {
    const button = document.createElement("button");
    button.innerText = i;

    if (i === currentPage) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => {
      currentPage = i;
      updateURL(i);
      fetchProducts();   // 🔥 gọi lại API
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    pagination.appendChild(button);
  }
}

/** Swiper instance trang chủ — cần sync khi resize mobile ↔ desktop */
let homeSwiper = null;

function debounce(fn, ms) {
  let t;
  return function debounced() {
    const ctx = this;
    const args = arguments;
    clearTimeout(t);
    t = setTimeout(function () {
      fn.apply(ctx, args);
    }, ms);
  };
}

/**
 * Khi bật autoHeight (mobile), Swiper gán height inline cho wrapper.
 * Khi kéo lại desktop mà không gọi đủ bước cập nhật → banner cắt ngang / trắng phía dưới.
 */
function syncHomeSwiperLayout() {
  const swiper = homeSwiper;
  if (!swiper || !swiper.el) return;

  const mobile =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 992px)").matches
      : window.innerWidth <= 992;

  swiper.params.autoHeight = mobile;

  if (swiper.wrapperEl && !mobile) {
    swiper.wrapperEl.style.height = "";
  }

  swiper.updateSize();
  swiper.updateSlides();
  swiper.update();

  if (swiper.params.loop && typeof swiper.loopFix === "function") {
    try {
      swiper.loopFix();
    } catch (e) {
      /* ignore */
    }
  }
}

function initSwiper() {

  const mobile =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 992px)").matches
      : window.innerWidth <= 992;

  const swiper = new Swiper(".mySwiper", {
    loop: true,
    autoHeight: mobile,
    autoplay: {
      delay: 3000,
    },
    navigation: {
      nextEl: ".swiper-button-next",
      prevEl: ".swiper-button-prev",
    },
    pagination: {
      el: ".swiper-pagination",
      clickable: true,
    },
    observer: true,
    observeParents: true,
  });

  homeSwiper = swiper;

  if (typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(max-width: 992px)");
    const onMq = function () {
      syncHomeSwiperLayout();
    };
    if (mq.addEventListener) mq.addEventListener("change", onMq);
    else if (mq.addListener) mq.addListener(onMq);
  }

  const onResize = debounce(syncHomeSwiperLayout, 120);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", syncHomeSwiperLayout);

  requestAnimationFrame(function () {
    syncHomeSwiperLayout();
  });
}

async function loadBanners(){

  const res = await Api.fetch(BANNER_API);
  const banners = Api.list(await res.json());

  const bannerList = document.getElementById("banner-list");

  bannerList.innerHTML = "";

  banners.forEach(banner => {

    bannerList.innerHTML += SafeHTML.html`
      <div class="swiper-slide">
        <a href="${SafeHTML.url(banner.link)}">
          <img src="${SafeHTML.url(banner.image)}">
        </a>
      </div>
    `;

  });

  if (banners.length && typeof Swiper === "function") initSwiper();

}
document.getElementById("products-list").addEventListener("click", event => {
  const card = event.target.closest(".product__item");
  if (card) goToDetail(card.dataset.slug);
});

function goToDetail(slug) {
  window.location.href = SafeHTML.productPath(slug);
}

// ==============================
// Khi back / forward trình duyệt
// ==============================
window.addEventListener("popstate", (event) => {
  currentPage = getPageFromURL();
  fetchProducts();
});

// ==============================
// Khởi chạy
// ==============================
loadBanners().catch(error => Api.report(error, loadBanners));
fetchProducts();
