/** 触发浏览器/壳内「另存为」到本地，尽量不离开当前页面 */

export async function downloadToLocal(
  viewPath: string,
  filename: string,
): Promise<void> {
  const sep = viewPath.includes("?") ? "&" : "?";
  const url = `${viewPath}${sep}download=1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载失败（HTTP ${res.status}）`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "document";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }
}
