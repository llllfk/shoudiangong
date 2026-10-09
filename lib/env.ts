/** 读取环境变量；优先新名，兼容旧 COZE_*（本地/历史配置） */
export function env(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}
