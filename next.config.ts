import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 云端构建不强制安装 eslint，避免缺包打断构建日志
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
