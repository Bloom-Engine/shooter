// SH-054 — headless boot check for the web build.
//
// Serves nothing itself: run `./tools/build-web.sh` first and keep
// `python -m http.server 8080` alive in dist/web (or use --serve).
//
//   bun tools/web-check.ts [--timeout 180] [--url http://localhost:8080/]
//
// Drives Edge (Chromium) headless with WebGPU, captures console/page errors
// and failed requests, waits for the engine-ready and first-frame markers,
// then screenshots to tools/.testout/web-boot.png. Exit 0 = booted with no
// page errors. Modeled on jump's tools/headless-check.js — same rule: never
// page.evaluate() against the rAF-monopolizing game loop.

import puppeteer from 'puppeteer-core';

const argv = process.argv.slice(2);
function flag(name: string, dflt: string): string {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
}
const URL = flag('--url', 'http://localhost:8080/');
const TIMEOUT_S = parseInt(flag('--timeout', '180'), 10);

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const { existsSync, mkdirSync } = await import('node:fs');
const exe = EDGE_PATHS.find((p) => existsSync(p));
if (!exe) { console.error('no Edge/Chrome found'); process.exit(2); }

mkdirSync('tools/.testout', { recursive: true });

// Hard-kill timer so a hung boot never leaves a zombie browser.
const killer = setTimeout(() => {
  console.error(`TIMEOUT after ${TIMEOUT_S}s`);
  process.exit(3);
}, TIMEOUT_S * 1000);

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-gpu',
    '--window-size=1280,720',
    '--disable-dev-shm-usage',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

let sawReady = false;
let pageErrors = 0;
const lines: string[] = [];
page.on('console', (msg) => {
  const t = msg.text();
  // Perry's runtime can be chatty; keep everything except per-frame spam.
  if (t.startsWith('mem_call') || t.startsWith('  result:')) return;
  lines.push(`[console:${msg.type()}] ${t}`);
  console.log(`[console:${msg.type()}] ${t}`);
  if (t.includes('engine + FFI ready')) sawReady = true;
});
page.on('pageerror', (err) => {
  pageErrors++;
  console.log('[pageerror]', err.message);
});
page.on('requestfailed', (req) => {
  console.log('[requestfailed]', req.url(), req.failure()?.errorText);
});
page.on('response', (res) => {
  if (res.status() >= 400) console.log('[http ' + res.status() + ']', res.url());
});

console.log('opening', URL, 'with', exe);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Wait for the loading indicator to disappear = glue saw the first game
// frame. waitForSelector on removal is DOM-only — safe against the rAF loop.
let firstFrame = false;
try {
  await page.waitForSelector('#loading', { hidden: true, timeout: (TIMEOUT_S - 20) * 1000 });
  firstFrame = true;
} catch {
  console.log('loading indicator never disappeared');
}

// Let a few frames render before the screenshot.
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: 'tools/.testout/web-boot.png' });
console.log('screenshot -> tools/.testout/web-boot.png');

console.log(`RESULT ready=${sawReady} firstFrame=${firstFrame} pageErrors=${pageErrors}`);
clearTimeout(killer);
// Print before close — closing can hang against a busy page (jump's note).
const ok = sawReady && firstFrame && pageErrors === 0;
process.exitCode = ok ? 0 : 1;
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(ok ? 0 : 1);
