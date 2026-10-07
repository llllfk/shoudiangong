# AGENTS.md

## 项目概览
受电弓智能检修系统 —— 纯静态单页「壳页面」，用于全屏嵌入智能体对话窗口。无后端、无数据库、无登录，无构建步骤。

## 技术栈
- 原生 HTML + CSS + JavaScript（禁止引入 React/Vue/Next.js 等框架）
- 单页应用，仅 `index.html`

## 结构与行为
- 顶部标题栏：深蓝渐变（`#0B1E3A → #12305C`），左侧绿色状态点 + 标题，右侧半透明标签「AI 辅助外观检测」，高度 56px。
- 对话区：iframe 全屏嵌入智能体对话页，占满剩余高度。
- 页面顶部 JS 配置区：`const CONFIG = { CHAT_URL: '' }`，粘贴智能体公开对话链接后自动加载。
- CHAT_URL 为空时显示居中引导卡片；iframe 加载时显示 spinner + 「正在连接检修助手」，onload 后隐藏；8 秒超时兜底提示「加载较慢，请检查网络或稍后刷新」。
- iframe 属性：`allow="microphone; clipboard-write"`、`allowfullscreen`。

## 移动端
- viewport：`width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`
- 高度统一使用 `100dvh` 兼容移动端浏览器。

## 编码规范
- 视觉为工程设备检修风格：专业稳重、蓝色主色调、干净无多余装饰。
- 页面代码与文案中不得出现平台相关字样（如 coze）。

## 本地运行
`.coze` 已配置为 `python3 -m http.server ${DEPLOY_RUN_PORT}`，修改后刷新即可。