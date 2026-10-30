/* 随机集卡与交互的真实浏览器回归；依赖同 check-look-effects.mjs。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] || 'http://127.0.0.1:8081/';
const dir = new URL('./shots/pokemon/', import.meta.url);
mkdirSync(dir, { recursive: true });
let checks = 0;
const errors = [];
const check = (name, ok) => { assert.ok(ok, name); console.log('PASS ' + name); checks++; };
const browser = await chromium.launch({ executablePath: process.env.QUEENS_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const setup = async (options = {}, init = null) => {
  const { blockArt, ...contextOptions } = options;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...contextOptions });
  await context.addInitScript(() => {
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = array => {
      if (array instanceof Uint32Array && array.length === 1) { array[0] = window.cardTestRandom || 0; return array; }
      return random(array);
    };
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  if (blockArt) await page.route('**/assets/pokemon/*.png', route => route.abort());
  await page.goto(url);
  await page.waitForFunction(() => window.__QUEENS_DEBUG__?.state.regions?.length);
  await page.waitForSelector('#btnCollection');
  return page;
};
const canPlay = async page => {
  const actions = await page.evaluateHandle(async () => import('/src/js/app/actions.js'));
  await page.waitForFunction(a => a.canPlay(), actions); await actions.dispose();
};
const solve = async page => {
  await canPlay(page);
  await page.evaluate(async () => {
    const a = await import('/src/js/app/actions.js'), s = window.__QUEENS_DEBUG__.state;
    for (let r = 0; r < s.size; r++) a.placeQueen(r * s.size + s.solution[r]);
  });
};
const inventory = page => page.evaluate(async () => (await import('/src/js/looks/cards/collection.js')).collection());
const pick = (page, kind, id) => page.evaluate(async ([kind, id]) => (await import('/src/js/ui/panels/look.js')).pickLook(kind, id), [kind, id]);
const result = page => page.waitForSelector('#result:not([hidden])');
try {
  const sources = JSON.parse(readFileSync(new URL('../src/js/looks/assets/pokemon/sources.json', import.meta.url)));
  check('18 张立绘均为有来源、未改绘的原始 PNG', sources.length === 18 && sources.every(s => {
    const data = readFileSync(new URL('../src/js/looks/assets/pokemon/' + s.file, import.meta.url));
    return s.source.includes('PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/') &&
      data.subarray(1, 4).toString() === 'PNG' && createHash('sha256').update(data).digest('hex') === s.sha256;
  }));
  const page = await setup();
  await canPlay(page);
  check('未通关不发卡，卡册入口可见', (await inventory(page)).total === 0 && await page.locator('#btnCollection').isVisible());
  check('旧图片偏好迁移到宝可梦藏卡', await page.evaluate(async () => {
    const { styleId, listOf } = await import('/src/js/looks/index.js');
    return styleId('reveal', 'kitten') === 'pokemon' && styleId('reveal', 'starlight') === 'pokemon-ripple' &&
      listOf('reveal').every(p => !['kitten', 'starlight'].includes(p.id));
  }));
  await page.click('#btnCollection');
  check('空卡册显示 18 个待发现卡位，并锁住游戏输入', await page.locator('.poke-slot:disabled').count() === 18 && await page.evaluate(() => window.__QUEENS_DEBUG__.sheet() === 'collection' && document.querySelector('#app').inert));
  await page.click('[data-card-filter="owned"]');
  check('已收集筛选提供空状态', await page.locator('.poke-empty').isVisible());
  await page.keyboard.press('Escape');
  check('Esc 关闭卡册并把焦点还给入口', await page.evaluate(() => !window.__QUEENS_DEBUG__.sheet() && document.activeElement.id === 'btnCollection'));
  await solve(page);
  await page.waitForSelector('.poke-reward[data-card-id="25"]');
  check('完成对局随机发卡并入册，未重复记账', (await inventory(page)).total === 1 && (await inventory(page)).counts[25] === 1);
  const rect = await page.locator('.poke-reward > .poke-scene').boundingBox();
  const board = await page.locator('#board').boundingBox();
  check('棋盘上的卡片尺寸正常且完整放入棋盘', rect.width > board.width * .45 && rect.height < board.height && rect.x > board.x);
  await result(page);
  await page.click('#btnRewardCard');
  await page.waitForTimeout(220);
  check('结果卡能直接进入本局卡片详情', await page.locator('.poke-detail .poke-card[data-card-id="25"]').isVisible());
  await page.screenshot({ path: new URL('01-detail-mobile.png', dir).pathname.replace(/^\/(\w:)/, '$1') });
  const card = page.locator('.poke-detail .poke-card');
  const face = await card.boundingBox();
  await page.mouse.move(face.x + face.width * .5, face.y + face.height * .5);
  await page.mouse.down(); await page.mouse.move(face.x + face.width * .85, face.y + face.height * .72, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(180);
  check('拖动改变卡片角度、角色视差和镭射反光位置', await card.evaluate(el =>
    parseFloat(el.style.getPropertyValue('--tilt-x')) > 5 && parseFloat(el.style.getPropertyValue('--parallax-x')) > 0 &&
    getComputedStyle(el).transform.startsWith('matrix3d') &&
    getComputedStyle(el.querySelector('.poke-card-art')).transform !== getComputedStyle(el.querySelector('.poke-card-orbit')).transform &&
    el.style.getPropertyValue('--glare-x') !== '50%'));
  await page.screenshot({ path: new URL('02-tilted-mobile.png', dir).pathname.replace(/^\/(\w:)/, '$1') });
  await card.dblclick();
  check('双击可回正', await card.evaluate(el => el.style.getPropertyValue('--tilt-x') === '0deg'));
  await card.focus(); await page.keyboard.press('ArrowLeft');
  check('键盘也能查看不同角度', await card.evaluate(el => parseFloat(el.style.getPropertyValue('--tilt-x')) < 0));
  await page.keyboard.press('Home'); await page.click('#pokeBack');
  check('卡册正确显示已获得的卡', await page.locator('.poke-slot.is-owned').count() === 1);
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('.poke-reward[data-card-id="25"]');
  check('刷新通关存档保留原卡片与收藏数量', (await inventory(page)).total === 1);
  await page.click('#btnPeek');
  await pick(page, 'reveal', 'pokemon-ripple'); await page.waitForSelector('.poke-reward[data-mode="ripple"]');
  await pick(page, 'confetti', 'fireworks');
  check('切换翻卡或礼炮不重抽、不重复入册', (await inventory(page)).total === 1 && await page.locator('.poke-reward[data-card-id="25"]').count() === 1);
  await pick(page, 'reveal', 'original');
  await page.evaluate(() => window.__QUEENS_DEBUG__.retry()); await solve(page); await result(page);
  check('原版通关选项也能领取卡片，重复卡累计数量', (await inventory(page)).counts[25] === 2 && (await inventory(page)).unique === 1);
  await pick(page, 'reveal', 'pokemon');
  await page.evaluate(() => { window.cardTestRandom = Math.floor(4294967296 * .06); window.__QUEENS_DEBUG__.newGame(4); });
  await solve(page); await page.waitForSelector('.board.look-is-animating .look-tiles');
  check('新一局重新随机，能抽到不同宝可梦', (await inventory(page)).counts[1] === 1 && (await inventory(page)).total === 3);
  await page.evaluate(() => window.__QUEENS_DEBUG__.newGame(4)); await canPlay(page); await page.waitForTimeout(1250);
  check('中断翻卡不会丢失已得卡，也不会留下旧奖励和结果', (await inventory(page)).total === 3 && await page.locator('.poke-reward, #result:not([hidden])').count() === 0);
  await page.evaluate(async () => (await import('/src/js/ui/win.js')).failByTimeout());
  check('失败对局不发卡', (await inventory(page)).total === 3);
  await page.evaluate(() => window.__QUEENS_DEBUG__.startDaily('easy')); await solve(page); await result(page);
  check('每日挑战正常领卡且每日完成记录保留', (await inventory(page)).total === 4 && await page.evaluate(() => window.__QUEENS_DEBUG__.daily().done.easy));
  await page.click('#btnPeek'); await page.click('#btnCollection'); await page.click('[data-card-filter="all"]');
  await page.setViewportSize({ width: 320, height: 640 }); await page.waitForTimeout(220);
  check('320px 卡册没有横向溢出', await page.locator('#collectionSheet').evaluate(el => el.scrollWidth <= el.clientWidth));
  await page.screenshot({ path: new URL('03-album-320.png', dir).pathname.replace(/^\/(\w:)/, '$1') });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.click('.poke-slot.is-owned[data-card-id="25"]');
  await page.screenshot({ path: new URL('04-detail-desktop.png', dir).pathname.replace(/^\/(\w:)/, '$1') });

  const reduced = await setup({ reducedMotion: 'reduce' }); await solve(reduced); await result(reduced);
  check('减少动态效果仍领卡，且无翻面与礼炮', (await inventory(reduced)).total === 1 && await reduced.locator('.poke-reward').count() === 1 && await reduced.locator('.look-tile-card, .confetti, .look-celebration').count() === 0);
  const broken = await setup({ blockArt: true });
  await solve(broken); await result(broken);
  check('立绘请求失败也能结算、入册和显示卡名', (await inventory(broken)).total === 1 && await broken.locator('.poke-reward .art-unavailable').count() === 1 && await broken.locator('.poke-card-name').first().textContent().then(s => s.includes('皮卡丘')));
  const privatePage = await setup({}, () => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'queens.cards.v1') throw new DOMException('blocked', 'QuotaExceededError'); return set.call(this, key, value); };
  });
  await solve(privatePage); await result(privatePage);
  check('存储被禁用时仍能领取与展示，明确提示仅本页保存', (await inventory(privatePage)).total === 1 && !(await inventory(privatePage)).saved);
  const corrupt = await setup({}, () => localStorage.setItem('queens.cards.v1', '{broken'));
  await solve(corrupt); await result(corrupt);
  check('损坏的收藏存档可恢复，不阻塞游戏', (await inventory(corrupt)).total === 1);
  const touch = await setup({ isMobile: true, hasTouch: true });
  await solve(touch); await result(touch); await touch.click('#btnRewardCard');
  const touchCard = touch.locator('.poke-detail .poke-card'), tr = await touchCard.boundingBox();
  const client = await touch.context().newCDPSession(touch);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tr.x + tr.width * .5, y: tr.y + tr.height * .5 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tr.x + tr.width * .8, y: tr.y + tr.height * .65 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('触屏拖动能改变角度并在松手后保留', await touchCard.evaluate(el => parseFloat(el.style.getPropertyValue('--tilt-x')) > 5 && !el.classList.contains('is-dragging')));
  const shared = await setup(); await canPlay(shared);
  await shared.evaluate(async () => (await import('/src/js/core/storage.js')).doSave());
  const other = await shared.context().newPage(); await other.goto(url); await canPlay(other);
  await solve(shared); await solve(other); await result(other);
  check('两个标签页完成同一存档只领取一次', (await inventory(shared)).total === 1);
  check('共享存档的另一页仍能从结果卡查看已领卡片', await other.locator('#btnRewardCard').isVisible());
  check('浏览器无脚本错误', errors.length === 0);
  console.log(`\n${checks} checks passed.`);
} finally { await browser.close(); }
