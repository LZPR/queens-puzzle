/* ============================================================================
 * 色块「放好了」不许动底色（回归：整块被洗白 / 天空主题图案消失）
 *
 *   python serve.py --no-open
 *   node tools/check-region-wash.mjs
 *
 * 事故：以前 render 给「这块已经有皇后」的整块格子挂 .r-ok，CSS 拿
 * linear-gradient(rgba(255,255,255,.22)) 把底色洗白一档。图案的墨色是照
 * **原始底色**算出来的（game/skin.js 的 shadeOf / tintOf），底色一变，
 * 图案跟底色的差就没了 —— 天空那套是朝纸白提亮的，洗完直接跟底色贴成一片，
 * 整块的图案凭空消失；压暗的那几套也像这块掉色了。
 *
 * 规矩：摆皇后只该在那一格上留一只皇后。**任何一格的底色、图案色、图案本身
 * 都不能因为「这块有皇后了」而变**。「这块放好了」由色卡上的 ✓ 来说。
 *
 * 覆盖：5 套色块主题 ×
 *   1. 摆一颗皇后，整盘每格的 background-color / background-image / 图案色 / href 全不变
 *   2. 图案与底色的亮度差（Δ）跟着不变，且本来就看得见（不是糊成一片）
 *   3. 图案层的透明度还是这套自己的那一档（贴纸 .45，其余 1），不会掉到 0
 *   4. 默认不淡化：整盘没有 .is-dim
 *   5. 那块色的色卡还是 ✓（信息没丢）
 *   6. 红斜纹（一块里放了两颗）照旧 —— 只删了「洗白」，没连带删掉警告
 * ========================================================================== */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/CJL/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const URL = process.env.QURL || 'http://127.0.0.1:8080/';
const SHOTS = 'E:/Projects/Games/queens-puzzle/tools/shots/';
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

const boot = async () => {
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__QUEENS_DEBUG__ && __QUEENS_DEBUG__.state.regions.length > 0', { timeout: 15000 });
  await sleep(600);
};
await boot();
await page.evaluate(() => localStorage.clear());
await boot();

async function pickSurface(id) {
  await page.evaluate(i => {
    // 色块的非默认套现在都锁着，测试要遍历就先全解开
    __QUEENS_DEBUG__.lookUnlockAll();
    __QUEENS_DEBUG__.openLook();
    document.querySelector(`#surfaceRow .showcase[data-surface="${i}"]`).click();
    __QUEENS_DEBUG__.closeLook();
  }, id);
  await sleep(360);
}

/* 整盘快照：每格的底色 / 底色图层 / 图案色 / 图案指向 / 透明度，
 * 外加图案与底色的相对亮度差 Δ（0 = 糊在一起，看不出图案）。 */
async function snap() {
  return page.evaluate(() => {
    const num = s => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = s => {
      const m = num(s);
      const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
      return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]);
    };
    const cells = [...document.querySelectorAll('.cell')];
    return cells.map(c => {
      const cs = getComputedStyle(c);
      const sk = c.querySelector('.sk');
      const ks = getComputedStyle(sk);
      const use = sk.querySelector('use');
      const la = lum(cs.backgroundColor), lb = lum(ks.color);
      return {
        bg: cs.backgroundColor,
        img: cs.backgroundImage,
        ink: ks.color,
        veiled: ks.opacity,
        href: use ? use.getAttribute('href') : '',
        dim: c.classList.contains('is-dim'),
        d: Math.round(Math.abs(lb - la) / Math.max(la, lb) * 1000) / 10
      };
    });
  });
}

async function place(marks) {
  return page.evaluate(m => {
    const d = __QUEENS_DEBUG__;
    d.state.marks.fill(0);
    m.forEach(([i, v]) => { d.state.marks[i] = v; });
    d.render(false);
  }, marks);
}

const THEMES = [
  { id: 'geo', name: '几何', motif: true, veil: 1 },
  { id: 'nature', name: '自然', motif: true, veil: 1 },
  { id: 'sky', name: '天空', motif: true, veil: 1 },
  { id: 'sticker', name: '贴纸', motif: true, veil: .45 },
  { id: 'plain', name: '纯色', motif: false, veil: 1 }
];

const geom = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  return { n: d.state.size, sol: [...d.state.solution], reg: [...d.state.regions] };
});

for (const t of THEMES) {
  console.log('\n--- ' + t.name + ' ---');
  await place([]);
  await pickSurface(t.id);
  const before = await snap();

  // 摆一颗皇后：就在第一行皇后该在的格子上
  await place([[geom.sol[0], 2]]);
  await sleep(120);
  const after = await snap();

  const arm = geom.reg[geom.sol[0]];
  const sameBg = after.every((c, i) => c.bg === before[i].bg);
  const sameImg = after.every((c, i) => c.img === before[i].img);
  const sameInk = after.every((c, i) => c.ink === before[i].ink);
  const sameHref = after.every((c, i) => c.href === before[i].href);
  const sameD = after.every((c, i) => c.d === before[i].d);

  ok('摆皇后不改任何一格的底色', sameBg,
    after.map((c, i) => c.bg !== before[i].bg ? `#${i} ${before[i].bg}→${c.bg}` : '').filter(Boolean).slice(0, 3));
  ok('摆皇后不给任何一格加底色图层', sameImg && after.every(c => c.img === 'none'),
    after.find(c => c.img !== 'none') ? after.find(c => c.img !== 'none').img : 'none');
  ok('摆皇后不改图案色', sameInk);
  ok('摆皇后不换掉图案', sameHref);
  ok('图案与底色的差保持不变', sameD);

  if (t.motif) {
    const live = after.filter(c => c.href);
    ok('每格都指到一枚图案', live.length === after.length, live.length + '/' + after.length);
    ok('图案在每块颜色上都看得出（Δ > 0.5%）', live.every(c => c.d > 0.5),
      'min ' + Math.min(...live.map(c => c.d)) + '% / max ' + Math.max(...live.map(c => c.d)) + '%');
    ok('图案层保留这套自己的浓度', after.every(c => Math.abs(parseFloat(c.veiled) - t.veil) < .01),
      'veil ' + after[0].veiled);
  } else {
    ok('纯色：图案层整层让开', after.every(c => !c.href));
  }

  ok('默认不淡化：整盘没有 .is-dim', after.every(c => !c.dim));

  const chip = await page.evaluate(g => {
    const cs = [...document.querySelectorAll('.chip')];
    return { done: cs.filter(c => c.classList.contains('is-done')).length, mine: cs[g].classList.contains('is-done') };
  }, arm);
  ok('那块色的色卡照旧打 ✓（「放好了」的信息没丢）', chip.done === 1 && chip.mine, chip);

  if (t.id === 'sky') {
    await page.screenshot({ path: SHOTS + 'region-wash-sky.png' });
  }
}

/* ---- 天空：皇后放进最浅的那块色（事故现场就是这种浅蓝） ---- */
console.log('\n--- 天空：皇后落在最浅的色块上 ---');
await place([]);
await pickSurface('sky');
const pale = await page.evaluate(() => {
  const num = s => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = s => {
    const m = num(s);
    const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]);
  };
  const cells = [...document.querySelectorAll('.cell')];
  // 「最浅」= 亮度最高那一格（天空那套的 #CFF1F4 / #E1DAFB 这一端）
  let best = -1, bestL = -1;
  cells.forEach((c, i) => {
    const l = lum(getComputedStyle(c).backgroundColor);
    if (l > bestL) { bestL = l; best = i; }
  });
  return { i: best, lum: Math.round(bestL * 1000) / 1000 };
});
const paleBefore = (await snap())[pale.i];
await place([[pale.i, 2]]);
await sleep(140);
const paleAfter = (await snap())[pale.i];
ok('最浅那块放上皇后：底色与图案色一点没动',
  paleAfter.bg === paleBefore.bg && paleAfter.ink === paleBefore.ink && paleAfter.d === paleBefore.d,
  `${paleAfter.bg} / ${paleAfter.ink} / Δ ${paleBefore.d}%→${paleAfter.d}%`);
ok('最浅那块的图案还在（Δ 没被洗掉）', paleAfter.href && paleAfter.d > 0.5, paleAfter.d + '%');
await (await page.$('#board')).screenshot({ path: SHOTS + 'region-wash-sky-board.png' });
await page.screenshot({ path: SHOTS + 'region-wash-sky-page.png' });

/* ---- 红斜纹照旧（一块里放两颗） ---- */
console.log('\n--- 一块里放两颗，红斜纹还在 ---');
await place([]);
await pickSurface('geo');
const armPair = geom.reg.reduce((acc, g, i) => (g === geom.reg[geom.sol[0]] ? acc.concat(i) : acc), []).slice(0, 2);
await place([[armPair[0], 2], [armPair[1], 2]]);
const over = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.cell')];
  return cells.filter(c => /repeating-linear-gradient/.test(getComputedStyle(c).backgroundImage)).length;
});
ok('一块里两颗皇后：那块画上红斜纹', over > 0, over);

ok('没有报错', errs.length === 0, errs.slice(0, 3));

console.log('\n' + (fail ? 'FAILED' : 'ALL PASS') + '  pass=' + pass + ' fail=' + fail);
await browser.close();
process.exit(fail ? 1 : 0);
