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

export function looksLikeDocumentName(name: string): boolean {
  return DOC_EXT.test(name.trim());
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
    return decodeURIComponent(base).slice(0, 180);
  } catch {
    return "document";
  }
}

export function canInlinePreview(contentType: string, filename?: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes("pdf") || ct.startsWith("text/")) return true;
  if (filename && /\.pdf$/i.test(filename)) return true;
  if (filename && /\.(txt|csv)$/i.test(filename)) return true;
  return false;
}
