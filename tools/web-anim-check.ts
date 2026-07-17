// Capture a walk cycle: hold W, screenshot 3 frames ~250ms apart.
// A skinned model on the wrong joint offset holds one pose forever.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#loading', { hidden: true, timeout: 240000 });
await new Promise((r) => setTimeout(r, 2000));
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 3000));
await page.keyboard.down('KeyW');
for (let i = 1; i <= 3; i++) {
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: `tools/.testout/web-walk-${i}.png` });
}
await page.keyboard.up('KeyW');
console.log('captured');
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(0);
