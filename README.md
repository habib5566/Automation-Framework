# Playwright JavaScript Test Automation Framework

End-to-end UI tests using the Page Object Model, structured logging, traces, screenshots on failure, and HTML reports. A small local demo application is bundled so login and dashboard scenarios run without external services.

## Prerequisites

- Node.js 18 or newer
- npm (bundled with Node)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Install browser binaries (Chromium is configured by default). Include ffmpeg only if you enable test video recording:

```bash
npx playwright install chromium
npx playwright install ffmpeg
```

3. Optional: create a local environment file from the example defaults:

```bash
copy .env.example .env
```

On macOS or Linux:

```bash
cp .env.example .env
```

## Project layout

- `tests/` — Playwright specs (`*.spec.js`)
- `pages/` — Page Object classes (`*Page.js`)
- `utils/` — Environment helpers, logger, shared test data
- `reports/` — Generated HTML report (`reports/html-report/`) and file logs (`reports/logs/`)
- `fixtures/` — Demo app and tiny Node server used during tests

## Running tests

Run the full suite (starts the demo server automatically unless it is already running):

```bash
npm test
```

Other useful commands:

```bash
npm run test:headed
npm run test:debug
npm run test:ui
```

Open the last HTML report:

```bash
npm run report
```

### Pointing tests at your own application

1. Set `BASE_URL` in `.env` to your environment URL.
2. Set `SKIP_WEB_SERVER=1` so Playwright does not try to start the bundled demo server.
3. Update selectors and flows in `pages/` and data in `utils/test-data.js` to match your UI.

## Failure diagnostics

When a test fails, Playwright keeps:

- **Screenshots** (always on failure) and optional **video** if `PW_RECORD_VIDEO=1` (see `test-results/` and the HTML report)
- **Traces** (`trace: 'retain-on-failure'`) — open from the HTML report for step-by-step replay
- **Structured logs** under `reports/logs/` with timestamps, plus mirrored console output
- **JSON summary** at `reports/test-results.json`

The custom test fixture in `tests/fixtures/customTest.js` logs the start and final status of every test so you can correlate file logs with CI output.

## Configuration highlights

- **Retries**: `retries` defaults to `1` locally and `2` in CI. Override with `PW_RETRIES` (for example `PW_RETRIES=0 npm test`).
- **Environment**: `utils/env.js` reads `BASE_URL`, credentials, log level, and related flags from `process.env` (via `dotenv`).
- **Test data**: `utils/test-data.js` centralizes credentials and expected copy for navigation checks.
- **Video recording**: Off by default so runs do not depend on ffmpeg. Set `PW_RECORD_VIDEO=1` in `.env` after running `npx playwright install ffmpeg`.

## Troubleshooting

### `Failed to launch ... ffmpeg ... ENOENT`

Playwright was trying to run ffmpeg for **video** capture and could not find a valid binary. Common causes:

1. **`PLAYWRIGHT_BROWSERS_PATH`** points at a folder that is not Playwright’s real cache (for example an extracted “ffmpeg-6.0” zip). Remove that user/system environment variable, or set it to a proper `ms-playwright` cache directory.
2. **ffmpeg not installed** for Playwright: run `npx playwright install ffmpeg`.
3. This repo defaults **`video` to `off`** so tests pass without ffmpeg; only set `PW_RECORD_VIDEO=1` when you intend to record video.

### Checking `npm` from PowerShell

Use one of these (note the quoting):

```powershell
& "C:\Program Files\nodejs\npm.cmd" -v
cmd /c '"C:\Program Files\nodejs\npm.cmd" -v'
```

## Demo credentials

For the bundled demo only:

- Username: `admin`
- Password: `admin123`

These match the defaults in `.env.example` and the `/api/login` handler in `fixtures/server.js`.

## License

Use and modify freely for your projects.
