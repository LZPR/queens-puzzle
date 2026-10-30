# 外观插件

入口仍是 `index.js`：在本目录写一个插件，import 后加入 `PLUGINS`。
同一类别的新选项会自动出现在外观面板，偏好由 `KIND` 的 key 存盘，未知 id 回退到第一项。

- 原有类别：`surfaces`、`marks`、`pieces`、`lifes`。
- 动作类别：`deals`（开局）、`reveals`（通关）、`confettis`（礼炮）。
- 每个选项提供 `id`、`name`、`desc`、`svg`（展柜预览）。
- 动作选项可提供 `play(ctx)`、`preload()`；开局还可提供 `capture(ctx)` 留下旧画面。
- 插件的 `stylesheet` 指向它自己在本目录下的 CSS，由运行器只加载一次。

```text
looks/
  index.js                登记、分类、默认项
  effects.js              通用动作接口：选择、取消、资源与时序
  transitions.js          斜向 / 逐行 / 涟漪对半折页
  pokemon.js              宝可梦随机藏卡插件与两种翻卡选项
  cards/catalog.js        18 种宝可梦名册与原有立绘
  cards/collection.js     独立集卡存档、一局一卡与去重领取
  cards/card.js           镭射卡面、分层视差与拖动/键盘交互
  cards/album.js          沿用 createSheet 的集卡册
  celebration.js          爱心 / 星芒 / 安静礼炮
  original-effects.js     交回作者原有动画的选项
  effects/tiles.js         翻格插件的画面工具
  effects/tiles.css        翻格插件的样式
  effects/celebration.css  礼炮插件的样式
  effects/cards.css       卡片与集卡册样式
  assets/pokemon/         原有透明 PNG、来源地址与 SHA-256
```

`play(ctx)` 可同步返回，也可返回 `Promise<boolean>`。`false` 表示取消；图片加载失败时应返回 `true`，让游戏继续结算。
`ctx` 提供棋盘 DOM、格子、边长、区域快照、特效容器、`reducedMotion`、`signal`，以及开局的 `previous`。
`animate: false` 用于恢复已通关存档或切换已通关的卡面，只显示卡片，不重复翻面或发卡。插件必须在 `signal` 取消时清理定时器和节点。
完成后还要留在棋盘上的画面，用 `ctx.retain(cleanup)` 登记收尾；换盘前会保留它作为正面快照，装盘时再清理。
动画不修改游戏状态、撤销栈、存档内容、战绩或每日挑战规则。
插件可提供通用的 `mount(ctx)`、`onBoard(ctx)`、`onWin(ctx)` 生命周期；`ctx.boardKey` 标识棋盘，`restored` 区分装盘与恢复，`won` 只读地说明结局。集卡由这些钩子运行，不需要在游戏状态或结算中加入宝可梦专用逻辑。
切换外观只取消对应类别的动作。礼炮与拼图可以自由搭配；已通关时切换礼炮只更新偏好，不重建图片或重播庆祝。翻图期间切换礼炮会在图片完成后播放最终所选的样式一次。

## 集卡与交互

每局成功通关等概率随机获得 18 种宝可梦中的一张，重复卡累计数量。每次重试并再次通关也可领取一张；失败、刷新、切换外观不发新卡。原版保留棋盘选项也能领取，结果卡和顶栏均有集卡册入口。

收藏单独保存在 `queens.cards.v1`，不改游戏存档；本局绑定卡片与领取记录用于避免恢复、快速切换和重复标签页反复领取。收藏只在当前浏览器保存；写盘失败时退到内存并在卡册显示实际状态。旧 `kitten` / `starlight` 偏好自动迁移到两种宝可梦翻卡。

卡面由背景、轨道、透明角色、文字、镭射反光等独立图层组成。鼠标或触屏拖动可旋转卡片，角色与背景产生不同位移；松手保留角度，双击或 Home 回正，方向键也可操作。减少动态效果时不自动翻面或放礼炮，仍可手动查看卡片。角色使用原有 2D 透明立绘，视觉深度来自分层视差，没有生成新的角色图像或 3D 模型。

基座只接通装盘前 / 后、恢复存档、胜利后和礼炮这几个调用点；具体变换、颜色、图片、粒子都在插件内。
`core/state.js`、`game/board.js`、`styles/base/board-states.css` 和样式入口恢复为作者加入每日挑战时的原版内容。
翻格正面使用旧棋盘的区域原色，背面使用新棋盘颜色或通关图片；已填格子的淡化纸色不进入翻牌快照。首次开盘、刷新续玩没有旧棋盘时，两面都使用当前棋盘原色。只有翻转空隙与底板使用 `--bg-body`，跟着页面背景色变化。
每格由旧画面的固定左半页、新画面的固定右半页和双面翻动的右半页构成。只有中轴线以右的半页绕竖直中线向左翻动，类似一本书；所有模式使用同一方向，仅改变斜向、逐行或涟漪的推进顺序。切片按完整格子尺寸绘制后裁切，两半保持原始比例；翻动时保持原色，中轴以一条 1px 细线标出折痕，不叠加阴影或渐变，完全展开后移除折痕和装饰层。单格动作 560ms，逐格延迟不超过 540ms。

浏览器检查：`node tools/check-look-effects.mjs [url]`（Playwright；可通过 `NODE_PATH` 指向已有安装）。
切换回归：`node tools/check-look-switching.mjs [url]`，覆盖通关后切换、静态恢复及翻图期间连续切换。
集卡回归：`node tools/check-pokemon-cards.mjs [url]`，覆盖随机/重复卡、持久化、异常存储、图片失败、多标签去重、鼠标/触屏/键盘和窄屏。
