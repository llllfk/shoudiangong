"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 用 pdf.js 画布渲染 PDF，避免手机 / WebView 对 iframe PDF 直接触发下载。
 */
export function PdfCanvasViewer({
  src,
  title,
}: {
  src: string;
  title: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    (async () => {
      setLoading(true);
      setError(null);
      host.replaceChildren();

      try {
        const res = await fetch(src);
        if (!res.ok) {
          throw new Error(`读取失败（HTTP ${res.status}）`);
        }
        const data = new Uint8Array(await res.arrayBuffer());
        if (cancelled) return;

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;

        const maxW = Math.max(host.clientWidth || window.innerWidth - 24, 280);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;

          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2, maxW / base.width);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.style.marginBottom = "10px";
          canvas.style.background = "#fff";
          canvas.setAttribute("aria-label", `${title} 第 ${pageNum} 页`);

          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("无法创建画布");

          host.appendChild(canvas);
          await page.render({
            canvasContext: ctx,
            viewport,
          }).promise;
        }

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setError(err instanceof Error ? err.message : "PDF 预览失败");
        }
      }
    })();

    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [src, title]);

  return (
    <div className="relative h-full w-full overflow-auto bg-[#e8ebf0]">
      {loading && !error && (
        <p className="px-6 py-8 text-[13px] text-[var(--primary-light)]">
          正在加载预览…
        </p>
      )}
      {error && (
        <p className="px-6 py-8 text-[13px] text-[#b42318]">{error}</p>
      )}
      <div ref={hostRef} className="mx-auto max-w-3xl px-2 py-2" />
    </div>
  );
}
