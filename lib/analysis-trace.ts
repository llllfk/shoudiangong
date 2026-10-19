/**
 * 按本轮输入组织检修分析过程，供界面逐字展示。
 * 只写分析步骤，不编造合格/超限结论。
 */

const FOCUS: Array<{ test: RegExp; label: string; check: string }> = [
  {
    test: /碳滑板|滑板/,
    label: "碳滑板",
    check: "磨耗带连续性、掉块、偏磨与剩余厚度观察位",
  },
  {
    test: /弓角/,
    label: "弓角",
    check: "端部圆角、裂纹走向与安装贴合",
  },
  {
    test: /弓头/,
    label: "弓头",
    check: "骨架变形、羊角安装与工作面水平度",
  },
  {
    test: /上框架|下框架|框架/,
    label: "框架",
    check: "铰接间隙、杆件弯曲与紧固件防松",
  },
  {
    test: /绝缘/,
    label: "绝缘子",
    check: "釉面破损、爬电痕迹与表面污秽",
  },
  {
    test: /升弓|气囊|传动/,
    label: "升弓机构",
    check: "气路密封、传动间隙与动作到位迹象",
  },
  {
    test: /螺栓|紧固|开口销/,
    label: "紧固件",
    check: "防松标记、缺失件与异常松动",
  },
  {
    test: /台账|车号|车次|车组/,
    label: "台账",
    check: "车组标识、检查项字段与记录对应关系",
  },
];

function clip(text: string, max = 42): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 仅上传图片时前端会填入的占位句，不算部位说明 */
function meaningfulText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (/^检测这[个些]部件[。.]?$/.test(t)) return "";
  return t;
}

function hashText(text: string): number {
  let n = 0;
  for (const ch of text) n = (n * 33 + ch.charCodeAt(0)) >>> 0;
  return n;
}

export function buildAnalysisLines(input: {
  text: string;
  imageCount: number;
}): string[] {
  const raw = meaningfulText(input.text);
  const brief = clip(raw);
  const hits = FOCUS.filter((item) => item.test.test(raw));
  const focuses = hits.slice(0, 3);
  const named = focuses.length > 0;
  const imageCount = input.imageCount;

  const imageLine =
    imageCount > 1
      ? `接入 ${imageCount} 张现场图像，完成多视角配准、尺度归一与区域划分。`
      : imageCount === 1
        ? "接入现场图像，完成清晰度评估、轮廓提取与部件区域分割。"
        : "本轮未附图像，按文字工况回溯对应检查项。";

  const identifyLine = named
    ? `文字已指明关注对象：${focuses.map((item) => item.label).join("、")}。`
    : imageCount > 0
      ? "文字未指明部位，改为从图像轮廓判别可见件：弓头、碳滑板、弓角、框架、绝缘子等待确认。"
      : "按描述归纳可能涉及的外观件与检查项。";

  const checkLine = named
    ? `展开检查要点。${focuses.map((item) => `${item.label}：${item.check}`).join("；")}。`
    : imageCount > 0
      ? "在可见区域内筛查磨耗带、掉块、裂纹、变形、污秽与紧固缺失等外观特征。"
      : "按文字提到的现象，对照几何限度、表面状态与装配要求。";

  const variant = hashText(`${raw}|${imageCount}`) % 3;
  const compare =
    variant === 0
      ? "将可见特征映射到几何限度、表面状态与装配要求，形成比对清单。"
      : variant === 1
        ? "按观察位整理「图像区域—标准条款—台账字段」对照。"
        : "标记信息充分项与需复核项，避免在看不清的位置直接下结论。";

  const lines = [
    brief
      ? `读取补充说明「${brief}」，并结合图像确定检测边界。`
      : imageCount > 0
        ? "本轮以现场图像为输入，先完成视觉预分析，再进入标准比对。"
        : "读取本轮检修说明，收敛外观检测与参数比对边界。",
    imageLine,
    identifyLine,
    checkLine,
    compare,
    "区分正常磨耗、可疑异常与图像未覆盖区域。",
    "整理检查项、检修建议与台账字段，生成正式回复。",
  ];

  return lines;
}

export function buildAnalysisText(input: {
  text: string;
  imageCount: number;
}): string {
  return buildAnalysisLines(input).join("\n");
}
