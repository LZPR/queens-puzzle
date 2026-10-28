/* ============================================================================
 * 把水面那条线放大看清楚（不是测试）
 * ----------------------------------------------------------------------------
 *   python serve.py --no-open
 *   node tools/zoom-water.mjs
 *
 * 拍三张 4 倍放大的特写（视野只有水面上下 90px）到 tools/shots/：
 * 静水 / 点下去 90ms / 再等 260ms。判断「像不像水」「有没有接缝」全靠这三张 ——
 * 整页截图上看不出那 1px 的色差和那道衬线。
 * 断言在 tools/check-effect.mjs（§3.5 / §3.6），这里只管「长什么样」。
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
page.on('pageerror', e => console.log('pageerror: ' + e.message));
// dpr 4：一张 390 CSS 宽的特写就是 1560px，够数清那条线有几像素
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 4, isMobile: true, hasTouch: true });
await page.goto(URL + '?unlock=all', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0');
await sleep(600);

await page.evaluate(() => __QUEENS_DEBUG__.openLook());
await sleep(300);
await page.evaluate(() => document.querySelector('#bgRow [data-bg="tide"]').click());
await sleep(300);
await page.evaluate(() => __QUEENS_DEBUG__.closeLook());
await sleep(800);
// 涂满：水位涨到色卡下沿，那才是水面最宽、看得最清的时候
await page.evaluate(() => {
  const d = __QUEENS_DEBUG__, total = d.state.size * d.state.size;
  for (let i = 0; i < total; i++) d.state.marks[i] = 1;
  d.render();
});
await sleep(900);

const clip = { x: 0, y: 580, width: 390, height: 90 };
await page.screenshot({ path: SHOTS + 'tide-zoom-rest.png', clip });

await page.mouse.click(120, 610);
await sleep(90);
await page.screenshot({ path: SHOTS + 'tide-zoom-poke.png', clip });
await sleep(260);
await page.screenshot({ path: SHOTS + 'tide-zoom-spread.png', clip });
console.log('ok: tide-zoom-rest / -poke / -spread');
await browser.close();
