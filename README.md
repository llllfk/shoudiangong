# 受电弓智能检修系统

Next.js 15 全栈应用：通过扣子 OpenAPI 与检修智能体对话，供工控平板 / 移动端使用。

## 技术栈

- Next.js 15（App Router）+ TypeScript + Tailwind CSS 4
- 服务端代理调用 `api.coze.cn`（PAT 不进前端）

## 环境变量

复制 `.env.example` 为 `.env.local` 并填写：

| 变量 | 说明 |
|------|------|
| `COZE_BOT_ID` | 智能体 ID（必填） |
| `COZE_PAT` | 个人访问令牌，需 chat / getChat / listMessage / uploadFile（必填） |
| `COZE_USER_ID` | 可选，默认 `competition_user_01` |
| `DATABASE_URL` | PostgreSQL（对话落库；Coze 通常自动注入） |
| `COZE_STORAGE_*` | 对象存储 URL/BUCKET/AK/SK（图片；Coze 通常自动注入） |

智能体须已发布到 **API 渠道**。

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:3000`。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/config` | 是否已配置（不回传密钥） |
| GET | `/api/conversations` | 当前用户对话记录列表 |
| GET | `/api/history` | 最近一场对话消息（可带 `conversationId`） |
| POST | `/api/chat` | 发文本/图片并取回复（非流式轮询，成功后落库） |
| POST | `/api/upload` | 上传图片 → `fileId` + S3 `imageUri` |

### POST `/api/chat` 请求体

```json
{
  "text": "开始检测碳滑板",
  "fileId": "可选",
  "imageUrl": "可选公网图片 URL",
  "conversationId": "可选，多轮上下文"
}
```

成功：`{ "data": { "conversationId": "...", "answer": "..." } }`  
失败：`{ "error": "..." }`

## 部署

`npm run build` → `npm run start`。在 Coze 编程 / 部署面板配置生产环境变量 `COZE_BOT_ID`、`COZE_PAT`。
