Current commands are in the [main README](../README.md). Batch sections below are
historical checkpoints; Batch 7 supersedes the previous browser/chat limitations.

UI refactor checkpoint: **116 frontend regressions and 17 Chromium E2E tests**.
The seven UI tests in `e2e/ui.spec.js` cover 375/768/1024/1440px, short landscape,
keyboard focus, form labels, reduced motion, contrast, payment-card states,
loading/error/empty rendering, and admin writes. Screenshots are generated under
`.cache/ui-review`. See [UI refactor report](../docs/ui-refactor.md) for library
cache instructions, preserved logic and coverage limits.

Batch 8 current checkpoint: **116 frontend tests and 10 Chromium E2E tests**.
New catalog/checkout cases verify separate metadata/inventory forms, 409 refresh
without silent CAS retry, server payment capability and durable same-tab payment
keys. `payment-creation.test.js` checks lost/invalid responses, timeout/HTTP errors,
reload, acknowledged new intent, storage failures and owner/order separation.
The two added E2E cases use real database commits for stock races and payment-link
response loss, then check persisted counts and keys. Earlier assertions remain enabled.

Security regression tests use Node's built-in test runner and jsdom to execute
the actual frontend scripts against local API fixtures. DOMPurify is the same
installed dependency served by the app at `/vendor/dompurify.js`.

From this repository, run:

```powershell
npm ci
npm test
```

Verified with Node 24.13.1. The 20 tests need no backend, credentials, browser
download, or network requests. jsdom does not provide browser layout, so the
tests emulate innerText's plain-text behavior and stub Chart/Swiper/CKEditor
and Socket.IO client transport. Backend tests separately exercise real sockets.

Coverage includes reflected search XSS; stored product, tag, variant, address,
order, user, category and banner data; admin greeting email; rich text sanitization
and editor input; URL protocols; action listeners with quotes in values; chat JWT
handshake/reconnect and absence of sender IDs in outbound messages; and script
loading order. Assertions inspect resulting DOM nodes and executable attributes,
literal text, preserved rich formatting, and action arguments.

Rendering rules for future changes:

- Use textContent/DOM APIs for plain values, or SafeHTML.html tagged templates.
- Interpolations in html templates must be text or quoted HTML attribute values;
  never put them in JavaScript, CSS, an unquoted attribute, or a tag name.
- Apply SafeHTML.url to API-provided navigation/image URLs and productPath to slugs.
- Use SafeHTML.richText only for intentional product-description HTML. It preserves
  basic CKEditor formatting, tables, links and images, while removing scripts,
  event handlers, embedded documents, and arbitrary inline styles.
- Use event listeners for dynamic actions. The remaining static HTML includes
  and fixed handlers are project source, with no user/API interpolation.

These are DOM regression tests, not a real-browser end-to-end or visual test.

Batch 2 adds `checkout.test.js` with 10 tests for server totals, immutable
idempotency requests, double clicks, network/500/uncertain-commit retries,
reload with a different cart, definitive conflicts, VNPay link failure,
saved/free-form addresses, and empty/invalid checkout. `npm test` now runs 30 tests.
The existing security checkout fixture includes the new backend quote fields;
its XSS assertions are unchanged.

Pending checkout payloads are saved in sessionStorage before POST, scoped to the
server-returned user ID. Network/5xx/ambiguous outcomes retain that payload and
key. Reloading the same tab retries the previous order before using a newer cart.
Closing the tab/clearing storage can discard the pending client record; server
key constraints and cart snapshot checks remain authoritative.

Batch 3 adds `order-lifecycle.test.js` with 5 DOM tests; the full frontend suite
has 35 tests. They verify server-supplied admin transition choices, disabled
terminal orders, conflict/error handling and refreshed state, network retry,
customer cancellation eligibility, and an idempotent cancellation response.
Deploy the backend and frontend together: admin options now use
`allowedTransitions` and the customer cancel button uses `canCancel` from the API.

Batch 4 adds `payment.test.js` with 10 DOM tests; the full frontend suite has
45 tests. The result page fetches an authenticated backend status and supports
PAID, PROCESSING, FAILED, CANCELLED, EXPIRED and REQUIRES_REVIEW. Tests cover a
forged browser success parameter, polling from pending to paid, bounded polling,
network errors/retry, authentication, invalid references, literal text rendering,
and the old success/fail pages using the same backend lookup.

No browser Return or polling timeout can finalize payment. Configure the backend
`VNP_RESULT_URL` to the frontend `/payment-result` URL when publishing both apps.

Batch 5 adds `catalog.test.js` with 11 DOM tests; the frontend suite now has 56
tests. Customer/admin order history prefers purchase snapshots, safely handles
missing legacy references and continues escaping stored text/URLs. Cart/checkout
keep unavailable rows visible with removal or a link back to the cart; valid
rows remain intact. Admin reads use the protected archive-inclusive endpoints,
and variant duplicate errors are shown without clearing the entered values.

The security product-list mock follows `/products/admin`; all its escaping/XSS
assertions are retained. Deploy with the Batch 5 backend and complete the legacy
cleanup described in `../CATALOG_BATCH5.md` in the shared workspace first.

Batch 6 adds 38 tests in `reliability.test.js`, four checkout tests and two payment
tests. The full frontend suite is now **100 tests**, all passing. The unchanged
backend suite also passes **113 tests**. Syntax checks pass for 33 frontend and
76 backend JavaScript files, plus 16 inline HTML scripts; both repositories pass
`git diff --check`.

New coverage: scoped/late 401, checked HTTP errors, network/malformed JSON recovery,
write locks/button restoration, preserved address/auth forms, request races,
Back/Forward for customer catalog and admin products/orders, corrupt dashboard
responses and helper loading order. Checkout tests simulate an actual request
timeout after server commit and verify replay with the same immutable key, plus
malformed confirmation, expired session and corrupt saved checkout recovery.
Payment lifecycle tests invalidate old page responses and simulate BFCache restore.

Chat tests use controlled ACKs and history responses: reauthentication/rejoin,
missed-message resync, socket/snapshot ID merge, A/B history races, retained failed
drafts, late ACK after switching conversations, and no automatic resend after ACK
timeout. Existing security fixtures now use the server's real ACK/message shape;
their security/XSS assertions remain. All harnesses load the shared request helper.

Tests use jsdom, not a real browser. Native BFCache, cross-tab sessions, keyboard/
layout behavior, real offline/proxy socket reconnects and external payment return
still need browser E2E. Manual resend after a lost chat ACK can duplicate a message
because the existing backend has no client message idempotency key. See the shared
workspace `FRONTEND_BATCH6.md` for the full audit, file list and remaining limits.

Batch 7 adds `release.test.js` for configuration validation, the real runtime config
and local Socket.IO asset routes, and pending message UUID reuse/context isolation.
Existing chat failure tests additionally assert UUID reuse on manual retry.

`npm run test:e2e` runs Playwright/Chromium with real frontend/backend servers and
temporary MongoDB. See `e2e/critical.spec.js`: real login and invalid session,
product-to-cart and archived item removal, committed checkout response loss with
one stored order, native Back/Forward, persisted chat with lost ACK (same UUID,
one database record, event and UI row), offline socket rejoin/history resync, and
Processing-to-Paid/Requires-review through signed local IPN with network retry.
Database results are not mocked; boundary faults drop HTTP responses/ACKs or
toggle browser network connectivity. External browser traffic is blocked.

The tests do not prove all browser engines, native BFCache, every admin screen,
external CDN availability or real provider delivery. Chat IDs remain in memory
for the current page; no durable offline send queue is introduced.
