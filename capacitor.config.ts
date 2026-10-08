import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Next.js 全栈（含 /api）需由服务端运行。
 * App 内 WebView 加载 CAPACITOR_SERVER_URL；未配置时使用本地 www 兜底页。
 *
 * 示例：
 * - 开发联调：http://192.168.1.10:3000 （手机与电脑同网段）
 * - 正式环境：https://your-app.coze.site
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.pantograph.inspection",
  appName: "受电弓智能检修",
  webDir: "www",
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
      }
    : undefined,
  android: {
    allowMixedContent: true,
  },
};

export default config;
