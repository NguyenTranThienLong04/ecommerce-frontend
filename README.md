# Clothing Shop frontend

Customer and admin web interfaces built with HTML, CSS and browser JavaScript,
served by Express 5 on Node **24.13.1**. The companion
[backend README](https://github.com/long123123213/ecommerce-backend#readme) explains
the architecture, transaction/payment guarantees, Docker setup and deployment.

## Local setup

Keep this checkout named `ClothingShopProjectFE` beside `ClothingShopProject`.
For the complete Docker demo, follow the backend README and open
**http://localhost:3000**. For frontend source development with the backend running:

```sh
npm ci
npm run setup:local
npm run dev
```

`setup:local` copies [.env.example](.env.example) to ignored `.env.local` if absent.
`BACKEND_URL=http://localhost:5000` is the browser-reachable backend origin.
`/runtime-config.js` publishes only `apiBase` and `socketUrl` with `no-store` caching;
all API/socket clients read this config. It never exposes server secrets.
Socket.IO and DOMPurify are served from pinned/local installed dependencies.

For production, inject `NODE_ENV=production`, `BACKEND_URL=https://<backend-origin>`
and the host's `PORT`, then run `npm ci --omit=dev` and `npm start`. No compilation
or dev-only process manager is required. Serve HTTPS and configure the backend
`FRONTEND_URL` to this frontend origin. Follow the
[deployment checklist](https://github.com/long123123213/ecommerce-backend/blob/main/docs/deployment.md).

## Demo

After backend seed: `user@demo.example.com` at `/login`, or
`admin@demo.example.com` at `/admin/login`; default local-only password
`LocalDemo123!`. Seed uses `DEMO_PASSWORD` on first creation and preserves existing
accounts on rerun. The demo includes three products, variants and a delivery address.
Use COD; local Docker disables external payment/upload integrations.

## Reliability and security

- Checked API responses, request timeouts, action locks and scope-aware session expiry.
- Immutable checkout retry payload/key saved in sessionStorage for the current tab/user.
- Safe plain text/URL rendering, DOMPurify for product rich text, and protected admin APIs.
- Catalog and admin URL state synchronizes with Back/Forward; stale responses are ignored.
- Unavailable cart rows stay visible/removable. Order history uses purchase snapshots.
- Chat authenticates, rejoins and resyncs history after reconnect. Lost-ACK retries reuse
  the same UUID; the backend unique constraint prevents another stored message/event.
- Payment result uses authenticated backend state, bounded polling and explicit network retry.
- Batch 8 separates metadata from inventory CAS edits, reads payment capability from
  the cart API, and persists payment-creation UUIDs across uncertain responses/reload.
  An acknowledged link completes the intent; a later explicit action gets a new UUID.
  Deploy with the matching backend; old JWTs require one-time re-login. See the
  [Batch 8 report](https://github.com/long123123213/ecommerce-backend/blob/main/docs/batch8-hardening.md).

## Verification

```sh
npm ci
npm run check
npm test
npm run scan:secrets
npm audit --audit-level=high
npx playwright install chromium
npm run test:e2e
```

Install backend dependencies too (`npm ci` there). Browser E2E automatically starts
both applications on ports **4300/4500** and a temporary MongoDB 7.0.24 replica set.
First use may download the Mongo binary and browser. It never loads production
`.env`, uses no provider secrets, and blocks browser traffic outside localhost.
An alternate backend checkout can be supplied with the `BACKEND_PATH` environment
variable. Reports/traces are generated under ignored `playwright-report`/`test-results`.

Chromium covers login/invalid session, catalog-to-cart, archived item removal,
committed checkout with dropped response, native Back/Forward, chat ACK loss and
offline rejoin/history resync, and payment Processing to Paid/Requires review via
signed local IPN including network retry. [DOM/test details](test/README.md).
Batch 8 also covers admin metadata/stock races and payment-link response loss after
the actual commit, reload/retry, and a deliberate new attempt. Current totals:
**116 frontend tests and 10 Chromium E2E tests**.

The [CI workflow](.github/workflows/ci.yml) also runs backend integration/concurrency
tests and Docker startup/restart checks. Set repository variable `BACKEND_REF` to
the compatible backend SHA/tag (default `main`), or use the manual `companion_ref`
input. The backend workflow uses `FRONTEND_REF` in the opposite direction.

## Limits

No React migration or UI redesign. Optional fonts, charts, editor and carousel
libraries still use CDNs. E2E covers Chromium critical flows, not every admin CRUD
screen, browser or visual layout. Native BFCache behavior is not guaranteed by the
navigation test. Pending chat send IDs are in memory; reloading can lose one.
Checkout recovery storage is scoped to a browser tab, not a durable offline queue.
No real gateway transaction, automatic refund or production deployment is claimed.
