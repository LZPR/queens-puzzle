/* ============================================================================
 * 调水面那套外观时用的拍摄脚本（不是测试）
 * ----------------------------------------------------------------------------
 *   python serve.py --no-open
 *   node tools/shoot-water.mjs
 *
 * 拍：空盘（水位最低）/ 半满 / 满盘（涨到色卡下沿）/ 点下去 0.1s、0.35s、
 * 1.2s 的水线各一张，外加一张 320×640 的矮屏。
 * 改水色、水线、波动参数时先看这几张；断言在 tools/check-effect.mjs（§3.5）。
 * ========================================================================== */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = process.env.QURL || 'http://127.0.0.1:8080/';
const SHOTS = 'E:/Projects/Games/queens-puzzle/tools/shots/';
mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox']
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

await page.goto(URL + '?unlock=all', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0');
await sleep(700);

// 外观面板里选上「水面」
await page.evaluate(() => __QUEENS_DEBUG__.openLook());
await sleep(400);
await page.evaluate(() => document.querySelector('#bgRow [data-bg="tide"]').click());
await sleep(400);
await page.evaluate(() => __QUEENS_DEBUG__.closeLook());
await sleep(600);

/* 水线探针：扫 canvas 的像素，每列找最亮的那一行 —— 那就是白亮的水线。
 * 返回值是设备像素，除以 dpr 就是 CSS px。 */
const probe = () => page.evaluate(() => {
  const rise = document.querySelector('.w-rise');
  const reg = document.getElementById('regions').getBoundingClientRect();
  const bar = document.getElementById('toolbar').getBoundingClientRect();
  const cv = document.querySelector('.w-surf');
  const out = {
    fill: getComputedStyle(document.querySelector('.bg-fx')).getPropertyValue('--fill').trim(),
    surface: Math.round(rise.getBoundingClientRect().top),
    band: [Math.round(reg.bottom), Math.round(bar.top)],
    canvas: cv ? [cv.width, cv.height] : null
  };
  if (!cv) return out;
  const g = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  const px = g.getImageData(0, 0, w, h).data;
  const dpr = cv.height / cv.getBoundingClientRect().height;
  const ys = [];
  for (let c = 0; c < 7; c++) {
    const x = Math.min(w - 1, Math.round((c + 0.5) / 7 * w));
    let best = -1, by = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      const lum = px[i] * .3 + px[i + 1] * .6 + px[i + 2] * .1 + px[i + 3] * .5;
      if (lum > best) { best = lum; by = y; }
    }
    ys.push(+(by / dpr).toFixed(1));
  }
  out.line = ys;
  out.span = +(Math.max(...ys) - Math.min(...ys)).toFixed(1);
  return out;
});

/* 涂到什么程度：0 = 空盘，1 = 满盘 */
async function fillTo(ratio) {
  await page.evaluate((r) => {
    const d = __QUEENS_DEBUG__, n = d.state.size, total = n * n;
    const want = Math.round(total * r);
    for (let i = 0; i < total; i++) d.state.marks[i] = i < want ? 1 : 0;
    d.render();
  }, ratio);
  await sleep(850);   // 水位过渡 0.62s，等它走完再拍
  return probe();
}

console.log('空盘   ', await fillTo(0));
await page.screenshot({ path: SHOTS + 'tide-1-low.png' });
console.log('半满   ', await fillTo(0.5));
await page.screenshot({ path: SHOTS + 'tide-2-half.png' });
console.log('满盘   ', await fillTo(1));
await page.screenshot({ path: SHOTS + 'tide-3-full.png' });

// 点水面：按住左 1/4 处，看波怎么跑
await page.evaluate(() => __QUEENS_DEBUG__.clear());
await sleep(900);
const at = await page.evaluate(() => {
  const r = document.querySelector('.w-surf').getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.28), y: Math.round(r.top + r.height * 0.5) };
});
console.log('静水   ', await probe());
await page.screenshot({ path: SHOTS + 'tide-4-still.png' });

await page.mouse.click(at.x, at.y);
await sleep(110);
console.log('+0.11s ', await probe());
await page.screenshot({ path: SHOTS + 'tide-5-poke.png' });
await sleep(240);
console.log('+0.35s ', await probe());
await page.screenshot({ path: SHOTS + 'tide-6-spread.png' });
await sleep(850);
console.log('+1.2s  ', await probe());
await page.screenshot({ path: SHOTS + 'tide-7-settling.png' });
await sleep(2200);
console.log('+3.4s  ', await probe());
await page.screenshot({ path: SHOTS + 'tide-8-rest.png' });

/* 放皇后：真正解题时水面靠这个涨（不是靠涂格子）。放满 n 颗就是满水 ——
 * 也就是「解开那一刻水位到色卡下沿」这件事的来路。 */
async function queenTo(k) {
  await page.evaluate((k) => {
    const d = __QUEENS_DEBUG__, n = d.state.size, sol = d.state.solution;
    for (let i = 0; i < n * n; i++) d.state.marks[i] = 0;
    const upto = k < 0 ? n : k;
    for (let r = 0; r < upto; r++) d.state.marks[r * n + sol[r]] = 2;
    d.render();
  }, k);
  await sleep(850);
  return probe();
}
console.log('3 颗   ', await queenTo(3));
await page.screenshot({ path: SHOTS + 'tide-10-queens-3.png' });
console.log('全解   ', await queenTo(-1));
await page.screenshot({ path: SHOTS + 'tide-11-solved.png' });

// 矮屏：水位范围是量出来的，这里确认它没涨到色卡后面去
await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(500);
console.log('320 满 ', await fillTo(1));
await page.screenshot({ path: SHOTS + 'tide-9-320.png' });

console.log('\n' + (errs.length ? errs.join('\n') : '(no console errors)'));
await browser.close();
