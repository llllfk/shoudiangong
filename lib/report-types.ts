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
  range: string;
  result: string;
  /** 第1/2/3次实测值（优先） */
  m1?: string;
  m2?: string;
  m3?: string;
  /** 旧版兼容：本次实测 / 上次记录 */
  value?: string;
  prev?: string;
};

/** 统一成三次测量列，兼容旧 JSON */
export function normalizePerformanceRow(row: PerformanceRow): {
  item: string;
  m1: string;
  m2: string;
  m3: string;
  range: string;
  result: string;
} {
  const blank = (v: string | undefined) => {
    const t = (v ?? "").trim();
    return t || "未测量";
  };
  if (row.m1 != null || row.m2 != null || row.m3 != null) {
    return {
      item: row.item,
      m1: blank(row.m1),
      m2: blank(row.m2),
      m3: blank(row.m3),
      range: row.range,
      result: (row.result ?? "").trim(),
    };
  }
  const prev = (row.prev ?? "").trim();
  const value = (row.value ?? "").trim();
  if (!prev || prev === "—") {
    return {
      item: row.item,
      m1: blank(value),
      m2: "未测量",
      m3: "未测量",
      range: row.range,
      result: (row.result ?? "").trim(),
    };
  }
  return {
    item: row.item,
    m1: prev,
    m2: blank(value),
    m3: "未测量",
    range: row.range,
    result: (row.result ?? "").trim(),
  };
}

export type ElectricalBlock = {
  faultType: string;
  phenomenon: string;
  hypothesis: string;
  cause: string;
  signal: string;
  result: string;
};

export type ReportMeta = {
  /** 场次号（由智能体 JSON 传入） */
  sessionNo?: string | number;
  /** 工位号（由智能体 JSON 传入） */
  stationNo?: string | number;
  /** 已废弃：日期一律以服务端生成 PDF 当天为准，忽略智能体填写 */
  date?: string;
};

export type InspectionReport = {
  title: string;
  meta?: ReportMeta;
  mechanical: {
    appearance: AppearanceRow[];
    performance: PerformanceRow[];
    analysis: {
      vsStandard: string;
      /** 三次参数测量比对总结（推荐） */
      vsMeasurements?: string;
      /** 旧字段，等同 vsMeasurements */
      vsHistory?: string;
    };
    suggestions: string[];
  };
  electrical: ElectricalBlock | null;
};

/**
 * 场次/工位取自智能体 JSON；日期固定为服务端生成 PDF 的当天（避免模型编造日期）。
 */
export function resolveReportMeta(report: InspectionReport): {
  sessionNo: string;
  stationNo: string;
  dateLabel: string;
} {
  const sessionNo = String(report.meta?.sessionNo ?? "").trim() || "—";
  const stationNo = String(report.meta?.stationNo ?? "").trim() || "—";
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const dateLabel = `${y}年${m}月${d}日`;
  return { sessionNo, stationNo, dateLabel };
}

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

/** 对话展示时去掉报告 JSON 代码块，避免整段 JSON 刷屏 */
export function stripInspectionReportJson(markdown: string): string {
  const withoutFenced = markdown.replace(/```(?:json)?\s*[\s\S]*?```/gi, (block) => {
    const inner = block.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
    return tryParseReport(inner) ? "" : block;
  });

  // 无代码块但整段就是报告 JSON
  const trimmed = withoutFenced.trim();
  if (tryParseReport(trimmed)) return "";

  // 未闭合的报告对象（完整流结束后偶发）
  const start = withoutFenced.search(/\{\s*"title"\s*:/);
  if (start >= 0) {
    const maybe = withoutFenced.slice(start);
    if (/"mechanical"\s*:/.test(maybe)) {
      return withoutFenced.slice(0, start).replace(/\n{3,}/g, "\n\n").trim();
    }
  }

  return withoutFenced
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 流式输出时隐藏报告 JSON（含未完成的 ```json / 半截 { "title"）。
 * 保留「已生成《…》」等短文案。
 */
export function stripStreamingReportJson(markdown: string): string {
  let s = stripInspectionReportJson(markdown);

  // 未完成的 fenced 代码块
  const fenceIdx = s.search(/```(?:json)?/i);
  if (fenceIdx >= 0) {
    const after = s.slice(fenceIdx);
    if (
      /```(?:json)?\s*$/i.test(after.trimEnd()) ||
      /```(?:json)?[\s\S]*\{/.test(after) ||
      /"title"\s*:/.test(after) ||
      /"mechanical"\s*:/.test(after)
    ) {
      s = s.slice(0, fenceIdx);
    }
  }

  // 未完成的裸 JSON
  const rawIdx = s.search(/\{\s*"title"\s*:/);
  if (rawIdx >= 0) {
    s = s.slice(0, rawIdx);
  }

  // 半截「已生成」后面已无正文时保留该行；多余空行压掉
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
