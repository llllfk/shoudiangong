/** 智能体「生成报告」输出的 JSON 契约 */

export type AppearanceRow = {
  no: number;
  part: string;
  item: string;
  result: string;
  defect: string;
  action: string;
};

export type PerformanceRow = {
  item: string;
  value: string;
  range: string;
  prev: string;
  result: string;
};

export type ElectricalBlock = {
  faultType: string;
  phenomenon: string;
  hypothesis: string;
  cause: string;
  signal: string;
  result: string;
};

export type InspectionReport = {
  title: string;
  mechanical: {
    appearance: AppearanceRow[];
    performance: PerformanceRow[];
    analysis: {
      vsStandard: string;
      vsHistory: string;
    };
    suggestions: string[];
  };
  electrical: ElectricalBlock | null;
};

export function isInspectionReport(value: unknown): value is InspectionReport {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== "string" || !v.title.trim()) return false;
  const mechanical = v.mechanical;
  if (!mechanical || typeof mechanical !== "object") return false;
  const m = mechanical as Record<string, unknown>;
  if (!Array.isArray(m.appearance) || m.appearance.length < 1) return false;
  if (!Array.isArray(m.performance) || m.performance.length < 1) return false;
  if (!m.analysis || typeof m.analysis !== "object") return false;
  if (!Array.isArray(m.suggestions)) return false;
  if (v.electrical !== null && (typeof v.electrical !== "object" || !v.electrical)) {
    return false;
  }
  const first = m.appearance[0] as Record<string, unknown> | undefined;
  if (!first || typeof first.part !== "string" || typeof first.result !== "string") {
    return false;
  }
  return true;
}

/** 从助手回复中提取报告 JSON（```json 代码块优先） */
export function extractInspectionReport(
  markdown: string,
): InspectionReport | null {
  const fenced =
    /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenced.exec(markdown))) {
    const parsed = tryParseReport(m[1]);
    if (parsed) return parsed;
  }

  // 无代码块时：尝试从首个 { 到末个 } 截取
  const start = markdown.indexOf("{");
  const end = markdown.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParseReport(markdown.slice(start, end + 1));
  }
  return null;
}

function tryParseReport(raw: string): InspectionReport | null {
  try {
    const data = JSON.parse(raw.trim()) as unknown;
    return isInspectionReport(data) ? data : null;
  } catch {
    return null;
  }
}
