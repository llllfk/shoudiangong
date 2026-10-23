/** 从智能体回复中提取「存在问题」的部件（【部件】…【结果】存在问题） */

export type ProblemPart = {
  part: string;
  item?: string;
  desc?: string;
  action?: string;
};

function field(block: string, name: string): string {
  const re = new RegExp(`【${name}】\\s*([^\\n【]+)`);
  return block.match(re)?.[1]?.trim() || "";
}

export function extractProblemParts(text: string): ProblemPart[] {
  if (!text.trim()) return [];
  const blocks = text.split(/(?=【部件】)/);
  const out: ProblemPart[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (!/【结果】[^\n]*存在问题/.test(block)) continue;
    const part = field(block, "部件");
    if (!part || seen.has(part)) continue;
    seen.add(part);
    out.push({
      part,
      item: field(block, "检查项") || undefined,
      desc: field(block, "描述") || undefined,
      action: field(block, "检修建议") || undefined,
    });
  }

  // 全貌总结行兜底：检出异常 N 项：导流线——…
  if (out.length === 0) {
    const m = text.match(/检出异常\s*\d+\s*项[：:]\s*([^\n]+)/);
    if (m?.[1]) {
      const chunk = m[1].split(/[；;]/)[0]?.trim() || "";
      const name = chunk.split(/——|—|-/)[0]?.trim();
      if (name && !/均正常|无异常|0\s*项/.test(name)) {
        out.push({ part: name, desc: chunk.includes("——") ? chunk.split("——")[1]?.trim() : undefined });
      }
    }
  }

  return out;
}
