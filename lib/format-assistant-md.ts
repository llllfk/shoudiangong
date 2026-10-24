/**
 * 展示前整理智能体 Markdown：
 * 标准 MD 会把单换行收成空格，导致【部件】字段挤成一段。
 * 这里强制字段分行、块间留白，标签加粗。
 */

const FIELD_TAG =
  "部件|检查项|结果|描述|检修建议|台账|检测总结";

const HAS_FIELD_RE = new RegExp(`【(?:${FIELD_TAG})】`);

export function formatAssistantMarkdown(raw: string): string {
  let s = raw.replace(/\r\n/g, "\n").trim();
  if (!s || !HAS_FIELD_RE.test(s)) return raw;

  // 先脱掉标签两侧 *，避免 **【】** 被拆行时残留孤立星号
  s = s.replace(
    new RegExp(`\\*{0,2}(【(?:${FIELD_TAG})】)\\*{0,2}`, "g"),
    "$1",
  );

  // 每个【标签】另起一行
  s = s.replace(
    new RegExp(`([^\\n])(【(?:${FIELD_TAG})】)`, "g"),
    "$1\n$2",
  );

  // 统一加粗标签
  s = s.replace(new RegExp(`(【(?:${FIELD_TAG})】)`, "g"), "**$1**");

  // 字段之间空行 → 各自成段，界面才有换行间距
  s = s.replace(
    new RegExp(`\\n(\\*\\*【(?:${FIELD_TAG})】\\*\\*)`, "g"),
    "\n\n$1",
  );

  s = s.replace(/\n{3,}/g, "\n\n");
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");

  return s.trim();
}

/** 是否含检修结构化字段（用于加样式类） */
export function hasInspectionFields(text: string): boolean {
  return HAS_FIELD_RE.test(text);
}
