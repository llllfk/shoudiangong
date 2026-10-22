import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 云端构建不强制安装 eslint，避免缺包打断构建日志
  eslint: {
    ignoreDuringBuilds: true,
  },
  // pdfkit 用 Node 原生加载字体资源，勿被打包进 serverless bundle
  serverExternalPackages: ["pdfkit", "fontkit"],
  outputFileTracingIncludes: {
    "/api/reports/pdf": [
      "./assets/fonts/**/*",
      "./node_modules/pdfkit/js/data/**/*",
      "./node_modules/pdfkit/js/standard-fonts/**/*",
    ],
  },
};

export default nextConfig;
