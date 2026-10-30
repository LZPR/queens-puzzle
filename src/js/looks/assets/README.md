# 宝可梦卡面资源

原有的两张生成插画已移除，通关奖励统一使用 `pokemon/` 中的 18 张原有透明 PNG 立绘。
这些图片不是 AI 生成，也未改绘或重采样。镭射边框、背景、反光和角色分层视差由代码绘制，不包含重新生成的宝可梦形象。

- 来源：[PokéAPI sprites 的 official-artwork 目录](https://github.com/PokeAPI/sprites/tree/master/sprites/pokemon/other/official-artwork)。使用普通立绘，没有使用 custom shiny 目录。
- 每张原图为 475 × 475 RGBA PNG；具体下载地址和 SHA-256 见 [pokemon/sources.json](pokemon/sources.json)。
- 图片版权归 The Pokémon Company；来源仓库的 [LICENCE.txt](https://github.com/PokeAPI/sprites/blob/master/LICENCE.txt) 也保留了这一声明。来源仓库的代码/数据库许可不改变图片的版权归属。
- 图片随项目保存，游玩时无需访问外部图床或 API。卡片名册见 `../cards/catalog.js`。

扩展卡池时应加入有可核对来源的原有立绘，登记名册及校验值，不使用 AI 生成或 AI 改绘的宝可梦形象。
