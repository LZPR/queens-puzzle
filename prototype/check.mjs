/* 原型自检：拉杆阈值、点击即拉、券数、回弹归零 */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = 'file:///E:/Projects/Games/queens-puzzle/prototype/slot-machine.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.setViewport({ width: 420, height: 860 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(400);

const knob = () => page.$eval('#leverKnob', el => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const pull = () => page.$eval('#lever', el => Number(getComputedStyle(el).getPropertyValue('--pull')));
const tickets = () => page.$eval('#ticketsNum', el => Number(el.textContent));

// 1. 拉不够：松手要弹回去，不抽
let k = await knob();
await page.mouse.move(k.x, k.y);
await page.mouse.down();
await page.mouse.move(k.x, k.y + 40, { steps: 8 });
await sleep(60);
const midPull = await pull();
ok(midPull > .15 && midPull < .6, `拉 40px 时应是半程，实际 ${midPull}`);
await page.mouse.up();
await sleep(700);
ok(await pull() < .02, `没拉够应弹回 0，实际 ${await pull()}`);
ok((await tickets()) === 5, '没拉够不该扣券');

// 2. 拉够：要开转、扣券
k = await knob();
await page.mouse.move(k.x, k.y);
await page.mouse.down();
await page.mouse.move(k.x, k.y + 110, { steps: 10 });
await sleep(60);
ok(await pull() > .8, `拉 110px 应该到底，实际 ${await pull()}`);
await page.mouse.up();
await sleep(200);
ok((await tickets()) === 4, '拉够了要扣 1 张券');
ok(await page.$eval('body', el => el.classList.contains('is-spinning')), '应该进入转动中');
await sleep(3700);
ok(!(await page.$eval('body', el => el.classList.contains('is-spinning'))), '转完要退出转动中');
ok(await pull() < .02, '转完杆子要回位');
ok((await page.$eval('#prizeBar', el => el.dataset.tone)) !== 'idle', '奖品条要出结果');

// 2b. 三轮停下的间隔（悬念长度）：各轮落点时间差要够大
await page.waitForFunction(() => !document.querySelector('.reel.is-hit'), { timeout: 6000 });
const marksP = page.evaluate(() => new Promise(res => {
  const t0 = performance.now();
  const first = [null, null, null];
  const els = Array.from(document.querySelectorAll('.reel'));
  const id = setInterval(() => {
    els.forEach((r, i) => { if (first[i] === null && r.classList.contains('is-hit')) first[i] = Math.round(performance.now() - t0); });
    if (first.every(x => x !== null)) { clearInterval(id); res(first); }
  }, 20);
  setTimeout(() => { clearInterval(id); res(first); }, 6000);
}));
// 2c. 模糊必须跟着速度走：起速要有模糊，慢下来必须看清
const blurP = page.evaluate(() => new Promise(res => {
  const s = document.querySelectorAll('.strip')[0];
  const t0 = performance.now();
  const out = [];
  const id = setInterval(() => {
    const t = performance.now() - t0;
    const m = getComputedStyle(s).filter.match(/blur\(([\d.]+)px\)/);
    out.push([Math.round(t), m ? Number(m[1]) : 0]);
    if (t > 1300) { clearInterval(id); res(out); }
  }, 20);
}));
await page.keyboard.press('Space');
const marks = await marksP;
const blur = await blurP;
ok(marks[1] - marks[0] >= 420, `第一轮与第二轮落点差 ${marks[1] - marks[0]}ms，太挤`);
ok(marks[2] - marks[1] >= 420, `第二轮与第三轮落点差 ${marks[2] - marks[1]}ms，太挤`);

const peakBlur = Math.max(...blur.map(x => x[1]));
const tailBlur = Math.max(...blur.filter(x => x[0] > 620).map(x => x[1]));
ok(peakBlur >= 1.5, `起速时该有模糊，实测最高才 ${peakBlur}px`);
ok(tailBlur <= .8, `慢下来后还糊着：落点前最高 ${tailBlur}px`);
await sleep(2000);

// 3. 点一下拉杆 = 拉到底
k = await knob();
await page.mouse.click(k.x, k.y);
await sleep(200);
ok((await tickets()) === 2, '点一下也要抽');
await sleep(3700);

// 4. 用完 3 张：出补充按钮、杆子变灰
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Space');
  await sleep(3700);
}
ok((await tickets()) === 0, '应该抽到 0 张');
ok(await page.$eval('#refillBtn', el => !el.hidden), '0 张时要出补充按钮');
ok(await page.$eval('#lever', el => el.classList.contains('is-empty')), '0 张时杆子要变灰');
await page.keyboard.press('Space');
await sleep(300);
ok((await tickets()) === 0, '0 张时不该再扣');

await page.click('#refillBtn');
await sleep(200);
ok((await tickets()) === 5, '补充后回到 5 张');

// 4b. 「差一点就中」才拉长最后一轮，而且是真的在「慢慢滚」
await page.goto(URL + '?luck=nearmiss', { waitUntil: 'networkidle0' });
await sleep(600);
await page.waitForFunction(() => !document.querySelector('.reel.is-hit'), { timeout: 6000 });
const nmP = page.evaluate(() => new Promise(res => {
  const t0 = performance.now();
  const els = Array.from(document.querySelectorAll('.reel'));
  const strip = document.querySelectorAll('.strip')[2];
  const first = [null, null, null];
  const pos = [];
  const id = setInterval(() => {
    const t = Math.round(performance.now() - t0);
    els.forEach((r, i) => { if (first[i] === null && r.classList.contains('is-hit')) first[i] = t; });
    const m = getComputedStyle(strip).transform.match(/matrix\(([^)]+)\)/);
    pos.push([t, m ? Math.abs(parseFloat(m[1].split(',')[5])) : 0]);
    if (first.every(x => x !== null)) { clearInterval(id); res({ first, pos }); }
  }, 40);
  setTimeout(() => { clearInterval(id); res({ first, pos }); }, 8000);
}));
await page.keyboard.press('Space');
const nm = await nmP;
const nmGap = nm.first[2] - nm.first[1];
ok(nmGap >= 700 && nmGap <= 950, `近失轮的时长该和普通局一致（约 780ms 差），实测 ${nmGap}ms`);
ok(marks[2] - marks[1] <= 1100, `普通局的第三轮不该也这么慢，实测 ${marks[2] - marks[1]}ms`);

// 慢滚那 1 秒里，速度要稳在「看得见」的区间（约 1 格/秒），不能停下来
const posAt = ms => {
  const row = nm.pos.find(r => r[0] >= ms);
  return row ? row[1] : nm.pos[nm.pos.length - 1][1];
};
// 窗口钉在匀速段上：第三轮起飞 → 1000–2000ms 是慢滚，取 1100–1900 整段
const t3 = Math.max(0, nm.first[2] - 2400);
const crawlFrom = t3 + 1100;
const crawlTo = t3 + 1900;
const crawl = (posAt(crawlTo) - posAt(crawlFrom)) / (crawlTo - crawlFrom);
ok(crawl > .035 && crawl < .16, `慢滚速度该约 1 格/秒，实测 ${crawl.toFixed(3)}px/ms`);
const crawlDist = posAt(crawlTo) - posAt(crawlFrom);
ok(crawlDist > 40, `慢滚这 0.8 秒该真的滚近一格，实测 ${crawlDist.toFixed(0)}px`);
// 2000ms 之后就该收住，不该还在匀速往前跑
const late = (posAt(t3 + 2350) - posAt(t3 + 2050)) / 300;
ok(late < crawl * .55, `慢滚 1 秒后该收住，实测末段 ${late.toFixed(3)}px/ms`);
await sleep(600);

// 5. 尺寸自检
const geo = await page.$$eval('.reel', els => els.map(e => {
  const sym = e.querySelector('.sym');
  return { h: Math.round(e.getBoundingClientRect().height), cell: Math.round(sym.getBoundingClientRect().height) };
}));
ok(geo.every(r => Math.abs(r.h - r.cell * 3) <= 1), '转轮高度应正好是 3 格');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 0, `横向不该溢出，实际多出 ${overflow}px`);

console.log(JSON.stringify({ errs, fail, geo, marks, nearMiss: {
  gapMs: nmGap, crawlPxPerMs: +crawl.toFixed(3), crawlDistPx: Math.round(crawlDist),
} }, null, 2));
await browser.close();
if (fail.length || errs.length) process.exit(1);
