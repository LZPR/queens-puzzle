/* 原型截图：node prototype/shot.mjs */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = 'file:///E:/Projects/Games/queens-puzzle/prototype/slot-machine.html';
const OUT = 'E:/Projects/Games/queens-puzzle/prototype/_shots/slot';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--allow-file-access-from-files', '--force-color-profile=srgb'],
});

const page = await browser.newPage();
await page.setViewport({ width: 420, height: 860, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 600));

await page.screenshot({ path: OUT + '-idle.png' });

// 拖动拉杆到底的一半，看拖动中的手感
const box = await page.$eval('#leverKnob', el => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.mouse.move(box.x - 6, box.y + 70, { steps: 12 });
await page.screenshot({ path: OUT + '-drag.png' });
await page.mouse.move(box.x - 10, box.y + 200, { steps: 10 });
await page.screenshot({ path: OUT + '-pulled.png' });
await page.mouse.up();

await new Promise(r => setTimeout(r, 260));
await page.screenshot({ path: OUT + '-spin-fast.png' });   // 刚起速：该糊
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: OUT + '-spin.png' });        // 慢下来：该看清了

await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: OUT + '-suspense.png' });   // 两轮停、第三轮还在转
await new Promise(r => setTimeout(r, 1800));
await page.screenshot({ path: OUT + '-result.png' });

// 窄屏
await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2 });
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: OUT + '-360.png' });

// 命中测试：杆子中心点是不是真的能点到（有没有被别的东西盖住）
const hit = await page.evaluate(() => {
  const k = document.getElementById('leverKnob');
  const r = k.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { w: Math.round(r.width), h: Math.round(r.height), topEl: top ? top.id || top.className : null };
});

console.log(JSON.stringify({ errs, hit }, null, 2));
await browser.close();
