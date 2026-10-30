/* ============================================================================
 * 外观（顶栏调色盘按钮 → 展柜面板）
 *
 *   python serve.py --no-open
 *   node tools/check-look.mjs
 *
 * 规矩：外观是**即时生效**的偏好（跟音效 / 冲突高亮一类），选完立刻写 settings、
 * 存盘、落到 <html data-surface / data-mark / data-piece>，棋盘跟着变，不碰局面。
 * 三排展柜的选项由 src/js/looks/ 里的插件现场生成，这个脚本一并校验插件登记处。
 *
 * 覆盖：
 *   1. 顶栏没有「自动打叉」按钮了，换成外观；自动打叉仍在设置面板里
 *   2. 展柜面板：三排、每排选项由插件生成、跨插件的排有插件小标签、有当前标记
 *   3. 色块图案：每格按自己的颜色取图形、压暗一档（够淡）、切纯色就整层让开
 *   4. 选「点」：html[data-mark] 变、CSS 真的把两根斜杠收成一个圆点
 *   5. 选「小猫」：html[data-piece] 变、格子里的画换成小猫，皇后仍是皇后
 *   6. 换样式不动局面（marks 不变）、不进 undo 栈
 *   7. 存档：写进 queens.settings.v1，刷新后三样都还在
 *   8. 面板开着时棋盘锁住；Esc / 知道了 / 点背景都能关；焦点回到顶栏
 *   9. 提示行文案跟着样式走、顶栏小黄点标记「换过样式」
 *  10. 认不出来的存档值退回默认
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
await page.evaluate(() => localStorage.removeItem('queens.settings.v1'));
await boot();

async function openLook() {
  await page.click('#btnLook');
  await page.waitForFunction(() => !document.getElementById('lookWrap').hidden, { timeout: 5000 });
  await sleep(320);
}
async function pick(kind, id) {
  await page.evaluate((k, i) => {
    const row = document.getElementById(k + 'Row');
    row.querySelector(`[data-${k}="${i}"]`).click();
  }, kind, id);
  await sleep(260);
}

// ---------- 1. 顶栏 ----------
console.log('\n--- 顶栏 ---');
const bar = await page.evaluate(() => ({
  auto: !!document.getElementById('btnAuto'),
  look: !!document.getElementById('btnLook'),
  label: document.getElementById('btnLook').getAttribute('aria-label'),
  expanded: document.getElementById('btnLook').getAttribute('aria-expanded'),
  set: document.getElementById('btnLook').classList.contains('is-set'),
  swAuto: !!document.getElementById('swAuto'),
  // 顶栏四颗按钮：外观 / 新局 / 战绩 / 设置
  icons: document.querySelectorAll('.actions .icon-btn').length,
  fits: document.querySelector('.topbar').scrollWidth <= window.innerWidth + 1,
  attr: document.documentElement.getAttribute('data-surface'),
  look: __QUEENS_DEBUG__.look()
}));
ok('顶栏不再有自动打叉按钮', bar.auto === false);
ok('换成了外观按钮', bar.look && bar.label === '外观' && bar.expanded === 'false', bar.label);
ok('顶栏仍是四颗图标按钮', bar.icons === 4, bar.icons);
ok('顶栏不溢出', bar.fits);
ok('默认样式下按钮没有小黄点', bar.set === false);
ok('设置里还有自动打叉开关', bar.swAuto);
ok('开箱就是几何图案', bar.look.surface === 'geo' && bar.attr === 'geo', JSON.stringify(bar.look));

// ---------- 2. 展柜面板 ----------
console.log('\n--- 展柜面板 ---');
await openLook();
const ui = await page.evaluate(async () => {
  const { KINDS, DEFAULT_LOOK, listOf } = await import('/src/js/looks/index.js');
  const rows = {
    surface: [...document.querySelectorAll('#surfaceRow .showcase')],
    mark: [...document.querySelectorAll('#markRow .showcase')],
    piece: [...document.querySelectorAll('#pieceRow .showcase')],
    life: [...document.querySelectorAll('#lifeRow .showcase')]
  };
  const first = rows.surface[0];
  const on = [...document.querySelectorAll('.showcase.is-on')];
  return {
    open: !document.getElementById('lookWrap').hidden,
    focus: document.activeElement && document.activeElement.id,
    surfaceIds: rows.surface.map(b => b.dataset.surface),
    markIds: rows.mark.map(b => b.dataset.mark),
    pieceIds: rows.piece.map(b => b.dataset.piece),
    lifeIds: rows.life.map(b => b.dataset.life),
    checked: on.map(b => KINDS.map(k => b.dataset[k]).find(Boolean)),
    expectedChecked: KINDS.map(k => DEFAULT_LOOK[k]),
    expectedPlates: KINDS.flatMap(k => listOf(k).map(o => o.name)),
    plugins: rows.surface.map(b => b.dataset.plugin),
    // 一排里跨了几个插件 → 才挂插件小标签
    srcs: rows.surface.map(b => (b.querySelector('.sc-src') || {}).textContent || ''),
    markSrcs: rows.mark.map(b => !!b.querySelector('.sc-src')),
    // 展位构件齐不齐：玻璃罩 / 顶灯 / 台面 / 反光 / 名牌 / 勾
    parts: ['sc-case', 'sc-lamp', 'sc-plinth', 'sc-glass', 'sc-plate', 'sc-tick']
      .map(c => !!first.querySelector('.' + c)),
    plates: [...document.querySelectorAll('.sc-plate b')].map(b => b.textContent),
    // 色块的预览是一小块 2×2 的棋盘：底色 + 图形
    // 只数预览 svg 的直接子节点：图形内部的 rect / g 不算
    surfacePrev: first.querySelectorAll('.pv-skin svg > rect').length,
    surfaceMotifs: first.querySelectorAll('.pv-skin svg > g').length,
    nows: ['surfaceNow', 'markNow', 'pieceNow'].map(id => document.getElementById(id).textContent),
    svgs: rows.piece.map(b => b.querySelectorAll('.sc-item svg').length),
    // 一排里两个展位并排：第二个在第一个右边、同一行
    cols: (() => {
      const b = rows.mark;
      const r0 = b[0].getBoundingClientRect(), r1 = b[1].getBoundingClientRect();
      return r1.left > r0.left + 20 && Math.abs(r1.top - r0.top) < 2;
    })(),
    overflow: document.getElementById('lookSheet').scrollHeight >
      document.getElementById('lookSheet').clientHeight + 4,
    done: getComputedStyle(document.getElementById('lookSheet').querySelector('.sheet-done')).position
  };
});
ok('面板打开', ui.open);
ok('打开后焦点在面板里', ui.focus === 'lookSheet', ui.focus);
ok('色块的展位有五套：几何 / 自然 / 天空 / 贴纸 / 纯色',
  ui.surfaceIds.join() === 'geo,nature,sky,sticker,plain', ui.surfaceIds);
ok('叉的展位有两个：叉 / 点', ui.markIds.join() === 'x,dot', ui.markIds);
ok('皇后的展位有两个：皇后 / 小猫', ui.pieceIds.join() === 'queen,cat', ui.pieceIds);
ok('生命的展位有两个：红心 / 血条', ui.lifeIds.join() === 'heart,bar', ui.lifeIds);
ok('各类外观按插件登记选择默认项',
  ui.checked.join() === ui.expectedChecked.join(), ui.checked);
ok('每个展位都记得自己出自哪个插件',
  ui.plugins.join() === 'geometry,nature,sky,sticker,classic', ui.plugins);
ok('插件名和样式名一样时不挂小标签，只有「纯色」挂「墨线」',
  ui.srcs.join() === ',,,,墨线', JSON.stringify(ui.srcs));
ok('单插件的排不挂插件标签', ui.markSrcs.every(v => v === false));
ok('展位有玻璃罩 / 顶灯 / 台面 / 反光 / 名牌 / 勾', ui.parts.every(Boolean), ui.parts);
ok('名牌只写名字，没有描述',
  ui.plates.join() === ui.expectedPlates.join(),
  ui.plates.join());
ok('标题写着当前用的样式',
  /几何/.test(ui.nows[0]) && /叉/.test(ui.nows[1]) && /皇后/.test(ui.nows[2]),
  ui.nows.join(' / '));
ok('色块的预览是 2×2 的带图小盘', ui.surfacePrev === 4 && ui.surfaceMotifs === 4,
  `${ui.surfacePrev} 底 / ${ui.surfaceMotifs} 图`);
ok('两个皇后展位都有画', ui.svgs.every(n => n === 1), ui.svgs);
ok('展位并排', ui.cols);
/* 四排展柜（色块两行 + 叉 + 皇后 + 生命）在 390×844 上比一屏高：
 * 面板自己滚，「知道了」常开 sticky 钉在下沿 —— 滚到哪都点得到。 */
ok('内容比一屏高，面板自己滚，「知道了」钉在面板下沿',
  ui.overflow && ui.done === 'sticky', `${ui.overflow}/${ui.done}`);
await page.screenshot({ path: SHOTS + '20-look-sheet.png' });

// 面板开着时棋盘锁住
const locked = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const before = d.state.marks[0];
  document.querySelectorAll('.cell')[0].click();
  return { before, after: d.state.marks[0] };
});
ok('面板打开时棋盘锁定', locked.before === locked.after, `${locked.before}→${locked.after}`);

// ---------- 3. 色块图案 ----------
console.log('\n--- 色块图案 ---');
const skin = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const cells = [...document.querySelectorAll('.cell')];
  const ink = cells.map(c => getComputedStyle(c.querySelector('.sk')).color);
  const hrefs = cells.map(c => {
    const u = c.querySelector('.sk use');
    return u ? u.getAttribute('href') : '';
  });
  // 每格的颜色与图案色差多少：太近看不见，太远就抢戏
  const lum = s => {
    const m = s.match(/[\d.]+/g).map(Number);
    const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]);
  };
  const ratios = cells.map(c => {
    const a = lum(getComputedStyle(c).backgroundColor), b = lum(getComputedStyle(c.querySelector('.sk')).color);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  // 同一块色的格子必须指向同一枚图形
  const byRegion = {};
  cells.forEach(c => {
    const g = d.state.regions[+c.dataset.i];
    byRegion[g] = byRegion[g] || new Set();
    byRegion[g].add(hrefs[+c.dataset.i]);
  });
  return {
    attr: document.documentElement.getAttribute('data-surface'),
    hasSkin: document.getElementById('grid').classList.contains('has-skin'),
    defs: document.querySelectorAll('#skinDefs > g').length,
    symbols: document.querySelectorAll('#skinDefs > symbol').length,
    hrefsOk: hrefs.every(h => /^#qsk-geo-\d+$/.test(h)),
    uniqHrefs: new Set(hrefs).size,
    regions: new Set(Array.from(d.state.regions)).size,
    samePerRegion: Object.values(byRegion).every(s => s.size === 1),
    inkDiff: new Set(ink).size,
    minRatio: +Math.min(...ratios).toFixed(3),
    maxRatio: +Math.max(...ratios).toFixed(3),
    display: getComputedStyle(document.querySelector('.sk')).display,
    marks: Array.from(d.state.marks).join('')
  };
});
ok('html[data-surface] = geo', skin.attr === 'geo', skin.attr);
ok('棋盘挂上图案层', skin.hasSkin && skin.display !== 'none');
ok('defs 里每套图案按调色板建了 18 枚图形', skin.defs === 18 && skin.symbols === 0,
  `g=${skin.defs} symbol=${skin.symbols}`);
ok('每格指向一枚图形', skin.hrefsOk && skin.uniqHrefs === skin.regions,
  `${skin.uniqHrefs} 枚 / ${skin.regions} 块`);
ok('同一块色的格子用同一枚图形', skin.samePerRegion);
ok('图案压暗一档，够淡', skin.minRatio > 1.03 && skin.maxRatio < 1.20,
  `${skin.minRatio}–${skin.maxRatio}`);
await page.keyboard.press('Escape');
await sleep(300);
await (await page.$('#board')).screenshot({ path: SHOTS + '23-look-geo.png' });
await page.click('#btnLook');
await page.waitForFunction(() => !document.getElementById('lookWrap').hidden, { timeout: 5000 });
await sleep(320);

// 换成纯色
await pick('surface', 'plain');
const plain = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  return {
    attr: document.documentElement.getAttribute('data-surface'),
    hasSkin: document.getElementById('grid').classList.contains('has-skin'),
    display: getComputedStyle(document.querySelector('.sk')).display,
    href: document.querySelector('.sk use').getAttribute('href'),
    marks: Array.from(d.state.marks).join(''),
    saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').surfaceStyle,
    now: document.getElementById('surfaceNow').textContent,
    set: document.getElementById('btnLook').classList.contains('is-set'),
    defs: document.querySelectorAll('#skinDefs > g').length
  };
});
ok('html[data-surface] 变成 plain', plain.attr === 'plain', plain.attr);
ok('纯色时图案层整层让开', !plain.hasSkin && plain.display === 'none', plain.display);
ok('纯色时 defs 清空', plain.defs === 0, plain.defs);
ok('换图案不动局面', plain.marks === skin.marks);
ok('图案样式写进存档', plain.saved === 'plain', plain.saved);
ok('标题跟着变', /纯色/.test(plain.now), plain.now);
ok('换过样式后顶栏挂上小黄点', plain.set === true);
await page.screenshot({ path: SHOTS + '22-look-plain.png' });

// 切回几何
await pick('surface', 'geo');
const back = await page.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-surface'),
  href: document.querySelector('.sk use').getAttribute('href'),
  display: getComputedStyle(document.querySelector('.sk')).display,
  set: document.getElementById('btnLook').classList.contains('is-set')
}));
ok('切回几何，图案层回来', back.attr === 'geo' && back.display !== 'none' &&
  /^#qsk-geo-/.test(back.href), back.href);

// ---------- 4. 换叉的样式 ----------
console.log('\n--- 叉换成点 ---');
const beforeMarks = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  // 摆一颗皇后 + 一个手标，好量尺寸
  d.state.marks[0] = 2; d.state.marks[1] = 1;
  d.render(false);
  const bar = document.querySelector('.cell.is-x .mark i');
  const cs = bar ? getComputedStyle(bar) : null;
  return {
    marks: Array.from(d.state.marks).join(''),
    bar: cs ? [cs.width, cs.height, cs.borderRadius].join('|') : ''
  };
});
await pick('mark', 'dot');
const dot = await page.evaluate(() => {
  const el = document.querySelector('.cell.is-x .mark i');
  const second = document.querySelector('.cell.is-x .mark i + i');
  const cs = getComputedStyle(el);
  const auto = document.querySelector('.cell.is-auto .mark i');
  const acs = auto ? getComputedStyle(auto) : null;
  const d = __QUEENS_DEBUG__;
  return {
    attr: document.documentElement.getAttribute('data-mark'),
    setting: d.settings.markStyle,
    w: parseFloat(cs.width), h: parseFloat(cs.height), r: cs.borderRadius,
    second: second ? getComputedStyle(second).display : 'none',
    autoRound: acs ? parseFloat(acs.height) === parseFloat(acs.width) : null,
    marks: Array.from(d.state.marks).join(''),
    saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').markStyle,
    hint: document.getElementById('hint').textContent.trim(),
    set: document.getElementById('btnLook').classList.contains('is-set'),
    label: document.getElementById('btnLook').getAttribute('aria-label')
  };
});
ok('html[data-mark] 变成 dot', dot.attr === 'dot' && dot.setting === 'dot', dot.attr);
ok('手标变成圆点（宽高相同、无斜杠）',
  dot.w > 0 && dot.w === dot.h && /50%/.test(dot.r) && dot.second === 'none',
  `${dot.w}x${dot.h} r=${dot.r} 2nd=${dot.second}`);
ok('自动标记也跟着变圆点', dot.autoRound === true, dot.autoRound);
ok('换样式不动局面', dot.marks === beforeMarks.marks);
ok('样式写进存档', dot.saved === 'dot', dot.saved);
ok('顶栏按钮挂上小黄点', dot.set && /换过/.test(dot.label), dot.label);

// ---------- 5. 换皇后 ----------
console.log('\n--- 皇后换成小猫 ---');
await pick('piece', 'cat');
const cat = await page.evaluate(() => {
  const item = document.querySelector('#pieceRow .showcase[data-piece="cat"] .sc-item svg');
  const piece = document.querySelector('.cell.is-q .piece');
  const svg = piece ? piece.querySelector('svg') : null;
  const queen = document.querySelector('#pieceRow .showcase[data-piece="queen"] .sc-item svg');
  const d = __QUEENS_DEBUG__;
  const box = piece ? piece.getBoundingClientRect() : null;
  const cellBox = piece ? piece.parentElement.getBoundingClientRect() : null;
  return {
    attr: document.documentElement.getAttribute('data-piece'),
    setting: d.settings.pieceStyle,
    // 没有底色：整张画里不该有铺满 viewBox 的 rect，也不该有粉色
    pink: svg ? svg.innerHTML.indexOf('f7d6d6') : -2,
    // 剪影走 currentColor（挂在包住整个身体的 <g> 上）
    groupFill: svg && svg.querySelector('g') ? svg.querySelector('g').getAttribute('fill') : '',
    white: svg ? svg.querySelectorAll('[fill="#ffffff"]').length : 0,
    catPaths: svg ? svg.querySelectorAll('path').length : 0,
    queenPaths: queen ? queen.querySelectorAll('path').length : 0,
    // 占位跟皇后同一套：.piece 仍是格子内缩 5%
    ratio: box && cellBox ? +(box.width / cellBox.width).toFixed(3) : 0,
    itemPink: item ? item.innerHTML.indexOf('f7d6d6') : -2,
    cells: document.querySelectorAll('.cell.is-q .piece svg path').length,
    saved: JSON.parse(localStorage.getItem('queens.settings.v1') || '{}').pieceStyle,
    pieceNow: document.getElementById('pieceNow').textContent
  };
});
ok('html[data-piece] 变成 cat', cat.attr === 'cat' && cat.setting === 'cat', cat.attr);
ok('棋盘上的皇后换成小猫', cat.cells > 0, cat.cells);
ok('小猫没有底色（不再是一块方底）', cat.pink === -1, `pink=${cat.pink}`);
ok('小猫剪影跟皇后一样吃 currentColor', cat.groupFill === 'currentColor', cat.groupFill);
ok('墨色脸上留了白眼与白嘴', cat.white >= 4, cat.white);
ok('占位与皇后一致（内缩 5%，90% 格宽）', cat.ratio > 0.88 && cat.ratio < 0.92, cat.ratio);
ok('展柜里的预览也没有底色', cat.itemPink === -1);
ok('两套画不一样', cat.catPaths !== cat.queenPaths, `cat=${cat.catPaths} queen=${cat.queenPaths}`);
ok('样式写进存档', cat.saved === 'cat', cat.saved);
ok('标题跟着变', /小猫/.test(cat.pieceNow), cat.pieceNow);
await page.screenshot({ path: SHOTS + '21-look-cat.png' });

// ---------- 6. 关面板 + 刷新保留 ----------
console.log('\n--- 关闭与持久化 ---');
await page.keyboard.press('Escape');
await sleep(320);
const closed = await page.evaluate(() => ({
  hidden: document.getElementById('lookWrap').hidden,
  focus: document.activeElement && document.activeElement.id,
  expanded: document.getElementById('btnLook').getAttribute('aria-expanded'),
  inert: document.getElementById('app').inert === true
}));
ok('Esc 关闭面板', closed.hidden);
ok('关闭后焦点回到顶栏', closed.focus === 'btnLook', closed.focus);
ok('aria-expanded 复位、app 解除 inert', closed.expanded === 'false' && !closed.inert);

// 关掉之后还能正常落子（挑一格既没皇后、也没被自动标记的）
const playable = await page.evaluate(() => {
  const d = __QUEENS_DEBUG__;
  const i = d.state.marks.findIndex((v, k) => v === 0 && !d.state.auto[k]);
  document.querySelectorAll('.cell')[i].click();
  return d.state.marks[i];
});
ok('关闭后恢复操作', playable === 1, playable);

await boot();
const afterReload = await page.evaluate(() => ({
  look: __QUEENS_DEBUG__.look(),
  attrMark: document.documentElement.getAttribute('data-mark'),
  attrPiece: document.documentElement.getAttribute('data-piece'),
  attrSurface: document.documentElement.getAttribute('data-surface'),
  skin: document.querySelectorAll('#skinDefs > g').length,
  dot: (() => {
    const el = document.querySelector('.cell.is-auto .mark i');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return parseFloat(cs.width) === parseFloat(cs.height);
  })(),
  cat: document.querySelectorAll('.cell .piece svg ellipse').length,
  set: document.getElementById('btnLook').classList.contains('is-set')
}));
ok('刷新后仍是几何 + 点 + 小猫',
  afterReload.look.surface === 'geo' && afterReload.look.mark === 'dot' &&
  afterReload.look.piece === 'cat' && afterReload.attrSurface === 'geo' &&
  afterReload.attrMark === 'dot' && afterReload.attrPiece === 'cat',
  JSON.stringify(afterReload.look));
ok('刷新后棋盘照着样式画', afterReload.cat > 0 && afterReload.skin === 18,
  `cat=${afterReload.cat} defs=${afterReload.skin}`);
ok('刷新后小黄点还在', afterReload.set);

// 点背景 / 知道了 都能关
await openLook();
await page.mouse.click(195, 40);
await sleep(320);
ok('点背景关闭', await page.evaluate(() => document.getElementById('lookWrap').hidden));
await openLook();
await page.click('#btnLookDone');
await sleep(320);
ok('「知道了」关闭', await page.evaluate(() => document.getElementById('lookWrap').hidden));

// ---------- 7. 切回默认 + 存档兜底 ----------
console.log('\n--- 切回默认与兜底 ---');
await openLook();
await pick('surface', 'plain');
await pick('mark', 'x');
await pick('piece', 'queen');
const back2 = await page.evaluate(() => ({
  look: __QUEENS_DEBUG__.look(),
  set: document.getElementById('btnLook').classList.contains('is-set'),
  x: (() => {
    const el = document.querySelector('.cell.is-x .mark i');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return parseFloat(cs.width) > parseFloat(cs.height) * 2;
  })(),
  cat: document.querySelectorAll('.piece svg ellipse').length
}));
ok('叉与皇后切回默认', back2.look.mark === 'x' && back2.look.piece === 'queen',
  JSON.stringify(back2.look));
ok('换了色块图案就算「换过样式」', back2.look.surface === 'plain' && back2.set === true);
ok('叉恢复成两根斜杠', back2.x === true, back2.x);
ok('小猫从棋盘上撤掉', back2.cat === 0, back2.cat);
await pick('surface', 'geo');
const back3 = await page.evaluate(() => ({
  set: document.getElementById('btnLook').classList.contains('is-set'),
  attr: document.documentElement.getAttribute('data-surface')
}));
ok('三样都回默认后小黄点消失', back3.set === false && back3.attr === 'geo');
await page.keyboard.press('Escape');
await sleep(260);

// 存档里塞脏值：读盘时退回默认，不把棋盘画空
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('queens.settings.v1') || '{}');
  s.surfaceStyle = 'kaleidoscope';
  s.markStyle = 'triangle';
  s.pieceStyle = '';
  localStorage.setItem('queens.settings.v1', JSON.stringify(s));
});
await boot();
const dirty = await page.evaluate(() => ({
  look: __QUEENS_DEBUG__.look(),
  attrMark: document.documentElement.getAttribute('data-mark'),
  attrPiece: document.documentElement.getAttribute('data-piece'),
  attrSurface: document.documentElement.getAttribute('data-surface')
}));
ok('存档里的怪值退回默认',
  dirty.look.surface === 'geo' && dirty.look.mark === 'x' && dirty.look.piece === 'queen' &&
  dirty.attrSurface === 'geo' && dirty.attrMark === 'x' && dirty.attrPiece === 'queen',
  JSON.stringify(dirty.look));

// ---------- 贴纸的纱：全盘一个样 ----------
console.log('\n--- 贴纸的纱 ---');
await page.click('#btnLook');
await page.waitForFunction(() => !document.getElementById('lookWrap').hidden, { timeout: 5000 });
await sleep(300);
await pick('surface', 'sticker');
await page.keyboard.press('Escape');
await sleep(380);
await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.cell')];
  if (!cells.some(c => c.classList.contains('is-x'))) {
    const free = cells.find(c => !c.classList.contains('is-q'));
    if (free) free.click();
  }
});
await sleep(420);
const veil = await page.evaluate(() => {
  const grid = document.getElementById('grid');
  const cells = [...document.querySelectorAll('.cell')];
  const marked = c => c.classList.contains('is-x') || c.classList.contains('is-auto');
  const x = cells.find(c => c.classList.contains('is-x'));
  // 空格：手标的、自动标的、皇后都没有
  const free = cells.find(c => !marked(c) && !c.classList.contains('is-q'));
  const op = el => el ? +getComputedStyle(el.querySelector('.sk')).opacity : -1;
  return {
    cssVar: getComputedStyle(grid).getPropertyValue('--sk-veil').trim(),
    x: op(x), free: op(free)
  };
});
ok('贴纸这套整层戴纱（veil = .45）', Math.abs(+veil.cssVar - .45) < .01, veil.cssVar);
ok('空着的格子和打了叉的格子一样淡，不分两套',
  veil.x === veil.free && veil.free > 0 && veil.free < .6,
  `x=${veil.x} free=${veil.free}`);
await page.screenshot({ path: SHOTS + '25-look-marked.png' });

// 换回几何：纱要摘干净，别的主题仍是原样
await page.click('#btnLook');
await page.waitForFunction(() => !document.getElementById('lookWrap').hidden, { timeout: 5000 });
await sleep(300);
await pick('surface', 'geo');
await page.keyboard.press('Escape');
await sleep(380);
const noVeil = await page.evaluate(() => ({
  cssVar: getComputedStyle(document.getElementById('grid')).getPropertyValue('--sk-veil').trim(),
  sk: +getComputedStyle(document.querySelector('.sk')).opacity
}));
ok('换回几何就把纱摘掉', noVeil.cssVar === '1' && noVeil.sk === 1,
  `var=${noVeil.cssVar} sk=${noVeil.sk}`);

// ---------- 矮屏：三排展柜塞不进一屏 ----------
console.log('\n--- 矮屏 ---');
await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await boot();
await openLook();
const tiny = await page.evaluate(() => {
  const btn = document.querySelector('.look-sheet .sheet-done');
  const sheet = document.getElementById('lookSheet');
  const b = btn.getBoundingClientRect(), s = sheet.getBoundingClientRect();
  return {
    pos: getComputedStyle(btn).position,
    bottom: Math.round(b.bottom), sheetBottom: Math.round(s.bottom), vh: innerHeight,
    scrolls: sheet.scrollHeight > sheet.clientHeight + 4,
    // 5 套主题排两行，第二行不能横向跑出去
    rowRight: Math.round(Math.max(...[...document.querySelectorAll('#surfaceRow .showcase')]
      .map(e => e.getBoundingClientRect().right)))
  };
});
ok('矮屏上面板确实要滚', tiny.scrolls, `${tiny.bottom}/${tiny.sheetBottom}`);
ok('矮屏上「知道了」钉在面板底部、不掉到屏幕外',
  tiny.pos === 'sticky' && tiny.bottom <= tiny.sheetBottom + 1 && tiny.bottom <= tiny.vh + 1,
  `${tiny.pos} bottom=${tiny.bottom} sheet=${tiny.sheetBottom} vh=${tiny.vh}`);
ok('矮屏上色块展位仍在面板宽度内', tiny.rowRight <= 360 - 10, tiny.rowRight);
await page.screenshot({ path: SHOTS + '24-look-tiny.png' });
await page.keyboard.press('Escape');
await sleep(200);

// ---------- 汇总 ----------
console.log('\n--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ok('无 JS 报错', errs.length === 0, errs.length);

await browser.close();
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
