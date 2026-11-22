# AGENTS.md — ShopLedger

Standing instructions for coding agents working in this repo. Describes only what is true today.

## Stack

- Node.js (CommonJS, ES5-style `var`/`function`), Express 4, body-parser
- Vanilla HTML/CSS/JS front end in `public/` (no build step, no framework)
- Persistence: a single JSON file, `data/db.json` (tracked in git), read and rewritten whole on every request
- No test framework dependency; tests use the built-in `node:test` and `node:assert`

## Module map

| Path | What it does |
|---|---|
| `server.js` | Express app: static files, mounts the four routers under `/api`, serves `/orders/:id/invoice` (HTML tax invoice). Exports `app`; only listens when run directly. |
| `config.js` | Port, shop details, GST default rate (18%) and HSN→slab map, inventory defaults, coupon definitions, admin key. |
| `routes/products.js` | `GET /api/products`, `GET /api/coupons` |
| `routes/orders.js` | `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders` (place order), `POST /api/orders/:id/cancel` |
| `routes/customers.js` | `GET /api/customers`, `POST /api/customers/:id/settle` (Khata settlement) |
| `routes/reports.js` | `GET /api/reports/dashboard`, `GET /api/reports/gst-reconciliation`, `POST /api/pricing/preview`, `GET /api/admin/export` |
| `lib/store.js` | Reads/writes `data/db.json`; audit log helper |
| `lib/pricing.js` | Checkout math: subtotal, coupon discount apportioned per line, HSN GST on post-discount value. Source of the totals stored on each order. |
| `lib/tax.js` | GST rate per item (`gstRate` → HSN slab → default), CGST/SGST split |
| `lib/coupons.js` | Coupon lookup, validation (active, minOrder), discount with `maxDiscount` cap |
| `lib/invoice.js` | Accountant's printable invoice: figures + HTML render |
| `lib/reports.js` | Dashboard KPIs; GST reconciliation (stored order totals vs invoice figures) |
| `lib/inventory.js` | Product lookup, sellable stock (`stock - reserved`), stock check, deduct, release |
| `lib/orders.js` | Create, get, cancel, list/filter/sort orders |
| `lib/ledger.js` | Khata customer accounts: charge, reverse, settle |
| `lib/dates.js` | DD/MM/YYYY helpers, date-key normalisation, fiscal year |
| `public/` | Single-page UI: POS, Order History, Customer Khata, GST Audit tabs |

## Commands

```bash
npm install        # creates package-lock.json — do not commit it
npm start          # http://localhost:3000 (PORT env var overrides)
node --test        # run the test suite (tests live in tests/)
git checkout data/db.json   # undo data changes made by using the app
```

## Rules

1. **Characterization tests first.** Before changing behaviour, write `node:test` tests that pin what the code does today (name wrong-looking ones `CURRENT BEHAVIOUR`), see them pass, then change code.
2. **One module only.** Change only the module(s) the ticket is about. No drive-by refactors.
3. **Tests never touch `data/db.json`.** Use in-memory fixtures. Do not call `lib/store.js` read/write from tests. Reproduce bugs in the running app only against a temporary copy of the project.
4. **Add no dependencies.** Use Node built-ins only.
