# AGENTS.md

## 项目概览
受电弓智能检修系统 —— Next.js 15 全栈单页应用，面向工控平板/移动端。通过扣子 OpenAPI 与检修智能体通信；对话写入 PostgreSQL，图片写入 Coze S3。无登录。报告排版由智能体侧生成，前端原样展示。

## 技术栈
- Next.js 15+（App Router）+ TypeScript（严格模式）+ Tailwind CSS 4
- PostgreSQL（`pg`）+ Coze S3 兼容存储（`@aws-sdk/client-s3`）
- 禁止 Pages Router / GraphQL / custom server
- 对话走服务端代理 `app/api/*` → `https://api.coze.cn`，不使用 WebChat SDK / iframe

## 目录要点
- `app/page.tsx`：首页，挂载对话 UI
- `app/api/chat/route.ts`：发起对话 + 轮询 + 取 answer + 落库
- `app/api/upload/route.ts`：图片 → Coze file_id + S3 URI
- `app/api/conversations/route.ts`：对话记录列表
- `app/api/history/route.ts`：拉取最近一场消息（刷新恢复）
- `app/api/config/route.ts`：前端探测是否已配置（不回传密钥）
- `lib/coze.ts` / `lib/db.ts` / `lib/storage.ts` / `lib/history.ts`
- `components/ChatApp.tsx`：左侧栏 + 对话交互（发文本、发图、展示回复）

## 结构与行为
- 顶部标题栏：深蓝渐变（`#0B1E3A → #12305C`），左侧绿色状态点 + 标题，右侧「AI 辅助外观检测」，高度 56px。
- 左侧栏：「新建对话」+「对话记录」列表；桌面常显，移动端点菜单展开。
- 未配置 `COZE_BOT_ID` / `COZE_PAT` 时显示居中引导卡片。
- 一场检修共用 `conversation_id`；失败/超时提示重试本轮，不自动重发。
- 智能体标记（【部件】【检查项】【结果】【描述】【检修建议】【台账】）原样透传。
- 图片库内只存 `image_uri`（永久标识），展示时按需签临时 URL。

## 环境变量
- `COZE_BOT_ID`（必填）
- `COZE_PAT`（必填，严禁写入前端或提交仓库）
- `COZE_USER_ID`（可选，默认 `competition_user_01`）
- `DATABASE_URL`（对话持久化；Coze 平台通常自动注入）
- `COZE_STORAGE_URL` / `COZE_STORAGE_BUCKET` / `COZE_STORAGE_AK` / `COZE_STORAGE_SK`（图片存储；平台通常自动注入）

## 移动端
- viewport：`width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`
- 高度使用 `100dvh`

## 编码规范
- 视觉：工程设备检修风格，蓝色主色调，干净无多余装饰
- 页面可见文案不出现平台品牌字样
- API 统一返回 `{ data } | { error }`

## 本地运行
```bash
npm install
npm run dev
```
修改后热更新；生产：`npm run build && npm run start`。
