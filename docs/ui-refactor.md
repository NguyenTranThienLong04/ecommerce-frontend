# Clothing Shop UI refactor

## Direction

UI UX Pro Max queries: `fashion ecommerce clean editorial`, then
`fashion minimalism`. Verified style: **Minimalism & Swiss Style** — whitespace,
clear grids, strong typography, product-first images and subtle transitions.
The generated pink palette conflicts with the brief, so an adapted warm neutral
palette with olive accents is used. No framework or remote font is added.

Tokens live in public/css/base.css: charcoal #20251f, olive #526246, warm white
#f7f7f2, white surfaces, muted #646b61; success #286044, warning #805714,
error #ad3434. System sans-serif supports Vietnamese; 16px body, 14px labels,
28–48px page headings. Spacing follows 4/8px; radii 6/12/20px; motion 160–220ms.

## Dependency audit completed before editing

All frontend HTML, CSS and application JS were read.

| Area | Hooks that must remain compatible |
| --- | --- |
| Header | #user-icon, #search-btn, #search-input, .header__menu-toggle, .header__overlay, .header__menu-item a; 992px mobile breakpoint |
| Catalog | .product__item + data-slug delegation, all filter/pagination IDs, active classes, URL history |
| Product | Gallery/variant IDs, exact button text used by selection, .active, popup .hidden and globals |
| Cart | .cart-items, data-item-id, button data-action/id/quantity, stale rows and image error selectors |
| Checkout | Input .field parents, payment labels/values, all IDs, existing hidden/disabled/readonly states |
| Account | .account-sidebar li[data-tab], .tab.active, #detail-ID table rows and inline display, existing address focus trap |
| Admin | Exact button[onclick] selectors, tbody IDs, .tag-checkbox, editor variable, row-local actions, separate inventory form |
| Chat | All IDs, bubble/name classes, inline visibility, socket events, ACK, drafts, history versions, clientMessageId |
| Feedback | Api.action owns disabled/aria-busy; Api.report owns retry and login links |

Presentation changes must not overwrite business-owned state. API, persistence,
auth, payment, checkout, inventory and chat protocols remain outside this task.

## Existing limitations

- Password change is explicitly unsupported; forgot-password and policy links
  remain placeholders. No new account or content functionality is introduced.
- Native alert/confirm/prompt flows are retained to preserve synchronous behavior.
- The chat contract has no unread count; no unread state is fabricated.
- Store addresses need real content. Existing chart/editor/slider CDNs remain.
- The existing checkout note field is not included in the order payload. This
  pre-existing logic gap is recorded only; the payload is unchanged.
- There is no customer review screen in the existing frontend.

## Verification

Baseline: 116/116 frontend regression tests passed before editing.

Final verification completed on 2026-10-17:

| Check | Result |
| --- | --- |
| `npm test` | PASS — 116 tests, 0 failures |
| `npm run test:e2e` | PASS — 17 Chromium tests, including all 10 original critical flows and 7 UI tests |
| `npm run check` | PASS — syntax checked for 62 scripts |
| `git diff --check` | PASS |
| Backend diff | No tracked backend changes; pre-existing untracked investigation files untouched |

The final Playwright run records `status: passed` with no failed tests in
`test-results/.last-run.json`. Responsive screenshots from that run are in
`.cache/ui-review`, including `shop-1440.png`, `checkout-375.png` and
`admin-dashboard-1440.png`.

## Screens and files

| Area | Changed files |
| --- | --- |
| Customer markup | All HTML files in public/pages: header, footer, index, shop, search, product-detail, cart, checkout, login, account, payment-result, success, fail |
| Customer styling | public/css/base.css, layout.css, index.css, product-detail.css, cart.css, checkout.css, login.css, account.css, reliability.css; new chat.css and payment.css |
| Admin markup | All HTML files in public/admin: slidebar, login, dashboard, categories, products, variants, orders, users, banners, chat |
| Admin styling | public/admin/css/admin.css, order.css, users.css, chat.css |
| Presentation JS | public/js/ui.js (new); markup/accessibility in index, shop, search, product-detail, cart, checkout, auth, account-address, account-orders, payment-result, chat-widget; admin renderers in admin-chat, dashboard, products, categories, variants, order, users, banners |
| Assets | public/assets/images/avatar.svg and product-placeholder.svg; original logo retained |
| Verification | e2e/ui.spec.js; test/README.md; this report; design-system/clothing-shop/MASTER.md |

## Logic preservation

No backend or package/dependency configuration changed. Existing API helpers,
auth/session credentials, checkout/payment request payloads and idempotency keys,
cart eligibility, inventory CAS, order transitions and Socket.IO protocol are
unchanged. Existing 116 regression cases and 10 critical E2E cases remain enabled.
Presentation JS adds labels, focus handling, selected-state semantics, safe text
timestamps, stock display using the existing selected variant, chart styling,
empty/loading states and local image fallback paths.

## Accessibility and responsive evidence

- Native search/cart controls, accessible names, form labels, skip links,
  keyboard product cards/thumbnails/account navigation, visible focus rings.
- Product popup traps/restores focus; existing address modal focus behavior is
  retained and browser-tested, including a short landscape viewport.
- Variant selection, order disclosure, pagination and active conversation expose
  their existing states to assistive technology.
- Inline validation links errors to fields and focuses the first invalid input.
- Sender/time/status text accompanies visual state. Reduced motion disables
  decorative transitions and slider/chart motion.
- Six primary/muted/accent/success/warning/error text pairs pass 4.5:1 contrast.
- 375, 768, 1024, 1440px plus 812×375 landscape: no document overflow in the
  tested screens; wide tables scroll inside named, keyboard-focusable regions.
- 102 screenshots are saved in .cache/ui-review. The data and accounts in those
  images are isolated demo fixtures, not production data.

## Reproducing browser review

Run `npm run test:e2e`. It includes the original 10 critical tests and 7 new UI
tests. The new matrix exercises real login/logout, variant/cart/checkout,
order/address screens, customer/admin chat and admin category/product/order/user
writes against the isolated backend/MongoDB. The six payment-card visual states
use controlled status responses; the original payment E2E still verifies signed
local IPN and persisted state.

For full chart/editor/slider rendering, place the existing CDN assets in
`.cache/ui-vendor/{chart.js,ckeditor.js,swiper.js,swiper.css}` using the URLs
listed in `e2e/ui.spec.js`. This review used those actual libraries. If absent,
the UI tests explicitly annotate their offline fallbacks. The suite never
contacts a live payment provider or writes production data.

Only Chromium is covered; Safari/Firefox and a full assistive-technology audit
are not claimed. Native browser dialogs and existing CDN dependencies remain.
