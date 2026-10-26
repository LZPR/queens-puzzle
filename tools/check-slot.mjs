/* ============================================================================
 * 每日挑战 · 首通抽奖（老虎机面板）
 *
 *   python serve.py --no-open
 *   node tools/check-slot.mjs
 *
 * 规矩：
 *   · 第一次解开某一挡的每日挑战，结算界面出现「抽一次奖」；
 *   · 抽奖面板：机器摆好一盘（三转轮各三格）、拉杆能抽、空格也能抽；
 *   · 抽完立刻记账（queens.dailydraw.v1），收下回结算界面、按钮消失；
 *   · 重复游玩同一挡不再给抽；
 *   · ?luck=jackpot 钉死档位：传说档要点亮奖品条并放礼花；
 *   · ?slot=easy|mid|hard|extreme 开机直接开面板（测试模式，抽了不记账）。
 * ========================================================================== */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = process.env.QURL || 'http://127.0.0.1:8080/';
const SHOTS = 'E:/Projects/Games/queens-puzzle/tools/shots/';
mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; console.log('  PASS  ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
  else { fail++; console.log('  FAIL  ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox']
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

async function jsClick(sel) {
  const done = await page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return 'missing:' + s;
    el.click();
    return 'ok';
  }, sel);
  if (done !== 'ok') throw new Error(done);
}

/* 开一盘每日挑战并解掉它（照抄 check-daily 的路子：填好解、聚焦最后一格、按 Q） */
async function winDaily(tier) {
  await page.evaluate(t => { __QUEENS_DEBUG__.startDaily(t); }, tier);
  await page.waitForFunction(t => {
    const st = __QUEENS_DEBUG__.state;
    return st.daily && st.daily.tier === t && st.regions && st.regions.length > 0;
  }, { timeout: 40000 }, tier);
  await sleep(350);
  await page.evaluate(() => {
    const d = __QUEENS_DEBUG__, n = d.state.size;
    d.state.marks.fill(0);
    for (let r = 0; r < n - 1; r++) d.state.marks[r * n + d.state.solution[r]] = 2;
    d.render(false);
    const last = (n - 1) * n + d.state.solution[n - 1];
    d.state.focus = last;
    const cells = document.querySelectorAll('.cell');
    for (let i = 0; i < cells.length; i++) cells[i].tabIndex = i === last ? 0 : -1;
    cells[last].focus();
  });
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => __QUEENS_DEBUG__.state.status === 'won', { timeout: 10000 });
  await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'result', { timeout: 10000 });
  await sleep(400);
}

const sheet = () => page.evaluate(() => __QUEENS_DEBUG__.sheet());
const probe = () => page.evaluate(() => __QUEENS_DEBUG__.slot());
const drawn = () => page.evaluate(() => __QUEENS_DEBUG__.dailyDrawn());

console.log('\n--- 0. 干净起步 ---');
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0',
  { timeout: 20000 });

console.log('\n--- 1. 首通「容易」：结算界面送一次抽奖 ---');
await winDaily('easy');
let btn = await page.evaluate(() => {
  const b = document.getElementById('btnDraw');
  return b ? { hidden: b.hidden, text: b.textContent.trim() } : null;
});
ok('结算卡上有「抽一次奖」', !!btn && !btn.hidden && btn.text === '抽一次奖', btn);

console.log('\n--- 2. 进抽奖面板：机器摆好，还没抽 ---');
await jsClick('#btnDraw');
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'slot', { timeout: 5000 });
await sleep(500);
let p = await probe();
ok('结算层收掉了、抽奖层开着', (await sheet()) === 'slot', await sheet());
ok('三条转轮都摆好了（各 3 格）', p.reels.length === 3 && p.reels.every(n => n === 3), p.reels);
ok('奖品条是待机档', p.tone === 'idle', p.tone);
ok('拉杆拿得到焦点', await page.evaluate(() =>
  document.getElementById('slotLeverKnob').tabIndex === 0));
await page.screenshot({ path: `${SHOTS}/slot-1-open.png` });

console.log('\n--- 3. 空格开抽：转完出结果、记账 ---');
await page.keyboard.press('Space');
await page.waitForFunction(() => {
  const s = __QUEENS_DEBUG__.slot();
  return s.busy === false && s.tone !== 'idle' && s.tone !== 'spinning';
}, { timeout: 15000 });
p = await probe();
ok('出了结果档位', ['lose', 'half', 'prize', 'legend'].includes(p.tone), p.tone);
let d = await drawn();
ok('「容易」记成抽过了', !!d.easy, JSON.stringify(d));
await page.screenshot({ path: `${SHOTS}/slot-2-done.png` });

console.log('\n--- 4. 收下：回结算界面，按钮消失 ---');
await jsClick('#btnSlotDone');
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'result', { timeout: 5000 });
btn = await page.evaluate(() => document.getElementById('btnDraw').hidden);
ok('回到结算界面', (await sheet()) === 'result', await sheet());
ok('抽奖按钮收掉了', btn === true, btn);

console.log('\n--- 5. 重复游玩同一挡：不再给抽 ---');
await winDaily('easy');
btn = await page.evaluate(() => document.getElementById('btnDraw').hidden);
ok('再通一次「容易」，没有抽奖按钮', btn === true, btn);
ok('抽奖记录还是只有「容易」一次', Object.keys(await drawn()).length === 1, await drawn());
await page.screenshot({ path: `${SHOTS}/slot-3-repeat.png` });

console.log('\n--- 6. ?luck=jackpot：传说档点亮奖品条 ---');
await page.evaluate(() => {
  // 种一份「容易 + 中等都完成过」的记录，中等就是完成未抽的状态
  const day = __QUEENS_DEBUG__.daily().day;
  localStorage.removeItem('queens.dailydraw.v1');
  localStorage.setItem('queens.daily.v1', JSON.stringify({
    v: 1,
    days: { [day]: { easy: { ms: 60000, st: 10, at: 1 }, mid: { ms: 90000, st: 20, at: 1 } } }
  }));
});
await page.goto(URL + '?luck=jackpot', { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0',
  { timeout: 20000 });
await winDaily('mid');
btn = await page.evaluate(() => !document.getElementById('btnDraw').hidden);
ok('「中等」完成未抽，按钮在', btn === true, btn);
await jsClick('#btnDraw');
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'slot', { timeout: 5000 });
await sleep(500);
await page.keyboard.press('Space');
await page.waitForFunction(() => {
  const s = __QUEENS_DEBUG__.slot();
  return s.busy === false && s.tone !== 'idle' && s.tone !== 'spinning';
}, { timeout: 15000 });
p = await probe();
ok('钉死 jackpot → 传说档', p.tone === 'legend', p.tone);
d = await drawn();
ok('「中等」记成抽过了', !!d.mid, JSON.stringify(d));
await page.screenshot({ path: `${SHOTS}/slot-4-jackpot.png` });

console.log('\n--- 7. ?slot=hard：直接开面板的测试模式 ---');
// 前面留下的已解开局会被 boot 恢复成结算层，?slot= 会礼让几拍再接管——
// 这正是要测的行为：等它开出来就行。
await page.goto(URL + '?slot=hard&luck=triple', { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0',
  { timeout: 20000 });
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'slot', { timeout: 6000 });
await sleep(500);
p = await probe();
ok('开机直接进抽奖面板', (await sheet()) === 'slot', await sheet());
ok('奖品条待机', p.tone === 'idle', p.tone);
const noteTxt = await page.evaluate(() => document.getElementById('slotNote').textContent);
ok('副标题是测试模式口径', noteTxt.includes('测试模式') && noteTxt.includes('困难'), noteTxt);
await page.keyboard.press('Space');
await page.waitForFunction(() => {
  const s = __QUEENS_DEBUG__.slot();
  return s.busy === false && s.tone !== 'idle' && s.tone !== 'spinning';
}, { timeout: 15000 });
p = await probe();
ok('?luck=triple 钉成中奖档', p.tone === 'prize', p.tone);
d = await drawn();
// 账本里 easy/mid 是前几节记下的；「困难」这次抽了不许记
ok('测试模式抽了不记账', !d.hard, JSON.stringify(d));
await jsClick('#btnSlotDone');
await sleep(400);
ok('收下后不回结算层（本来就没有这一局）', (await sheet()) === null, await sheet());
await page.screenshot({ path: `${SHOTS}/slot-5-urltest.png` });

console.log('\n--- 8. 页面无报错 ---');
ok('没有 pageerror / console.error', errs.length === 0, errs);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
