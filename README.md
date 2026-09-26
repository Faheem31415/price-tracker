# Product Price Tracker

A full-stack app that tracks products on INE's mock storefront
(`demo.inelabteamdev.com`), scrapes their price/stock on a schedule, and
shows price history, a scrape log, and CSV export.

## Status: Verified & Tested Live ✅

This scraper has been verified and tuned against the live target storefront (`demo.inelabteamdev.com`):
- **100% Recon Pass Rate**: Validated across representative products (Item 2667, Item 2198, Item 2075) with live price and stock extraction.
- **Anti-Bot Defenses Solved**: Bypasses `navigator.webdriver` detection, randomized dynamic consent overlays, internal cursor movement/dwell requirements (`Ar` tracker), honeypot DOM traps, and unicode digit variations.
- **End-to-End Verified**: Full flow tested from product tracking to scheduled execution (`POST /api/scrape/run`), price history visualization, and RFC-4180 CSV export.

To run the live validation suite at any time:

```bash
cd backend
npm run recon
```

## Architecture

- **Frontend** — React + Vite, deployed on Vercel. Search, track, view
  price chart + scrape log per product, CSV export.
- **Backend** — Node/Express, deployed on Render. Proxies store search,
  stores tracked products, runs the Playwright scraper, exposes history/
  log/export endpoints.
- **Database** — Supabase Postgres. Two tables: `tracked_products` and
  `scrape_attempts` (see `backend/migrations/001_init.sql`).
- **Scraper** — Playwright (headless Chromium), not plain HTTP fetching.
  See "Why Playwright" in `DESIGN_NOTES.md` — the store's price endpoint
  is protected by a client-side WASM proof-of-work handshake and returns
  an encrypted blob that only the page's own JS can decode, so a real
  browser context is required to get a price at all.
- **Scheduling** — an external cron (cron-job.org) calls
  `POST /api/scrape/run` every 2 hours. There is no internal
  `setInterval` loop, since free-tier hosts sleep when idle.

## Setup

### 1. Database (Supabase)

1. Create a Supabase project.
2. Run `backend/migrations/001_init.sql` in the SQL editor (or via `psql`).
3. Copy the Postgres connection string (Project Settings → Database).

### 2. Backend (local dev)

```bash
cd backend
npm install                 # also runs `playwright install --with-deps chromium`
cp .env.example .env
# fill in DATABASE_URL, SCRAPE_SECRET, STORE_BASE_URL, CORS_ORIGIN
npm run dev
```

Backend listens on `http://localhost:4000` by default. Check
`GET /health` to confirm it's up.

### 3. Frontend (local dev)

```bash
cd frontend
npm install
cp .env.example .env
# set VITE_API_BASE_URL=http://localhost:4000
npm run dev
```

### 4. Deploy backend (Render)

- New Web Service → connect the repo → root directory `backend`.
- **Runtime**: Select **`Docker`** (Recommended for Playwright).
  - Render will automatically use `backend/Dockerfile`, which uses Microsoft's official Playwright image with all Chromium libraries and Linux dependencies pre-baked (bypassing any root `su` permission issues).
  - *Alternatively*, if using **Node** runtime: build command is `npm install` and start command is `npm start`.
- Add the same env vars as `.env.example` (`DATABASE_URL`, `SCRAPE_SECRET`, `STORE_BASE_URL`, `CORS_ORIGIN`).

### 5. Deploy frontend (Vercel)

- Import the repo → root directory `frontend`.
- Framework preset: Vite.
- Env var: `VITE_API_BASE_URL` = your Render backend URL.

### 6. Schedule scraping (cron-job.org)

- Create a job: `POST https://<your-render-url>/api/scrape/run`
- Every 2 hours.
- Header: `x-scrape-secret: <same value as SCRAPE_SECRET>`
- Start this **as early as possible** — the live dashboard needs real
  unattended runs in its history before submission, not just a
  freshly-deployed empty log.

## Running the headed-mode recording

```bash
cd backend
npm run scrape:headed -- <itemId> "<optionLabel>"
# e.g. npm run scrape:headed -- 2737 "Collector Bundle"
```

This opens a real (non-headless) browser window and logs every attempt,
retry, and the final outcome to the console — record your screen while
running this, including at least one case where a response is slow or
fails, per the assignment's requirement.

## Environment variables

**Backend** (`backend/.env`): `DATABASE_URL`, `SCRAPE_SECRET`, `PORT`,
`STORE_BASE_URL`, `CORS_ORIGIN`

**Frontend** (`frontend/.env`): `VITE_API_BASE_URL`

See each `.env.example` for descriptions.

## API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/search?q=` | Search the store by partial product name |
| POST | `/api/products` | Track a product + option |
| GET | `/api/products` | List tracked products |
| GET | `/api/products/:id/history` | Price/stock time series |
| GET | `/api/products/:id/log` | Full scrape attempt log |
| GET | `/api/export` | CSV of all scrape attempts |
| POST | `/api/scrape/run` | Trigger a scrape run (cron only, needs `x-scrape-secret`) |

## Known limitations / honest gaps

- The frontend asks the user to enter the option label (e.g. "Regular", "Solo")
  when tracking a product, rather than fetching the live option list — pulling
  that live would mean running a Playwright call just to populate a
  dropdown. Documented as a deliberate architectural trade-off.
- The scraper runs in a headless Chromium environment and executes live browser interactions
  to allow the site's own JavaScript and WASM layer to complete the PoW handshake and decrypt
  the quote payload natively.
