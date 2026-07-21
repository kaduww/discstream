#!/usr/bin/env node

const targetUrl = process.env.DISCSTREAM_BROWSER_SMOKE_URL ?? "http://localhost:5173/";

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.log("Browser smoke skipped: Playwright is not installed in this workspace.");
  process.exit(0);
}

const { chromium } = playwright;
let browser;

const ipadUserAgent =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const tvUserAgent =
  "Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/7.0 Chrome/108.0.0.0 TV Safari/537.36";

const profiles = [
  {
    name: "desktop",
    context: {
      viewport: { width: 1280, height: 800 }
    }
  },
  {
    name: "iPad portrait",
    context: {
      viewport: { width: 834, height: 1194 },
      hasTouch: true,
      isMobile: true,
      userAgent: ipadUserAgent
    }
  },
  {
    name: "iPad landscape",
    context: {
      viewport: { width: 1194, height: 834 },
      hasTouch: true,
      isMobile: true,
      userAgent: ipadUserAgent
    }
  },
  {
    name: "TV browser",
    context: {
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      userAgent: tvUserAgent
    },
    enableTvMode: true
  }
];

try {
  browser = await chromium.launch({ headless: true });
  const results = [];

  for (const profile of profiles) {
    const context = await browser.newContext(profile.context);
    const page = await context.newPage();

    try {
      await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 15000 });
      await assertAppShell(page, profile.name);

      if (profile.enableTvMode) {
        await assertTvMode(page);
      }

      await assertNoHorizontalOverflow(page, profile.name);
      results.push(profile.name);
    } finally {
      await context.close();
    }
  }

  console.log(`Browser smoke passed: ${targetUrl} (${results.join(", ")})`);
} catch (error) {
  console.error(`Browser smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}

async function assertAppShell(page, profileName) {
  const heading = await page.locator("h1").first().textContent({ timeout: 5000 });
  if (heading?.trim() !== "DiscStream") {
    throw new Error(`[${profileName}] Expected DiscStream heading, got ${heading ?? "empty"}.`);
  }

  await page.getByText("Media shelf").waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: /Refresh status/i }).waitFor({ timeout: 5000 });

  const health = await page.evaluate(async () => {
    const response = await fetch("/api/health");
    return response.json();
  });
  if (!health?.ok) {
    throw new Error(`[${profileName}] Health endpoint did not return ok:true.`);
  }
}

async function assertTvMode(page) {
  const tvModeButton = page.getByRole("button", { name: /Turn on TV mode/i });
  await tvModeButton.click();
  await page.locator("main.tv-mode").waitFor({ timeout: 5000 });

  await page.keyboard.press("Tab");
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
  if (!focusedTag || focusedTag === "body") {
    throw new Error("[TV browser] Keyboard focus did not move to a visible control.");
  }

  const minButtonSize = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll(".tv-mode button"));
    return buttons.every((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width >= 44 && rect.height >= 44;
    });
  });
  if (!minButtonSize) {
    throw new Error("[TV browser] TV mode has controls smaller than the minimum target size.");
  }
}

async function assertNoHorizontalOverflow(page, profileName) {
  const overflow = await page.evaluate(() => {
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    return {
      documentWidth,
      viewportWidth: window.innerWidth
    };
  });

  if (overflow.documentWidth > overflow.viewportWidth + 1) {
    throw new Error(
      `[${profileName}] Horizontal overflow detected: document ${overflow.documentWidth}px, viewport ${overflow.viewportWidth}px.`
    );
  }
}
