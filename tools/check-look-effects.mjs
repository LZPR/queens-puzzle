/* 翻格的真实浏览器回归。需要 Playwright（可通过 NODE_PATH 指向已有安装）。
 * node tools/check-look-effects.mjs [url]；QUEENS_BROWSER 可指定 Chromium 路径。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://127.0.0.1:8080/';
const shots = fileURLToPath(new URL('./shots/look-tiles/', import.meta.url));
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.QUEENS_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true
});
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log('PASS ' + name); }
const errors = [];
const ready = page => page.waitForFunction(() => window.__QUEENS_DEBUG__?.state.regions?.length);
const settled = page => page.waitForFunction(() => !document.querySelector('.board.look-is-animating'));
const solve = page => page.evaluate(async () => {
  const d = window.__QUEENS_DEBUG__;
  const { placeQueen } = await import('/src/js/app/actions.js');
  for (let r = 0; r < d.state.size; r++) placeQueen(r * d.state.size + d.state.solution[r]);
});
const direction = page => page.evaluate(() => {
  const cards = [...document.querySelectorAll('.look-tile-card')];
  const n = window.__QUEENS_DEBUG__.state.size;
  return [0, n - 1, n * (n - 1), n * n - 1].map(i => parseFloat(cards[i].style.getPropertyValue('--look-delay')));
});
const facesUseRegionColors = (page, side = 'back') => page.evaluate(side => {
  const probe = document.createElement('span');
  const cells = [...document.querySelectorAll('#grid .cell')];
  const faces = [...document.querySelectorAll(side === 'back' ? '.look-fold-after .look-tile-back' : '.look-fold-before .look-tile-face')];
  return faces.length === cells.length && faces.every((face, i) => {
    probe.style.backgroundColor = getComputedStyle(cells[i]).getPropertyValue('--rc').trim();
    return getComputedStyle(face).backgroundColor === probe.style.backgroundColor;
  });
}, side);

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForSelector('.board.look-is-animating');
  let corners = await direction(page);
  check('开局从左上到右下推进', corners[0] === 0 && corners[1] === corners[2] && corners[3] > corners[1]);
  check('初次开局翻牌正面保留区域原色', await facesUseRegionColors(page, 'front'));
  check('初次开局翻牌背面使用实际格子颜色', await facesUseRegionColors(page));
  check('每格沿中线分为固定半页与双面翻动半页', await page.evaluate(() => {
    const card = document.querySelector('.look-tile-card'), leaf = card.querySelector('.look-fold-leaf');
    return card.querySelectorAll('.look-fold-half').length === 4 &&
      Math.abs(leaf.offsetWidth * 2 - card.offsetWidth) <= 1 && leaf.offsetHeight === card.offsetHeight &&
      getComputedStyle(leaf).transformOrigin.split(' ')[0] === '0px' && getComputedStyle(card).transform === 'none';
  }));
  check('翻格时拦住鼠标、键盘落子', await page.evaluate(async () => {
    const { onCell, placeQueen, canPlay } = await import('/src/js/app/actions.js');
    onCell(0); placeQueen(1);
    return !canPlay() && window.__QUEENS_DEBUG__.state.steps === 0 && window.__QUEENS_DEBUG__.state.marks.every(v => v === 0);
  }));
  await page.waitForTimeout(180);
  await page.screenshot({ path: shots + '01-deal.png' });
  await settled(page);
  check('开局后移除装饰层，格子数量正常', await page.locator('.cell').count() === 64 && await page.locator('.look-tiles').count() === 0);
  await page.evaluate(async () => { const { onCell } = await import('/src/js/app/actions.js'); onCell(0); });
  await page.waitForTimeout(220);
  await page.evaluate(() => window.__QUEENS_DEBUG__.retry());
  check('重试翻面保留旧棋盘的正面', Number(await page.locator('.look-tile-face').first().evaluate(el => el.style.getPropertyValue('--look-mark'))) > .9);
  await settled(page);

  await page.evaluate(async () => {
    const d = window.__QUEENS_DEBUG__;
    d.settings.fadeMark = true;
    (await import('/src/js/app/actions.js')).onCell(0);
    (await import('/src/js/ui/fade.js')).applyFadeNow();
  });
  await page.waitForTimeout(350);
  check('已填格子的淡化效果仍然保留', await page.locator('.cell').first().evaluate(el =>
    getComputedStyle(el).backgroundColor === getComputedStyle(document.body).backgroundColor));
  await page.evaluate(() => window.__QUEENS_DEBUG__.retry());
  check('淡化过的旧格子翻转时仍使用区域原色', await facesUseRegionColors(page, 'front'));
  await settled(page);
  await page.evaluate(() => { window.__QUEENS_DEBUG__.settings.fadeMark = false; });

  for (const n of [4, 8, 16]) {
    const oldCorners = await page.evaluate(nextSize => {
      const cells = [...document.querySelectorAll('#grid .cell')];
      const n = Math.sqrt(cells.length), probe = document.createElement('span');
      // 改尺寸时按新格中心在旧棋盘中的位置取色。
      const first = Math.floor(n / (2 * nextSize)), last = Math.floor(n - n / (2 * nextSize));
      return [first * n + first, first * n + last, last * n + first, last * n + last].map(i => {
        probe.style.backgroundColor = getComputedStyle(cells[i]).getPropertyValue('--rc').trim();
        return probe.style.backgroundColor;
      });
    }, n);
    await page.evaluate(n => window.__QUEENS_DEBUG__.newGame(n), n);
    await page.waitForSelector('.board.look-is-animating');
    check(`${n}×${n} 每格都有固定半页与双面折页`, await page.locator('.look-tile-card').count() === n * n && await page.locator('.look-tile-face').count() === n * n * 4);
    check(`${n}×${n} 换盘从旧颜色翻到新颜色`, await page.evaluate(expected => {
      const faces = [...document.querySelectorAll('.look-fold-before .look-tile-face')];
      const n = Math.sqrt(faces.length);
      return [0, n - 1, n * (n - 1), n * n - 1].every((i, corner) => getComputedStyle(faces[i]).backgroundColor === expected[corner]);
    }, oldCorners) && await facesUseRegionColors(page));
    corners = await direction(page);
    check(`${n}×${n} 波程不超过 540ms`, corners[3] <= 540);
    await settled(page);
    check(`${n}×${n} 翻完恢复操作`, await page.evaluate(async () => (await import('/src/js/app/actions.js')).canPlay()));
  }

  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => window.__QUEENS_DEBUG__.newGame(8));
  await settled(page);
  check('320px 窄屏棋盘没有横向溢出', await page.locator('#board').evaluate(el => el.getBoundingClientRect().right <= innerWidth));
  await page.evaluate(() => {
    window.flipEvents = [];
    const observer = new MutationObserver(() => {
      if (document.querySelector('#fx .confetti') && !window.flipEvents.includes('confetti')) {
        window.flipEvents.push(document.querySelector('.board.look-has-reward') ? 'confetti' : 'early-confetti');
      }
      if (!document.querySelector('#result').hidden && !window.flipEvents.includes('result')) window.flipEvents.push('result');
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  });
  await solve(page);
  await page.waitForSelector('.look-tiles[data-direction="bottom-left"]');
  corners = await direction(page);
  check('胜利从左下到右上推进', corners[2] === 0 && corners[0] === corners[3] && corners[1] > corners[0]);
  check('通关翻图从区域原色翻出图片', await facesUseRegionColors(page, 'front'));
  check('翻图时没有礼炮或结果遮挡', await page.locator('.confetti').count() === 0 && await page.locator('#result').getAttribute('hidden') !== null);
  check('图片四角切片位置正确', await page.evaluate(() => {
    const backs = [...document.querySelectorAll('.look-fold-after .look-tile-back')];
    const n = window.__QUEENS_DEBUG__.state.size;
    return backs[0].style.backgroundPosition === '0% 0%' && backs[n - 1].style.backgroundPosition === '100% 0%' &&
      backs[n * (n - 1)].style.backgroundPosition === '0% 100%' && backs.at(-1).style.backgroundPosition === '100% 100%';
  }));
  check('通关卡图两半共用完整切片尺寸和坐标', await page.evaluate(() => {
    const card = document.querySelector('.look-tile-card');
    const fixed = card.querySelector('.look-fold-after .look-tile-face');
    const moving = card.querySelector('.look-fold-back .look-tile-face');
    return Math.abs(fixed.offsetWidth - card.offsetWidth) <= 1 && Math.abs(moving.offsetWidth - card.offsetWidth) <= 1 &&
      fixed.style.backgroundImage === moving.style.backgroundImage && fixed.style.backgroundPosition === moving.style.backgroundPosition;
  }));
  await page.waitForTimeout(340);
  await page.screenshot({ path: shots + '02-victory-flip.png' });
  await page.waitForSelector('.board.look-has-reward');
  await page.screenshot({ path: shots + '03-reward.png' });
  check('翻完合为完整图片，移除切片接缝', await page.locator('.poke-reward').count() === 1 && await page.locator('.look-tile-card').count() === 0);
  check('通关随机获得本地宝可梦卡片', await page.locator('.look-tiles.is-reward').evaluate(el => !!el.dataset.cardId));
  await page.waitForSelector('#result:not([hidden])');
  check('图片 → 礼炮 → 成绩的顺序正确', await page.evaluate(() => window.flipEvents.join(',') === 'confetti,result'));
  await page.click('#btnPeek');
  check('关闭结果后仍可欣赏图片', await page.locator('.board.look-has-reward').count() === 1);
  const recordCount = await page.evaluate(() => JSON.parse(localStorage.getItem('queens.records.v1')).length);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForSelector('.board.look-has-reward');
  check('刷新已胜利对局保留图片，不重复礼炮和战绩', await page.locator('.confetti').count() === 0 && await page.evaluate(() => JSON.parse(localStorage.getItem('queens.records.v1')).length) === recordCount);

  await page.evaluate(() => window.__QUEENS_DEBUG__.retry());
  await settled(page);
  await solve(page);
  await page.waitForSelector('.look-tiles[data-direction="bottom-left"]');
  await page.evaluate(() => window.__QUEENS_DEBUG__.retry());
  await settled(page);
  await page.waitForTimeout(1250);
  check('翻图中重开取消旧礼炮、旧图片与旧成绩', await page.locator('.confetti, .look-tiles, .board.look-has-reward, #result:not([hidden])').count() === 0);
  await solve(page);
  await page.waitForSelector('.board.look-has-reward');
  await page.evaluate(() => window.__QUEENS_DEBUG__.newGame(4));
  await page.waitForSelector('.board.look-is-animating');
  check('从奖励图换盘时翻牌正面保留原图片', await page.locator('.look-tile-face:not(.look-tile-back)').evaluateAll(faces =>
    faces.length > 0 && faces.every(el => el.style.backgroundImage.includes('blob:'))));
  await settled(page);
  await page.waitForTimeout(1250);
  check('礼炮后换局不会弹出旧成绩', await page.locator('#result:not([hidden]), .board.look-has-reward').count() === 0);
  await page.evaluate(async () => { const { onCell } = await import('/src/js/app/actions.js'); onCell(0); });
  await page.waitForTimeout(250);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForSelector('.board.look-is-animating');
  check('刷新续玩翻牌两面保留当前格子原色', await facesUseRegionColors(page, 'front') && await facesUseRegionColors(page));
  await settled(page);
  check('刷新续玩也翻格，并保留进度', await page.evaluate(() => window.__QUEENS_DEBUG__.state.marks[0] === 1 && window.__QUEENS_DEBUG__.state.steps === 1));

  const dailyContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const dailyPage = await dailyContext.newPage();
  dailyPage.on('pageerror', e => errors.push(e.message));
  await dailyPage.goto(url);
  await ready(dailyPage);
  await settled(dailyPage);
  const preferences = await dailyPage.evaluate(() => JSON.stringify(window.__QUEENS_DEBUG__.settings));
  await dailyPage.evaluate(() => window.__QUEENS_DEBUG__.startDaily('easy'));
  await dailyPage.waitForSelector('.board.look-is-animating');
  check('每日挑战开局同样逐格翻面', await dailyPage.locator('.look-tile-card').count() === 25);
  await settled(dailyPage);
  const dailyBoard = await dailyPage.evaluate(() => {
    const s = window.__QUEENS_DEBUG__.state;
    return { seed: s.seed, regions: [...s.regions], daily: s.daily };
  });
  check('翻面后保留每日挑战规则，不改写偏好', await dailyPage.evaluate(preferences => {
    const d = window.__QUEENS_DEBUG__, s = d.state;
    return s.daily.tier === 'easy' && s.limit === 180000 && s.lifeLimit === 3 && s.lives === 3 &&
      s.noHint && s.noSnap && !s.noUndo && JSON.stringify(d.settings) === preferences;
  }, preferences));
  await solve(dailyPage);
  await dailyPage.waitForSelector('.look-tiles[data-direction="bottom-left"]');
  check('每日通关翻图前已正确记账，礼炮仍等待图片', await dailyPage.evaluate(() => window.__QUEENS_DEBUG__.daily().done.easy) && await dailyPage.locator('.confetti').count() === 0);
  await dailyPage.waitForSelector('.board.look-has-reward');
  await dailyPage.waitForSelector('#result:not([hidden])');
  check('每日通关显示奖励图片和成绩', await dailyPage.locator('.poke-reward').count() === 1);
  await dailyPage.reload();
  await ready(dailyPage);
  await dailyPage.waitForSelector('.board.look-has-reward');
  check('刷新每日通关对局保留身份与奖励图', await dailyPage.evaluate(expected => JSON.stringify(window.__QUEENS_DEBUG__.state.daily) === JSON.stringify(expected), dailyBoard.daily));
  await dailyPage.evaluate(() => window.__QUEENS_DEBUG__.retry());
  await settled(dailyPage);
  check('每日重试保留同盘、日期及固定规则', await dailyPage.evaluate(expected => {
    const s = window.__QUEENS_DEBUG__.state;
    return s.seed === expected.seed && JSON.stringify([...s.regions]) === JSON.stringify(expected.regions) &&
      JSON.stringify(s.daily) === JSON.stringify(expected.daily) && s.noHint && s.noSnap && s.lives === 3;
  }, dailyBoard));
  await solve(dailyPage);
  await dailyPage.waitForSelector('.look-tiles[data-direction="bottom-left"]');
  await dailyPage.evaluate(() => window.__QUEENS_DEBUG__.newGame(4));
  await settled(dailyPage);
  await dailyPage.waitForTimeout(1250);
  check('每日翻图中切回自定义取消旧结算并恢复自定义规则', await dailyPage.evaluate(() => {
    const d = window.__QUEENS_DEBUG__;
    return !d.state.daily && d.state.noHint === d.settings.noHint && d.state.noSnap === d.settings.noSnap;
  }) && await dailyPage.locator('.board.look-has-reward, #result:not([hidden])').count() === 0);

  const reduced = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const quiet = await reduced.newPage();
  quiet.on('pageerror', e => errors.push(e.message));
  await quiet.goto(url);
  await ready(quiet);
  check('减少动态效果时不翻转', await quiet.locator('.board.look-is-animating, .look-tile-card').count() === 0);
  await solve(quiet);
  await quiet.waitForSelector('.board.look-has-reward');
  await quiet.waitForSelector('#result:not([hidden])');
  check('减少动态效果仍有奖励图和成绩，无礼炮', await quiet.locator('.confetti, .look-tile-card').count() === 0);
  await quiet.click('#btnPeek');
  await quiet.screenshot({ path: shots + '04-desktop-reward.png' });

  const broken = await context.newPage();
  await broken.route('**/assets/pokemon/*.png', route => route.abort());
  await broken.goto(url);
  await ready(broken);
  await settled(broken);
  await solve(broken);
  await broken.waitForSelector('#result:not([hidden])');
  check('图片加载失败仍可正常结算', await broken.evaluate(() => window.__QUEENS_DEBUG__.state.status === 'won'));

  const stylesContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const stylesPage = await stylesContext.newPage();
  stylesPage.on('pageerror', e => errors.push(e.message));
  await stylesPage.goto(url);
  await ready(stylesPage);
  await settled(stylesPage);
  const pick = async (kind, id) => {
    await stylesPage.click('#btnLook');
    await stylesPage.click(`.showcase[data-${kind}="${id}"]`);
    await stylesPage.click('#btnLookDone');
  };
  check('外观面板从登记表生成三组动画选项', await stylesPage.evaluate(async () => {
    const { listOf } = await import('/src/js/looks/index.js');
    return ['deal', 'reveal', 'confetti'].every(kind =>
      document.querySelectorAll(`#${kind}Row .showcase`).length === listOf(kind).length);
  }));
  check('两种翻卡展柜使用原有宝可梦立绘', await stylesPage.evaluate(() => {
    const diagonal = document.querySelector('.showcase[data-reveal="pokemon"] image')?.getAttribute('href');
    const ripple = document.querySelector('.showcase[data-reveal="pokemon-ripple"] image')?.getAttribute('href');
    return diagonal?.endsWith('/pokemon/25.png') && ripple === diagonal;
  }));
  const untouched = await stylesPage.evaluate(() => {
    const d = window.__QUEENS_DEBUG__;
    return JSON.stringify({ marks: [...d.state.marks], steps: d.state.steps, daily: d.state.daily, history: d.history() });
  });
  await pick('deal', 'wave');
  await pick('reveal', 'pokemon-ripple');
  await pick('confetti', 'hearts');
  check('换动画只改变外观，不改局面、撤销和每日身份', await stylesPage.evaluate(expected => {
    const d = window.__QUEENS_DEBUG__;
    return JSON.stringify({ marks: [...d.state.marks], steps: d.state.steps, daily: d.state.daily, history: d.history() }) === expected;
  }, untouched));
  await stylesPage.evaluate(() => {
    document.documentElement.style.setProperty('--bg-body', '#e6efe7');
    window.__QUEENS_DEBUG__.retry();
  });
  await stylesPage.waitForSelector('.look-tiles[data-mode="wave"]');
  check('翻格间隙与页面背景颜色相同，跟随主题令牌', await stylesPage.evaluate(() =>
    getComputedStyle(document.querySelector('.look-tiles')).backgroundColor === getComputedStyle(document.body).backgroundColor &&
    getComputedStyle(document.querySelector('#board')).backgroundColor === getComputedStyle(document.body).backgroundColor));
  check('逐行模式同样从右半格向左翻页', await stylesPage.locator('.look-tiles').evaluate(el => el.dataset.fold === 'right-to-left'));
  check('逐行翻页只移动右半格，左半格固定', await stylesPage.evaluate(() => {
    const card = document.querySelector('.look-tile-card'), leaf = card.querySelector('.look-fold-leaf');
    return Math.abs(leaf.offsetWidth * 2 - card.offsetWidth) <= 1 && leaf.offsetHeight === card.offsetHeight &&
      Math.abs(leaf.offsetLeft * 2 - card.offsetWidth) <= 1 && getComputedStyle(leaf).transformOrigin.split(' ')[0] === '0px' &&
      getComputedStyle(card.querySelector('.look-fold-before')).transform === 'none';
  }));
  await settled(stylesPage);
  await pick('deal', 'ripple');
  await stylesPage.evaluate(() => window.__QUEENS_DEBUG__.retry());
  await stylesPage.waitForSelector('.look-tiles[data-mode="ripple"]');
  check('涟漪由中心向四角推进', await stylesPage.evaluate(() => {
    const cards = [...document.querySelectorAll('.look-tile-card')], n = window.__QUEENS_DEBUG__.state.size;
    const delay = i => parseFloat(cards[i].style.getPropertyValue('--look-delay'));
    return delay(Math.floor(n / 2) * n + Math.floor(n / 2)) < delay(0);
  }));
  await settled(stylesPage);
  await stylesPage.reload();
  await ready(stylesPage);
  await settled(stylesPage);
  check('三组动画选项刷新后仍保留', await stylesPage.evaluate(() => {
    const s = window.__QUEENS_DEBUG__.settings;
    return s.dealStyle === 'ripple' && s.revealStyle === 'pokemon-ripple' && s.confettiStyle === 'hearts';
  }));
  await solve(stylesPage);
  await stylesPage.waitForSelector('.look-tiles[data-mode="ripple"]');
  check('星河藏卡先翻面，再发射所选爱心礼花', await stylesPage.locator('.look-celebration').count() === 0);
  await stylesPage.waitForSelector('.look-has-reward');
  check('星河藏卡翻成本局宝可梦卡片', await stylesPage.locator('.look-tiles.is-reward').evaluate(el =>
    !!el.dataset.cardId && el.getAttribute('aria-label').includes('宝可梦')));
  await stylesPage.waitForSelector('.look-celebration[data-kind="hearts"]');
  check('藏卡含宝可梦立绘，爱心礼花来自插件', await stylesPage.locator('.poke-card-art').count() > 0 && await stylesPage.locator('.look-particle').count() === 30 && await stylesPage.locator('.confetti').count() === 0);
  await stylesPage.waitForSelector('#result:not([hidden])');
  await stylesPage.click('#btnPeek');
  await stylesPage.screenshot({ path: shots + '05-pokemon-hearts.png' });
  await pick('confetti', 'fireworks');
  await stylesPage.evaluate(async () => (await import('/src/js/ui/win.js')).burstConfetti());
  await stylesPage.waitForSelector('.look-celebration[data-kind="fireworks"]');
  check('星芒礼炮独立发射三组粒子', await stylesPage.locator('.look-particle').count() === 48);
  await pick('confetti', 'quiet');
  await stylesPage.evaluate(async () => (await import('/src/js/ui/win.js')).burstConfetti());
  await stylesPage.waitForTimeout(60);
  check('安静庆祝不产生礼花粒子', await stylesPage.locator('.look-particle, .confetti').count() === 0);
  await pick('reveal', 'original');
  check('选择保留棋盘会收起插件图片', await stylesPage.locator('.look-has-reward, .look-tiles').count() === 0);
  await pick('deal', 'original');
  await pick('confetti', 'original');
  await stylesPage.evaluate(() => window.__QUEENS_DEBUG__.retry());
  check('原版入场保留作者原有动画', await stylesPage.locator('.look-tiles').count() === 0 && await stylesPage.locator('.cell.deal').count() > 0);
  await stylesPage.waitForTimeout(1100);
  await solve(stylesPage);
  await stylesPage.waitForSelector('#result:not([hidden])');
  check('原版通关保留棋盘和作者礼炮', await stylesPage.locator('.look-tiles').count() === 0 && await stylesPage.locator('.confetti').count() === 34);
  await stylesPage.click('#btnPeek');
  await stylesPage.setViewportSize({ width: 320, height: 640 });
  await stylesPage.click('#btnLook');
  await stylesPage.locator('#confettiRow').scrollIntoViewIfNeeded();
  check('新增展柜在窄屏能滚动访问，确认按钮仍在屏内', await stylesPage.locator('#btnLookDone').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight));
  await stylesPage.screenshot({ path: shots + '06-effects-panel.png' });
  await stylesPage.click('#btnLookDone');
  await stylesPage.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('queens.settings.v1'));
    s.dealStyle = 'missing-plugin'; s.revealStyle = 'missing-plugin'; s.confettiStyle = 'missing-plugin';
    Object.assign(window.__QUEENS_DEBUG__.settings, { dealStyle: s.dealStyle, revealStyle: s.revealStyle, confettiStyle: s.confettiStyle });
    localStorage.setItem('queens.settings.v1', JSON.stringify(s));
  });
  await stylesPage.reload();
  await ready(stylesPage);
  check('插件选项丢失时按登记顺序退回默认', await stylesPage.evaluate(() => {
    const s = window.__QUEENS_DEBUG__.settings;
    return s.dealStyle === 'diagonal' && s.revealStyle === 'pokemon' && s.confettiStyle === 'original';
  }));
  check('浏览器无脚本错误', errors.length === 0);
  console.log(`\n${checks} checks passed. Screenshots: ${shots}`);
} finally {
  await browser.close();
}
