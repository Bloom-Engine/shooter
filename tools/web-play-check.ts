// SH-054 — drive the web build into gameplay: boot, press Enter on PLAY,
// let the run start, screenshot. Real CDP key events (reach the DOM like a
// player's keyboard). No page.evaluate against the busy page.
import puppeteer from 'puppeteer-core';
const { existsSync, mkdirSync } = await import('node:fs');
const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))!;
mkdirSync('tools/.testout', { recursive: true });
const killer = setTimeout(() => { console.error('TIMEOUT'); process.exit(3); }, 300000);
const browser = await puppeteer.launch({
  executablePath: exe, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
let errors = 0;
page.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('[jolt]') || (m.type() === 'error' && !t.includes('favicon'))) console.log('[console]', t.slice(0, 900));
});
await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#loading', { hidden: true, timeout: 240000 });
console.log('booted; menu up');
await new Promise((r) => setTimeout(r, 2000));
// Short tap so key autorepeat doesn't double-confirm (jump's lesson).
await page.keyboard.down('Enter');
await new Promise((r) => setTimeout(r, 60));
await page.keyboard.up('Enter');
console.log('pressed PLAY');
await new Promise((r) => setTimeout(r, 4000));
await page.screenshot({ path: 'tools/.testout/web-play-1.png' });
// Walk forward + look around a moment, then fire.
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 1500));
await page.keyboard.up('KeyW');
await page.mouse.move(640, 360);
await page.mouse.down();
await new Promise((r) => setTimeout(r, 400));
await page.mouse.up();
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: 'tools/.testout/web-play-2.png' });
console.log(`RESULT pageErrors=${errors}`);
clearTimeout(killer);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(errors ? 1 : 0);
