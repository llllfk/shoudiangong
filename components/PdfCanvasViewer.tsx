"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 用 pdf.js 画布渲染 PDF，避免手机 / WebView 对 iframe PDF 直接触发下载。
 * 按 devicePixelRatio 提高像素密度，避免手机端发糊。
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
        // blob: 本地预览；http(s) 再拉取。优先首屏渲染第 1 页，其余后台继续画。
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

        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
        const cssWidth = Math.max(
          host.clientWidth || window.innerWidth - 24,
          280,
        );

        const renderPage = async (pageNum: number) => {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;

          const base = page.getViewport({ scale: 1 });
          const fitScale = cssWidth / base.width;
          const viewport = page.getViewport({ scale: fitScale * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
          canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
          canvas.style.maxWidth = "100%";
          canvas.style.display = "block";
          canvas.style.margin = "0 auto 10px";
          canvas.style.background = "#fff";
          canvas.setAttribute("aria-label", `${title} 第 ${pageNum} 页`);

          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) throw new Error("无法创建画布");

          host.appendChild(canvas);
          await page.render({
            canvasContext: ctx,
            viewport,
          }).promise;
        };

        // 先出首页，立刻结束 loading
        if (pdf.numPages >= 1) {
          await renderPage(1);
          if (!cancelled) setLoading(false);
        } else if (!cancelled) {
          setLoading(false);
        }

        for (let pageNum = 2; pageNum <= pdf.numPages; pageNum++) {
          await renderPage(pageNum);
          if (cancelled) return;
        }
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
