/* 拉杆特写 + 模糊自检 */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = 'file:///E:/Projects/Games/queens-puzzle/prototype/slot-machine.html';
const OUT = 'E:/Projects/Games/queens-puzzle/prototype/_shots/slot';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 860, deviceScaleFactor: 3 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 500));

const leverBox = await page.$eval('#lever', el => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const clip = { x: leverBox.x - 70, y: leverBox.y - 10, width: leverBox.width + 80, height: leverBox.height + 30 };
await page.screenshot({ path: OUT + '-lever-rest.png', clip });

const knob = await page.$eval('#leverKnob', el => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(knob.x, knob.y);
await page.mouse.down();
await page.mouse.move(knob.x - 4, knob.y + 62, { steps: 10 });
await page.screenshot({ path: OUT + '-lever-mid.png', clip });
await page.mouse.up();

// 转动中：读 filter 真值 + 拍一张
await new Promise(r => setTimeout(r, 300));
const blurNow = await page.evaluate(() => {
  const s = document.querySelectorAll('.strip')[0];
  return { filter: getComputedStyle(s).filter, anims: s.getAnimations().length };
});
await page.screenshot({ path: OUT + '-spin-blur.png', clip: { x: 0, y: 100, width: 420, height: 340 } });

console.log(JSON.stringify({ blurNow, clip }, null, 2));
await browser.close();
