---
trigger: model_decision
description: Cat Paradise (猫狗乐园) TapTap 小游戏提审打包格式规范（以及其他平台打包规则占位）
---

# Cat Paradise 渠道打包格式规范

> 后续若新增其他渠道（如微信小游戏、抖音小游戏、纯 H5 等），请在本规则中按渠道分节补充，互不混淆。

## [TapTap] 小游戏提审包打包规范

1. **适用项目**：`D:\catParadise\catParadise`（Cocos Creator 3.8.8，`web-mobile` 平台）
2. **构建前检查**：
   - `assets/scripts/Main.ts` 中 `private readonly enableGm = false;`（正式提审包必须关闭 GM）。
   - 先停止占用 `build/web-mobile` 的本地预览进程（如 `temp/serve8087.cjs`）。
   - 必须通过全部 3 套回归测试（`test-responsive-layout.cjs`、`test-rewarded-video.cjs`、`test-yard-poop-layout.cjs`）。
3. **Cocos 命令行构建参数**：
   - `--project D:\catParadise\catParadise --build platform=web-mobile;debug=false;md5Cache=true`
   - 预期退出码：`36`。
4. **构建后补丁（必须执行）**：
   - 将 `build/web-mobile/src/settings*.json` 中的 `"totalTime": <N>` 替换为 `"totalTime": 0`（移除 2 秒 Cocos 黑屏 Splash）。
5. **ZIP 压缩包结构（核心强规则 · TapTap 专用）**：
   - **输出目录**：`D:\catParadise\catParadise\release\`
   - **命名格式**：`catParadise-web-mobile-v<主>.<次>.<修订>-pages-yard-taptap.zip`（例如 `catParadise-web-mobile-v1.0.12-pages-yard-taptap.zip`）
   - **顶层目录结构**：压缩包根目录**必须只有唯一一层 `catParadise/` 目录**，所有构建产物均置于 `catParadise/` 之下：
     - `catParadise/index.html`（必需）
     - `catParadise/.runtime-bridge/`（必需，**不可跳过隐藏目录**）
     - `catParadise/application.<md5>.js`
     - `catParadise/assets/`
     - `catParadise/cocos-js/`
     - `catParadise/index.<md5>.js`
     - `catParadise/src/settings.<md5>.json`（需校验 `splashScreen.totalTime == 0`）
     - `catParadise/style.<md5>.css`
   - **排除项**：不得包含 `preview*.html` 与 `index.ejs`。
6. **打包后校验**：
   - 校验压缩包顶层唯一键为 `['catParadise']`。
   - 校验存在 `catParadise/index.html` 与 `catParadise/.runtime-bridge/`。
   - 校验 `catParadise/src/settings*.json` 中 `splashScreen.totalTime == 0`。
   - 校验不含 `preview*.html` 与 `index.ejs`。
