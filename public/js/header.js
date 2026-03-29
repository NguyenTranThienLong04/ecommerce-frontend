function closeMobileNav() {
    const header = document.getElementById("header");
    if (!header) return;
    header.classList.remove("header--nav-open");
    const toggle = header.querySelector(".header__menu-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
}

document.addEventListener("click", function (e) {

    const menuToggle = e.target.closest(".header__menu-toggle");
    if (menuToggle) {
        e.preventDefault();
        const header = document.getElementById("header");
        if (!header) return;
        const open = !header.classList.contains("header--nav-open");
        header.classList.toggle("header--nav-open", open);
        menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
        document.body.style.overflow = open ? "hidden" : "";
        return;
    }

    if (e.target.closest(".header__overlay")) {
        closeMobileNav();
        return;
    }

    if (e.target.closest(".header__menu-item a")) {
        closeMobileNav();
    }

    // USER ICON
    const userIcon = e.target.closest("#user-icon");

    if (userIcon) {

        e.preventDefault();

        const token = localStorage.getItem("token");

        if (token) {
            window.location.href = "/account";
        } else {
            window.location.href = "/login";
        }

        return;
    }

    // SEARCH BUTTON
    const searchBtn = e.target.closest("#search-btn");

    if (searchBtn) {

        const searchInput = document.getElementById("search-input");

        if (!searchInput) return;

        const keyword = searchInput.value.trim();

        if (!keyword) return;

        window.location.href = `/search?q=${encodeURIComponent(keyword)}`;

    }

});


// ENTER SEARCH
document.addEventListener("keypress", function (e) {

    if (e.key !== "Enter") return;

    const searchInput = e.target.closest("#search-input");

    if (!searchInput) return;

    const keyword = searchInput.value.trim();

    if (!keyword) return;

    window.location.href = `/search?q=${encodeURIComponent(keyword)}`;

});

window.addEventListener("resize", function () {
    if (window.innerWidth > 992) closeMobileNav();
});

document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMobileNav();
});