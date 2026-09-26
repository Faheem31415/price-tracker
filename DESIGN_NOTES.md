# Design Notes

*Draft reasoning to finalize in your own words before submission — the
brief asks specifically what you corrected after an AI's first attempt,
so keep track of what you actually change after running `npm run recon`
and testing against the real site.*

## Why Playwright instead of lightweight HTTP fetching

The assignment's own guidance is to prefer lightweight HTTP fetching and
reach for a headless browser "only where the page genuinely requires it."
Investigation of the real site (via browser DevTools, manually, before
any code was written) showed it genuinely requires it:

1. `GET /api/v2/listings` (search/browse) returns clean, static JSON with
   no price or stock — fine for plain `fetch()`.
2. A single product's price, however, is not returned with the page. The
   UI shows a "Price locked — hover to load" state. Triggering it fires
   `POST /api/v2/handshake`, which returns a **WASM proof-of-work
   challenge** (salt, difficulty, a compiled WASM module) that the browser
   must execute to earn a short-lived (~30s), request-scoped signed `pass`
   token.
3. That token is then required to call
   `GET /api/v2/items/{id}/quote?opt={option}`, which itself returns not a
   plain price but an **encrypted `blob`** — decrypted only by the page's
   own JavaScript.

Reimplementing WASM PoW solving and reverse-engineering the client-side
decryption would be significant, fragile, out-of-scope reverse
engineering — and would also stop being "scraping the store" and start
being "defeating the store's security," which isn't the spirit of the
task. Driving a real (headless) browser through the same interaction a
human does — select an option, click "check price," read the rendered DOM
— is the correct-weight solution: it lets the site's own code solve its
own challenge and decrypt its own data, and the scraper only reads the
result.

## Reliability strategy

- **Outer retry with backoff**: up to 3 full attempts per scrape, 2s/4s
  backoff between them, because the site's own UI already shows it
  retries internally ("Loaded in N attempt(s)" / "Check again") — the
  scraper mirrors that expectation rather than fighting it.
- **Explicit per-attempt timeout, not a fixed sleep**: waits on a
  selector/state change (price text appearing) rather than sleeping a
  guessed duration, so it adapts to genuinely fast or slow responses
  instead of always waiting the worst case.
- **No partial/guessed data ever stored**: if price can't be parsed, or
  the panel never resolves within the timeout across all retries, the
  attempt is logged as `failed` with `price`/`stock` = `null` — never a
  best-guess value.
- **Per-product isolation in the scheduled batch**: one product's scrape
  throwing an unexpected error never aborts the run for the remaining
  tracked products; each gets its own try/catch and its own logged row.
- **Every attempt is logged, success or failure**: `scrape_attempts` gets
  exactly one row per product per run, so the scrape log and CSV export
  reflect what actually happened, not a filtered success-only view.

## Trade-offs

- Playwright is heavier than plain HTTP — slower per scrape, more memory,
  and a real constraint on Render's free tier (documented in README).
  Accepted because the site's own protection makes the lightweight path
  effectively infeasible without reimplementing its security layer.
- Products/options are tracked by typing the option label + code shown on
  the product page rather than via a live-fetched dropdown, to avoid
  running an extra Playwright pass just to populate UI. Documented as a
  known limitation in README rather than silently faked.
- Scraping runs sequentially per batch (not parallel per product) to
  avoid launching many concurrent Chromium instances on a constrained
  host — trades scrape-run speed for stability.

## What the AI got wrong on the first attempt & Real Reverse-Engineering Findings

1. **`navigator.webdriver` Anti-Bot Detection**:
   - *Initial attempt assumption*: Assumed a standard `page.hover('.offer-panel')` or click would trigger the price load.
   - *Real behavior*: Headless Chromium sets `navigator.webdriver = true`. The storefront's React event listeners detected this flag and refused to execute the handshake challenge flow; the unlock button remained disabled indefinitely.
   - *Correction*: Injected an init script via `context.addInitScript` overriding `navigator.webdriver` to `false` with desktop Chrome user-agent headers before page navigation.

2. **Asynchronous Randomized Consent Scrim**:
   - *Initial attempt assumption*: Assumed a single click on the "Allow" button would dismiss the privacy modal.
   - *Real behavior*: The consent overlay (`.consent-scrim`) was mounted after an asynchronous delay (`setTimeout`) and randomized its dismiss requirement (`Zr()` selected between 1 and 3 clicks required before hiding). When navigating or clicking option chips, the scrim re-intercepted pointer events (`intercepts pointer events`).
   - *Correction*: Injected a persistent CSS stylesheet (`.consent-scrim, .consent-box { display: none !important; pointer-events: none !important; }`) and a `MutationObserver` on `document.documentElement` to strip the scrim instantly whenever mounted, allowing unblocked interaction.

3. **Human Movement & Dwell Tracker (`Ar` class)**:
   - *Initial attempt assumption*: Expected that hovering or clicking the offer panel would unlock the price.
   - *Real behavior*: Deobfuscating the frontend bundle (`index-GaW5Fnef.js`) revealed a custom tracking class `Ar` instantiated as `new Ar({minMoves: 8, minDwellMs: 600})`. It required $\ge 8$ cursor moves across `.offer-panel`, spaced $\ge 40$ms apart, and $\ge 600$ms dwell time before `missing()` returned `null` and enabled the button.
   - *Correction*: Built an adaptive cursor simulation loop that moves the mouse across distinct coordinates within the panel's bounding box every 65ms, actively polling until `button:not([disabled])` is detected.

4. **Flaky Click Dropper (`Xn` function)**:
   - *Initial attempt assumption*: Assumed clicking the button once would trigger the quote request.
   - *Real behavior*: The storefront wrapped the unlock click handler in `Xn(e)`, which randomly dropped clicks with ~17.5% probability or delayed execution by 900ms.
   - *Correction*: Added an active phase-check: if after 1.2s the offer panel remained in the "Price locked" state, a follow-up click was dispatched to ensure trigger execution.

5. **Honeypot Decoy Price in DOM**:
   - *Initial attempt assumption*: Searching for `.price-value` or the first visible `₹` string.
   - *Real behavior*: The storefront injected a hidden honeypot element (`<span class="price-value" style="display:none">`) with fake decoy pricing.
   - *Correction*: Scoped price extraction to the `<data>` element or the manifest-declared class (`.fgy-x1` from `/api/v2/ui/manifest`), ignoring `.price-value` and `.rwq-x1` (MRP strikethrough).

6. **Unicode Fullwidth Digit Obfuscation**:
   - *Initial attempt assumption*: Parsing prices with simple `text.replace(/[^\d.]/g, '')`.
   - *Real behavior*: The storefront randomly formatted prices with fullwidth unicode numbers (e.g. `₹６１,３７２` via `String.fromCharCode(65296 + Number(e))`), European thousands dots, and non-breaking spaces. Plain regex failed to match fullwidth digits.
   - *Correction*: Applied `text.normalize('NFKD')` prior to extraction, transforming fullwidth characters to standard ASCII digits.
