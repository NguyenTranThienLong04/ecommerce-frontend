/* Presentation only. Business scripts own requests, values, disabled state and visibility. */
(function () {
  const set = (node, key, value) => {
    if (node.getAttribute(key) !== String(value)) node.setAttribute(key, value);
  };
  const visible = node => node && node.getClientRects().length > 0;
  const focusables = node => [...node.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]')]
    .filter(control => !control.disabled && !control.closest('[inert]') && visible(control));
  let popupOpen = false, popupTrigger = null, scheduled = false;
  function sync() {
    scheduled = false;
    document.querySelectorAll('.product__item').forEach(card => {
      set(card, 'role', 'link'); set(card, 'tabindex', '0');
      set(card, 'aria-label', card.querySelector('.product__name')?.textContent.trim() || 'Xem sản phẩm');
    });
    document.querySelectorAll('.thumbnails img').forEach((img, index) => {
      set(img, 'role', 'button'); set(img, 'tabindex', '0');
      set(img, 'alt', 'Xem ảnh sản phẩm ' + (index + 1));
      set(img, 'aria-pressed', img.src === document.getElementById('mainImage')?.src);
    });
    document.querySelectorAll('#sizes button, #colors button').forEach(button => set(button, 'aria-pressed', button.classList.contains('active')));
    document.querySelectorAll('.account-sidebar li').forEach(item => {
      set(item, 'tabindex', '0'); set(item, 'role', 'button');
      if (item.dataset.tab) {
        set(item, 'aria-controls', item.dataset.tab);
        set(item, 'aria-pressed', item.classList.contains('active'));
      }
    });
    document.querySelectorAll('.pagination button, #pagination button').forEach(button => {
      if (button.classList.contains('active')) set(button, 'aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('.sidebar a, .header__menu-item a').forEach(link => {
      const path = location.pathname.replace(/\.html$/, '');
      if (new URL(link.href).pathname === path) set(link, 'aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view-order').forEach(button => {
      const target = document.getElementById('detail-' + button.dataset.id);
      if (!target) return;
      set(button, 'aria-controls', target.id);
      set(button, 'aria-expanded', target.style.display !== 'none');
    });
    document.querySelectorAll('.status-select, .user-role').forEach(select => {
      set(select, 'aria-label', select.classList.contains('status-select') ? 'Trạng thái đơn hàng' : 'Vai trò người dùng');
    });
    const nav = document.querySelector('.header__nav');
    const header = document.getElementById('header');
    if (nav && header) {
      nav.inert = innerWidth <= 992 && !header.classList.contains('header--nav-open');
      const toggle = header.querySelector('.header__menu-toggle');
      if (toggle) set(toggle, 'aria-label', header.classList.contains('header--nav-open') ? 'Đóng menu' : 'Mở menu');
    }
    const popup = document.getElementById('cartPopup');
    const open = popup && !popup.classList.contains('hidden');
    if (open && !popupOpen) {
      popupTrigger = document.activeElement;
      popupOpen = true;
      focusables(popup)[0]?.focus();
    } else if (!open && popupOpen) {
      popupOpen = false;
      if (popupTrigger?.isConnected) popupTrigger.focus();
    }
    const chatBox = document.getElementById('chat-box');
    const chatButton = document.getElementById('chat-button');
    if (chatBox && chatButton) set(chatButton, 'aria-expanded', chatBox.style.display === 'flex');
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(sync); }
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      const control = event.target.closest('.product__item, .thumbnails img, .account-sidebar li');
      if (control && event.target === control) { event.preventDefault(); control.click(); }
    }
    const popup = document.getElementById('cartPopup');
    const header = document.querySelector('.header--nav-open');
    const trap = popupOpen ? popup : innerWidth <= 992 ? header : null;
    if (event.key === 'Escape') {
      if (popupOpen) popup.querySelector('button[onclick="closePopup()"]')?.click();
      if (header) header.querySelector('.header__menu-toggle')?.focus();
      if (event.target.closest('#chat-box')) document.getElementById('chat-close')?.click();
    }
    if (event.key !== 'Tab' || !trap) return;
    const controls = focusables(trap), first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !trap.contains(document.activeElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !trap.contains(document.activeElement))) {
      event.preventDefault(); first?.focus();
    }
  });
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'src'] });
  window.addEventListener('resize', schedule);
  window.addEventListener('popstate', schedule);
  sync();
})();
