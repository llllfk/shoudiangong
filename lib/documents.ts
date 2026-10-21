/** 智能体回复中的文档链接识别与处理 */

const DOC_EXT =
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf)(?:$|[?#])/i;

const DOC_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "text/plain",
  "text/csv",
  "application/rtf",
];

export function isDocumentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (DOC_EXT.test(u.pathname)) return true;
    // 部分平台链接把文件名放在 query
    if (DOC_EXT.test(u.search)) return true;
    return false;
  } catch {
    return false;
  }
}

export function isDocumentContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(";")[0].trim();
  return DOC_CONTENT_TYPES.some((p) => ct === p || ct.startsWith(p));
}

/** 是否是可读的短文件名（排除整段 URL，避免下载时以链接当文件名） */
export function looksLikeDocumentName(name: string): boolean {
  const t = name.trim();
  if (!t || t.length > 120) return false;
  if (/^https?:\/\//i.test(t) || t.includes("://")) return false;
  // 路径/查询串不是「文件名」
  if (/[\/\\?]/.test(t)) return false;
  return DOC_EXT.test(t);
}

export function extractDocumentUrls(markdown: string): string[] {
  const found = new Set<string>();
  const mdLink = /\[([^\]]*)]\((https?:\/\/[^)\s]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = mdLink.exec(markdown))) {
    const label = m[1] || "";
    const url = m[2];
    // URL 带扩展名，或锚文本是文档名（短链常见）
    if (isDocumentUrl(url) || looksLikeDocumentName(label)) {
      found.add(url);
    }
  }
  const bare = /https?:\/\/[^\s<>)"']+/gi;
  while ((m = bare.exec(markdown))) {
    const cleaned = m[0].replace(/[),.，。；;]+$/, "");
    if (isDocumentUrl(cleaned)) found.add(cleaned);
  }
  return [...found];
}

export function guessFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").filter(Boolean).pop() || "document";
    const decoded = decodeURIComponent(base).replace(/[\\"\r\n]/g, "_");
    // 无扩展名时按 pdf 兜底（平台签名链常见）
    if (!DOC_EXT.test(decoded)) return `${decoded.slice(0, 160)}.pdf`;
    return decoded.slice(0, 180);
  } catch {
    return "document.pdf";
  }
}

/** 下载/展示用的安全文件名，绝不使用整段 URL */
export function safeDocumentFilename(
  preferred?: string | null,
  sourceUrl?: string,
  fallback = "document.pdf",
): string {
  const raw = preferred?.trim() || "";
  if (raw && looksLikeDocumentName(raw)) {
    return raw.replace(/[\\"\r\n]/g, "_").slice(0, 120);
  }
  // preferred 其实是 URL 时，从中取路径末段
  if (raw && /^https?:\/\//i.test(raw)) {
    return guessFilenameFromUrl(raw);
  }
  if (sourceUrl) {
    return guessFilenameFromUrl(sourceUrl);
  }
  return fallback;
}

/** PDF / 纯文本可在应用内 iframe 直接预览，无需 Office。 */
export function canInlinePreview(contentType: string, filename?: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes("pdf") || ct.startsWith("text/")) return true;
  if (filename && /\.pdf$/i.test(filename)) return true;
  if (filename && /\.(txt|csv)$/i.test(filename)) return true;
  return false;
}

export function displayDocName(title?: string, filename?: string): string {
  const t = title?.trim();
  if (t && looksLikeDocumentName(t)) return t;
  // 可读标题（非 URL、非超长 UUID 文件名）
  if (
    t &&
    !/^https?:\/\//i.test(t) &&
    !/[\/\\?]/.test(t) &&
    !/^[0-9a-f-]{20,}\./i.test(t) &&
    t.length <= 80
  ) {
    return t;
  }
  const f = filename?.trim();
  if (f && looksLikeDocumentName(f)) return f;
  if (f && !/^https?:\/\//i.test(f) && !/[\/\\?]/.test(f)) return f;
  return "文档";
}
