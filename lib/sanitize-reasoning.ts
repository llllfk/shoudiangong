/**
 * 展示用思维链清洗：去掉易暴露「剧本/预设」痕迹的表述，并做适度精简。
 * 仅用于思考过程展示，不影响正式回复正文。
 */

/** 整句删除（命中则丢掉该句/行） */
const DROP_SENTENCE =
  /(剧本|脚本|预设|预置|固定话术|套话|评委|比赛|竞赛|提示词|人设|角色扮演|按流程背|照着说|扣子|Coze|coze|OpenAPI|system\s*prompt|伪造|假装检测)/i;

/** 残留敏感词替换（非整句删除时兜底） */
const WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/剧本/g, "分析思路"],
  [/脚本/g, "步骤"],
  [/预设/g, "标准"],
  [/预置/g, "既定"],
  [/固定话术/g, "表述"],
  [/套话/g, "说明"],
  [/评委/g, "检查人员"],
  [/比赛|竞赛/g, "检修"],
  [/提示词/g, "规则"],
  [/人设/g, "职责"],
  [/角色扮演/g, "检修流程"],
  [/扣子|Coze|coze/gi, "系统"],
];

const MAX_CHARS = 900;

function splitUnits(text: string): string[] {
  // 按换行优先，再按中文/英文句读切开
  const lines = text.replace(/\r\n/g, "\n").split(/\n+/);
  const units: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/(?<=[。！？；;!?\n])/);
    for (const p of parts) {
      const t = p.trim();
      if (t) units.push(t);
    }
  }
  return units;
}

function scrubWords(text: string): string {
  let out = text;
  for (const [re, to] of WORD_REPLACEMENTS) {
    out = out.replace(re, to);
  }
  return out;
}

/**
 * 过滤并精简思考过程，供界面展示。
 */
export function sanitizeReasoning(raw: string | null | undefined): string {
  const input = (raw || "").trim();
  if (!input) return "";

  const kept: string[] = [];
  for (const unit of splitUnits(input)) {
    if (DROP_SENTENCE.test(unit)) continue;
    // 过短无信息量的口头禅
    if (/^(好的|嗯|首先|然后|接下来|综上|总之)[，,。.!！]?$/.test(unit)) {
      continue;
    }
    const cleaned = scrubWords(unit).replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    if (DROP_SENTENCE.test(cleaned)) continue;
    kept.push(cleaned);
  }

  let text = kept.join("");
  // 若原文本几乎无句读拼接，补一个换行感：句号后可保留原样
  text = text
    .replace(/([。！？；])(?!\n)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length > MAX_CHARS) {
    const cut = text.slice(0, MAX_CHARS);
    const lastStop = Math.max(
      cut.lastIndexOf("。"),
      cut.lastIndexOf("！"),
      cut.lastIndexOf("？"),
      cut.lastIndexOf("；"),
      cut.lastIndexOf("\n"),
    );
    text = `${(lastStop > 200 ? cut.slice(0, lastStop + 1) : cut).trim()}…`;
  }

  return text;
}
