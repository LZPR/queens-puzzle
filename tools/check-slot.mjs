/* ============================================================================
 * 每日挑战 · 首通抽奖（老虎机面板）
 *
 *   python serve.py --no-open
 *   node tools/check-slot.mjs
 *
 * 规矩：
 *   · 第一次解开某一挡的每日挑战，结算界面出现「抽一次奖」；
 *   · 抽奖面板：机器摆好一盘（三转轮各三格）、拉杆能抽、空格也能抽；
 *   · 奖品是外观（core/unlock.js 账本）：三个一样解锁那套；两个一样送一次再抽；
 *     抽中已解锁的也送一次再抽；都解锁了转不出任何奖励；
 *   · 送的那次不销资格：markDrawn 只在落定（谢谢参与 / 解锁 / 全解锁）时记，
 *     中途收掉面板，回来结算界面的抽奖按钮还在；
 *   · ?luck=unlock|repeat|pair|none 钉死第一抽的档位（只钉一抽）；
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
const unlocked = () => page.evaluate(() => __QUEENS_DEBUG__.lookUnlocked());
const boot = async url => {
  await page.goto(url || URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0',
    { timeout: 20000 });
};
/* 一直抽到落定（两个一样 / 已解锁会送再抽），最多十杆防呆 */
async function pullUntilDone() {
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Space');
    await page.waitForFunction(() => {
      const s = __QUEENS_DEBUG__.slot();
      return s.busy === false && s.tone !== 'idle' && s.tone !== 'spinning';
    }, { timeout: 15000 });
    const p = await probe();
    if (p.tone !== 'half') return p;
  }
  return probe();
}

console.log('\n--- 0. 干净起步 ---');
await boot();
await page.evaluate(() => localStorage.clear());
await boot();

console.log('\n--- 1. ?luck=none：谢谢参与，抽了就记账，外观全还锁着 ---');
await boot(URL + '?luck=none');
await winDaily('easy');
let btn = await page.evaluate(() => {
  const b = document.getElementById('btnDraw');
  return b ? { hidden: b.hidden, text: b.textContent.trim() } : null;
});
ok('结算卡上有「抽一次奖」', !!btn && !btn.hidden && btn.text === '抽一次奖', btn);
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
await page.keyboard.press('Space');
await page.waitForFunction(() => {
  const s = __QUEENS_DEBUG__.slot();
  return s.busy === false && s.tone !== 'idle' && s.tone !== 'spinning';
}, { timeout: 15000 });
p = await probe();
ok('钉死 none → 谢谢参与', p.tone === 'lose', p.tone);
ok('「容易」记成抽过了', !!(await drawn()).easy, JSON.stringify(await drawn()));
ok('外观账本没动（只有每类第一套开着）', Object.keys((await unlocked()).surface).length === 1 &&
  Object.keys((await unlocked()).mark).length === 1, await unlocked());
await page.screenshot({ path: `${SHOTS}/slot-2-none.png` });

console.log('\n--- 2. 收下：回结算界面，按钮消失 ---');
await jsClick('#btnSlotDone');
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'result', { timeout: 5000 });
btn = await page.evaluate(() => document.getElementById('btnDraw').hidden);
ok('回到结算界面', (await sheet()) === 'result', await sheet());
ok('抽奖按钮收掉了', btn === true, btn);

console.log('\n--- 3. ?luck=pair：两个一样送再抽，资格先不销 ---');
await boot(URL + '?luck=pair');
await winDaily('mid');
await jsClick('#btnDraw');
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'slot', { timeout: 5000 });
await sleep(500);
await page.keyboard.press('Space');
await page.waitForFunction(() => {
  const s = __QUEENS_DEBUG__.slot();
  return s.busy === false && s.tone !== 'idle' && s.tone !== 'spinning';
}, { timeout: 15000 });
p = await probe();
ok('钉死 pair → 浅黄的「再抽一次」档', p.tone === 'half', p.tone);
ok('送再抽的那下不记账', !(await drawn()).mid, JSON.stringify(await drawn()));
await page.screenshot({ path: `${SHOTS}/slot-3-again.png` });
// 中途收掉：资格还在，回来结算界面的按钮还亮着
await jsClick('#btnSlotDone');
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'result', { timeout: 5000 });
btn = await page.evaluate(() => document.getElementById('btnDraw').hidden);
ok('没抽完就收下，按钮还在', btn === false, btn);
// 再进来接着抽，抽到落定为止
await jsClick('#btnDraw');
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'slot', { timeout: 5000 });
await sleep(500);
p = await pullUntilDone();
ok('链条总能落定（谢谢参与或解锁）', ['lose', 'prize', 'done'].includes(p.tone), p.tone);
ok('落定了才记账', !!(await drawn()).mid, JSON.stringify(await drawn()));
await page.screenshot({ path: `${SHOTS}/slot-4-chain.png` });

console.log('\n--- 4. ?luck=unlock：三个一样解锁对应外观 ---');
await boot(URL + '?luck=unlock');
// 前一节的随机链条可能顺手解锁过谁；清空账本，「奖池头一套锁着的」才是确定的「自然」
await page.evaluate(() => { __QUEENS_DEBUG__.lookClear(); });
await winDaily('hard');
await jsClick('#btnDraw');
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'slot', { timeout: 5000 });
await sleep(500);
await page.keyboard.press('Space');
await page.waitForFunction(() => {
  const s = __QUEENS_DEBUG__.slot();
  return s.busy === false && s.tone !== 'idle' && s.tone !== 'spinning';
}, { timeout: 15000 });
p = await probe();
ok('钉死 unlock → 大奖档', p.tone === 'prize', p.tone);
ok('奖品条上写着「解锁」', /解锁/.test(p.prize), p.prize);
ok('「困难」记成抽过了', !!(await drawn()).hard, JSON.stringify(await drawn()));
const led = await unlocked();
ok('奖池头一套锁着的外观（自然）进了账本',
  led.surface.nature === true && led.surface.sky !== true, led.surface);
await page.screenshot({ path: `${SHOTS}/slot-5-unlock.png` });
// 外观面板里：解锁的那套摘了锁，别的还锁着（浮层互斥，先收下抽奖再开展柜）
await jsClick('#btnSlotDone');
await sleep(500);
await page.evaluate(() => { __QUEENS_DEBUG__.openLook(); });
await page.waitForFunction(() => !document.getElementById('lookWrap').hidden, { timeout: 5000 });
await sleep(320);
const lk = await page.evaluate(() => {
  const get = k => [...document.querySelectorAll('#' + k + 'Row .showcase')]
    .map(b => ({ id: b.dataset[k], locked: b.classList.contains('is-lock' + 'ed') }));
  return { surface: get('surface'), mark: get('mark'), piece: get('piece'), life: get('life') };
});
ok('「自然」解锁后摘了小锁', lk.surface.find(x => x.id === 'nature').locked === false);
ok('其它没抽到的还锁着',
  lk.surface.filter(x => x.id !== 'geo' && x.id !== 'nature').every(x => x.locked) &&
  lk.mark.every(x => x.locked === (x.id !== 'x')) &&
  lk.piece.every(x => x.locked === (x.id !== 'queen')) &&
  lk.life.every(x => x.locked === (x.id !== 'heart')), lk);
await page.keyboard.press('Escape');
await sleep(300);

console.log('\n--- 5. 抽中已解锁的（占位小份）：也送一次再抽 ---');
// 「自然」已经解开了，但奖池里占位的还有每类的第一套；?luck=repeat 钉死这一种
await page.evaluate(() => { __QUEENS_DEBUG__.dailyDrawClear(); });
await boot(URL + '?luck=repeat');
await winDaily('hard');
await jsClick('#btnDraw');
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'slot', { timeout: 5000 });
await sleep(500);
await page.keyboard.press('Space');
await page.waitForFunction(() => {
  const s = __QUEENS_DEBUG__.slot();
  return s.busy === false && s.tone !== 'idle' && s.tone !== 'spinning';
}, { timeout: 15000 });
p = await probe();
ok('三个一样但那套已解锁 → 也送再抽', p.tone === 'half', p.tone);
ok('这一下同样不记账', !(await drawn()).hard, JSON.stringify(await drawn()));
ok('奖品条说明「已经解锁」', /已经解锁/.test(p.prize), p.prize);
await page.screenshot({ path: `${SHOTS}/slot-6-repeat.png` });
// 接着抽到落定
p = await pullUntilDone();
ok('链条落定', ['lose', 'prize', 'done'].includes(p.tone), p.tone);
ok('落定了记账', !!(await drawn()).hard, JSON.stringify(await drawn()));

console.log('\n--- 6. 外观全都解锁了：转不出任何奖励 ---');
await boot();
await page.evaluate(() => {
  __QUEENS_DEBUG__.lookUnlockAll();
  __QUEENS_DEBUG__.dailyDrawClear();
});
await winDaily('mid');
await jsClick('#btnDraw');
await page.waitForFunction(() => __QUEENS_DEBUG__.sheet() === 'slot', { timeout: 5000 });
await sleep(500);
await page.keyboard.press('Space');
await page.waitForFunction(() => {
  const s = __QUEENS_DEBUG__.slot();
  return s.busy === false && s.tone !== 'idle' && s.tone !== 'spinning';
}, { timeout: 15000 });
p = await probe();
ok('都抽完了 → 「全都解锁」档', p.tone === 'done', p.tone);
ok('奖品条明说没有奖励', /全都解锁/.test(p.prize), p.prize);
ok('照样记账（这一挡抽过了）', !!(await drawn()).mid, JSON.stringify(await drawn()));
await page.screenshot({ path: `${SHOTS}/slot-7-done.png` });
await jsClick('#btnSlotDone');
await sleep(400);

console.log('\n--- 7. ?slot=hard：直接开面板的测试模式 ---');
// 前面留下的已解开局会被 boot 恢复成结算层，?slot= 会礼让几拍再接管——
// 这正是要测的行为：等它开出来就行。
await boot(URL + '?slot=hard&luck=unlock');
// 前几节把「困难」抽过了、第 6 节还把外观全解开了；账都清掉，
// 才能验证「钉死 unlock 真落在大奖档」「测试模式这一抽没记上新账」
await page.evaluate(() => {
  __QUEENS_DEBUG__.lookClear();
  __QUEENS_DEBUG__.dailyDrawClear();
});
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
ok('?luck=unlock 钉成大奖档', p.tone === 'prize', p.tone);
// 账本里前面几节已经解开了自然等；「困难」这次抽了不许记
ok('测试模式抽了不记账', !(await drawn()).hard, JSON.stringify(await drawn()));
await jsClick('#btnSlotDone');
await sleep(400);
ok('收下后不回结算层（本来就没有这一局）', (await sheet()) === null, await sheet());
await page.screenshot({ path: `${SHOTS}/slot-8-urltest.png` });

console.log('\n--- 8. 页面无报错 ---');
ok('没有 pageerror / console.error', errs.length === 0, errs);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
