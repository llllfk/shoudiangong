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
| POST | `/api/chat` | 发起对话，立即返回 `conversationId` + `chatId` |
| GET | `/api/chat/status` | 短轮询状态；`completed` 时返回 `answer` 并落库 |
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

## Electron 桌面端（加载线上域名）

默认打开：`https://556fwr627w.coze.site`（可用环境变量 `ELECTRON_APP_URL` 覆盖）。

```bash
npm install
npm run electron:dev          # 本地调试窗口
npm run electron:build        # 打包 Windows 安装包
```

产物默认输出到：`%LOCALAPPDATA%\Temp\pantograph-electron\`（避免中文工程路径导致 Windows 打包锁文件失败）。  
含 NSIS 安装程序与 `win-unpacked` 免安装目录。电脑需能访问该域名；PAT 等密钥仍在服务端，不进 exe。

## Android App（Capacitor + Android Studio）

App 内 WebView 加载同一线上站点：`https://556fwr627w.coze.site`（可用 `CAPACITOR_SERVER_URL` 覆盖）。

```bash
npm install
npx cap sync android    # 同步配置到 android/
npx cap open android    # 用 Android Studio 打开工程
```

在 Android Studio 中：

1. 等待 Gradle 同步完成（用 Studio 自带 JDK 17）
2. 连真机或开模拟器
3. 菜单 **Build → Build Bundle(s) / APK(s) → Build APK(s)**  
   - Debug APK：`android/app/build/outputs/apk/debug/app-debug.apk`  
4. 正式发布：**Build → Generate Signed Bundle / APK**（需签名密钥）

也可命令行（需本机已配 Android SDK）：

```bash
npm run cap:apk
```

说明：改网站代码并重新部署后，App 一般不用重装；只有改了 `capacitor.config.ts` / 原生配置时才需再 `cap sync` 并重打 APK。
