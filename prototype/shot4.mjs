/* 没券时的拉杆（禁用态长什么样） */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');
const OUT = 'E:/Projects/Games/queens-puzzle/prototype/_shots/slot';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox','--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 860, deviceScaleFactor: 2 });
await page.goto('file:///E:/Projects/Games/queens-puzzle/prototype/slot-machine.html?luck=none', { waitUntil:'networkidle0' });
await sleep(400);
for (let i = 0; i < 5; i++) { await page.keyboard.press('Space'); await sleep(3200); }
await sleep(400);
await page.screenshot({ path: OUT + '-empty.png' });

// 杆头特写
const box = await page.$eval('#lever', el => { const r = el.getBoundingClientRect(); return { x: r.x - 40, y: r.y + 40, width: r.width + 60, height: r.height - 20 }; });
await page.setViewport({ width: 420, height: 860, deviceScaleFactor: 3 });
await sleep(200);
await page.screenshot({ path: OUT + '-empty-lever.png', clip: { x: 200, y: box.y, width: 200, height: 200 } });
await browser.close();
