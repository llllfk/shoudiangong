/** 触发浏览器/壳内「另存为」到本地，尽量不离开当前页面 */

import { safeDocumentFilename } from "@/lib/documents";

export async function downloadToLocal(
  viewPath: string,
  filename: string,
): Promise<void> {
  const safeName = safeDocumentFilename(filename);
  // blob: 预览地址不能拼 query；同源接口才带 download 参数
  const url = viewPath.startsWith("blob:")
    ? viewPath
    : `${viewPath}${viewPath.includes("?") ? "&" : "?"}download=1&filename=${encodeURIComponent(safeName)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载失败（HTTP ${res.status}）`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = safeName;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }
}
