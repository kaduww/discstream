# DiscStream Testing

## Automated Checks

Run the regular checks:

```sh
pnpm typecheck
pnpm test
pnpm --filter @discstream/web build
```

Run the packaged app smoke test:

```sh
pnpm test:smoke
```

The smoke test builds the web app, starts the Fastify app in memory with a temporary runtime directory, then verifies:

- built web UI is served from `/`;
- SPA deep links fall back to the web app;
- `/api/health` returns a typed response;
- unknown API routes return a structured DiscStream error.

## Browser Smoke Tests

The browser smoke test uses Playwright and expects a running local DiscStream UI:

```sh
pnpm run test:browser-smoke
```

If the Playwright browser binaries are missing on a clean machine, install Chromium once:

```sh
pnpm exec playwright install chromium
```

The smoke test opens the running DiscStream UI and checks:

- desktop viewport loads the app shell;
- iPad portrait and landscape viewports load without horizontal overflow;
- TV browser viewport loads, enables TV mode, and keeps controls remote-friendly;
- local media controls render;
- `/api/health` returns `ok:true` from inside the browser.

The smoke test skips cleanly when the Playwright package is not installed.

## Hardware Checklist

Use [hardware-test-checklist.md](./hardware-test-checklist.md) for manual tests that require a real optical drive, Audio CD, DVD, or large local media library.
