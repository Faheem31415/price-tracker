import { chromium } from 'playwright';

const STORE_BASE_URL = process.env.STORE_BASE_URL || 'https://demo.inelabteamdev.com';

// --- Tunables (tuned from live reverse engineering & recon) -----------------
const NAV_TIMEOUT_MS = 25_000;
const OFFER_ENABLE_TIMEOUT_MS = 12_000;
const PRICE_RESOLVE_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 2500, 5000];

/**
 * SELECTOR & BOT DETECTION FINDINGS (Verified live on target storefront):
 *
 * 1. BOT DETECTION:
 *    - The page checks `navigator.webdriver`. If true, the price unlock routine no-ops.
 *    - Fix: inject init script setting `navigator.webdriver = false`.
 *
 * 2. CONSENT OVERLAY:
 *    - The site mounts a randomized modal (.consent-scrim, .consent-box) at dynamic delays
 *      and randomizes click requirements (1-3 clicks).
 *    - Fix: inject a persistent style tag & MutationObserver via addInitScript to hide
 *      and suppress the scrim before it can ever intercept mouse events.
 *
 * 3. MOVEMENT & DWELL TRACKER (`Ar` class in storefront bundle):
 *    - The storefront requires at least 8 mouse moves over `.offer-panel`,
 *      each separated by >= 40ms, and a dwell time of >= 600ms.
 *    - Moving the mouse in increments over `.offer-panel` satisfies this requirement
 *      and removes the `disabled` attribute from the button.
 *
 * 4. FLAKY CLICK HANDLER (`Xn` in storefront bundle):
 *    - The button click handler has an artificial flake filter (`Xn`).
 *    - If the first click is dropped, clicking again after 1.2s ensures execution.
 *
 * 5. HONEYPOT PRICING:
 *    - A hidden `<span class="price-value" style="display:none">` contains a decoy price.
 *    - The real price is rendered inside the `<data>` element or `.fgy-x1` inside `.offer-panel`.
 *
 * 6. STOCK STATUS:
 *    - Inspected inside `.offer-panel`. "SOLD OUT" or "out of stock" indicates no stock.
 *    - "AVAILABLE" / "In stock" indicates in-stock.
 */

const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
    configurable: true,
  });
`;

const CONSENT_SUPPRESSION_SCRIPT = `
  (() => {
    try {
      const observer = new MutationObserver(() => {
        const scrim = document.querySelector('.consent-scrim');
        if (scrim) scrim.remove();
        const box = document.querySelector('.consent-box');
        if (box) box.remove();
        if (document.body) document.body.style.overflow = 'auto';
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      const style = document.createElement('style');
      style.innerHTML = '.consent-scrim, .consent-box { display: none !important; pointer-events: none !important; } body { overflow: auto !important; }';
      document.documentElement.appendChild(style);
    } catch {}
  })();
`;

async function attemptOnce(browser, itemId, optionLabelText) {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  await context.addInitScript(STEALTH_INIT_SCRIPT);
  await context.addInitScript(CONSENT_SUPPRESSION_SCRIPT);

  const page = await context.newPage();

  try {
    const url = `${STORE_BASE_URL}/item/${itemId}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(400);

    // STEP 1: Select option if specified
    if (optionLabelText) {
      const optionBtn = page.getByRole('button', { name: optionLabelText, exact: true });
      if ((await optionBtn.count()) > 0) {
        await optionBtn.first().click({ force: true, timeout: 5000 });
        console.log(`[scraper] item=${itemId} selected option: "${optionLabelText}"`);
        await page.waitForTimeout(400);
      } else {
        const availableOptions = await page.$$eval('button.opt-chip', (btns) =>
          btns.map((b) => b.innerText.trim())
        );
        console.warn(
          `[scraper] item=${itemId} option "${optionLabelText}" not found. Available: ${JSON.stringify(availableOptions)}`
        );
      }
    }

    // STEP 2: Find offer panel and simulate human cursor dwell to satisfy anti-bot tracker
    const offerPanel = page.locator('.offer-panel');
    await offerPanel.waitFor({ state: 'visible', timeout: 8000 });
    const panelBox = await offerPanel.boundingBox();
    if (!panelBox) {
      throw new Error('Could not compute bounding box for .offer-panel');
    }

    // Adaptively move cursor inside offer panel until button enables (up to 6s)
    const tStart = Date.now();
    let step = 0;
    while (Date.now() - tStart < 8000) {
      const x = panelBox.x + 30 + ((step * 19) % Math.max(120, panelBox.width - 60));
      const y = panelBox.y + 20 + ((step * 13) % Math.max(30, panelBox.height - 40));
      await page.mouse.move(x, y);
      await page.waitForTimeout(65);
      step++;

      if (step >= 10) {
        const isEnabled = await page.evaluate(() => {
          const btn = document.querySelector('button[aria-label*="Check today"]');
          return btn && !btn.disabled;
        });
        if (isEnabled) break;
      }
    }

    // STEP 3: Wait for "Check today's price" button to become enabled
    const triggerBtn = page.locator('button[aria-label*="Check today"]:not([disabled])');
    await triggerBtn.waitFor({ state: 'visible', timeout: OFFER_ENABLE_TIMEOUT_MS });

    const btnBox = await triggerBtn.boundingBox();
    if (btnBox) {
      await page.mouse.click(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
    } else {
      await triggerBtn.click({ force: true });
    }

    // STEP 4: Handle possible flaky click drop (retry if still in "Price locked" state)
    await page.waitForTimeout(1400);
    const isStillLocked = await page.evaluate(
      () => document.querySelector('.offer-msg')?.textContent === 'Price locked'
    );
    if (isStillLocked) {
      console.log(`[scraper] item=${itemId} click retried`);
      if (btnBox) {
        await page.mouse.click(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
      } else {
        await triggerBtn.click({ force: true });
      }
    }

    // STEP 5: Wait for price to render inside offer panel (accepts both ₹ and Rs. formats)
    await page.waitForFunction(
      () => {
        const panel = document.querySelector('.offer-panel');
        if (!panel) return false;
        const text = panel.innerText || '';
        return (
          (/[₹]|Rs\./i.test(text) || !!panel.querySelector('data') || !!panel.querySelector('.fgy-x1')) &&
          !text.includes('Loading')
        );
      },
      { timeout: PRICE_RESOLVE_TIMEOUT_MS }
    );

    // STEP 6: Extract price and stock
    const result = await page.evaluate(() => {
      const panel = document.querySelector('.offer-panel');
      if (!panel) return null;

      // Extract real price from <data> or manifest class (.fgy-x1)
      // Avoid decoy hidden price in .price-value
      const dataEl = panel.querySelector('data') || panel.querySelector('.fgy-x1');
      let priceText = dataEl ? dataEl.innerText.trim() : null;

      if (!priceText) {
        // Fallback: look for visible ₹ elements
        const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (
            parent &&
            window.getComputedStyle(parent).display !== 'none' &&
            (/[₹]|Rs\./i.test(node.textContent)) &&
            !parent.classList.contains('price-value') &&
            !parent.classList.contains('rwq-x1') // skip MRP
          ) {
            priceText = node.textContent.trim();
            break;
          }
        }
      }

      const fullText = panel.innerText || '';
      const soldOut = /sold.?out|out.?of.?stock|currently unavailable/i.test(fullText);
      const isAvailable = /available|in stock/i.test(fullText) || !soldOut;

      return {
        priceText,
        inStock: !soldOut && isAvailable,
        fullText,
      };
    });

    if (!result || !result.priceText) {
      throw new Error(`Failed to extract price text from offer panel. Content: ${result?.fullText}`);
    }

    const price = parsePriceText(result.priceText);
    if (price === null) {
      throw new Error(`Price parsed to null from "${result.priceText}"`);
    }

    console.log(`[scraper] item=${itemId} SUCCESS price=${price} stock=${result.inStock}`);
    return { price, stock: result.inStock };
  } finally {
    await context.close().catch(() => {});
  }
}

function parsePriceText(text) {
  if (!text) return null;
  // Storefront prices are integer rupees (maximumFractionDigits: 0 in storefront bundle)
  // The storefront randomly applies fullwidth unicode digits (case "unicode"), nbsp, euro dots, etc.
  // normalize('NFKD') maps fullwidth digits (６１,３７２) to standard ASCII (61,372)
  const normalized = text.normalize('NFKD');
  const digitsOnly = normalized.replace(/[^\d]/g, '');
  if (!digitsOnly) return null;
  const value = Number(digitsOnly);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Scrapes one product/option with retries and backoff.
 * Never throws — always returns a structured result object.
 */
export async function scrapeProduct(itemId, optionLabelText) {
  const browser = await chromium.launch({
    headless: process.env.HEADED !== 'true',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const delay = BACKOFF_MS[attempt - 1] ?? 5000;
      if (delay > 0) {
        console.log(`[scraper] item=${itemId} option="${optionLabelText}" attempt=${attempt} waiting ${delay}ms`);
        await sleep(delay);
      }
      console.log(`[scraper] item=${itemId} option="${optionLabelText}" attempt=${attempt} starting`);

      try {
        const result = await attemptOnce(browser, itemId, optionLabelText);
        return {
          price: result.price,
          stock: result.stock,
          outcome: attempt === 1 ? 'success' : 'retried',
        };
      } catch (err) {
        lastError = err;
        console.warn(
          `[scraper] item=${itemId} option="${optionLabelText}" attempt=${attempt} FAILED: ${err.message.split('\n')[0]}`
        );
      }
    }

    console.error(
      `[scraper] item=${itemId} all ${MAX_ATTEMPTS} attempts failed. Last error: ${lastError?.message.split('\n')[0]}`
    );
    return { price: null, stock: null, outcome: 'failed' };
  } finally {
    await browser.close().catch(() => {});
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
