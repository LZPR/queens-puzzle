/* 中奖 / 大奖 两张定妆照 */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');
const OUT = 'E:/Projects/Games/queens-puzzle/prototype/_shots/slot';
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--allow-file-access-from-files'] });
const errs = [];

for (const luck of ['triple', 'jackpot', 'pair']) {
  const page = await browser.newPage();
  page.on('pageerror', e => errs.push(luck + ': ' + e.message));
  await page.setViewport({ width: 420, height: 860, deviceScaleFactor: 2 });
  await page.goto('file:///E:/Projects/Games/queens-puzzle/prototype/slot-machine.html?luck=' + luck, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 400));
  await page.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 2700));
  await page.screenshot({ path: `${OUT}-win-${luck}.png` });
}
console.log(JSON.stringify(errs));
await browser.close();
