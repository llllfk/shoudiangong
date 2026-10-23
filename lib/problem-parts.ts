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

  // 不解析【检测总结】合并句，避免无明细块时误弹；必须有【部件】明细
  return out;
}
