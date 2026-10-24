/**
 * 检修结构化回复展示整理。
 * 注意：不要用 **【标签】** 加粗——全角【】会触发 CommonMark
 * 强调边界规则，导致 ** 原样显示。
 */

const FIELD_TAG =
  "部件|检查项|结果|描述|检修建议|台账|检测总结";

export const INSPECTION_FIELD_NAMES = [
  "部件",
  "检查项",
  "结果",
  "描述",
  "检修建议",
  "台账",
  "检测总结",
] as const;

export type InspectionFieldName = (typeof INSPECTION_FIELD_NAMES)[number];

export type InspectionField = {
  name: InspectionFieldName;
  value: string;
};

export type InspectionPartBlock = {
  kind: "part";
  fields: InspectionField[];
};

export type InspectionTextBlock = {
  kind: "text";
  text: string;
};

export type InspectionBlock = InspectionPartBlock | InspectionTextBlock;

const HAS_FIELD_RE = new RegExp(`【(?:${FIELD_TAG})】`);
const FIELD_LINE_RE = new RegExp(
  `^\\*{0,2}【(${FIELD_TAG})】\\*{0,2}\\s*(.*)$`,
);

export function hasInspectionFields(text: string): boolean {
  return HAS_FIELD_RE.test(text || "");
}

/** 强制每个【标签】独占一行，并去掉错误的 ** 包裹 */
export function formatAssistantMarkdown(raw: string): string {
  let s = (raw || "").replace(/\r\n/g, "\n").trim();
  if (!s || !HAS_FIELD_RE.test(s)) return raw;

  s = s.replace(
    new RegExp(`\\*{0,2}(【(?:${FIELD_TAG})】)\\*{0,2}`, "g"),
    "$1",
  );
  s = s.replace(
    new RegExp(`([^\\n])(【(?:${FIELD_TAG})】)`, "g"),
    "$1\n$2",
  );
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");

  return s.trim();
}

/**
 * 解析为「部件卡片」+ 普通文本块，供结构化渲染。
 */
export function parseInspectionBlocks(raw: string): InspectionBlock[] {
  const text = formatAssistantMarkdown(raw);
  if (!hasInspectionFields(text)) {
    return text ? [{ kind: "text", text }] : [];
  }

  const lines = text.split("\n");
  const blocks: InspectionBlock[] = [];
  let current: InspectionField[] | null = null;
  let textBuf: string[] = [];

  const flushText = () => {
    const t = textBuf.join("\n").trim();
    textBuf = [];
    if (t) blocks.push({ kind: "text", text: t });
  };

  const flushPart = () => {
    if (current && current.length > 0) {
      blocks.push({ kind: "part", fields: current });
    }
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current) {
        // 部件块内空行忽略
        continue;
      }
      flushText();
      continue;
    }

    const m = trimmed.match(FIELD_LINE_RE);
    if (m) {
      flushText();
      const name = m[1] as InspectionFieldName;
      const value = (m[2] || "").trim();

      if (name === "部件") {
        flushPart();
        current = [{ name, value }];
      } else if (name === "检测总结") {
        flushPart();
        blocks.push({ kind: "part", fields: [{ name, value }] });
      } else if (
        name === "台账" &&
        /外观部件已全部检查完成/.test(value)
      ) {
        flushPart();
        blocks.push({ kind: "part", fields: [{ name, value }] });
      } else if (current) {
        current.push({ name, value });
      } else {
        // 孤立字段：自成一小块
        blocks.push({ kind: "part", fields: [{ name, value }] });
      }
      continue;
    }

    if (current) {
      // 续行接到上一个字段
      const last = current[current.length - 1];
      last.value = last.value ? `${last.value}\n${trimmed}` : trimmed;
    } else {
      textBuf.push(line);
    }
  }

  flushPart();
  flushText();
  return blocks;
}
