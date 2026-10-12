"use client";

import { useCallback, useEffect, useState } from "react";
import {
  canDocxPreview,
  canInlinePreview,
  displayDocName,
} from "@/lib/documents";
import { downloadToLocal } from "@/lib/download";

export type DocViewerState = {
  title: string;
  viewPath: string;
  contentType: string;
  filename: string;
};

export function DocumentViewer({
  doc,
  onClose,
}: {
  doc: DocViewerState;
  onClose: () => void;
}) {
  const name = displayDocName(doc.title, doc.filename);
  const pdfOrText = canInlinePreview(doc.contentType, doc.filename);
  const isDocx = canDocxPreview(doc.contentType, name);
  const [html, setHtml] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(isDocx);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadHint, setDownloadHint] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setDownloadHint(null);
    setLoadError(null);
    try {
      await downloadToLocal(doc.viewPath, name);
      setDownloadHint("已开始下载到本地");
      window.setTimeout(() => setDownloadHint(null), 2500);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "下载失败");
    } finally {
      setDownloading(false);
    }
  }, [doc.viewPath, name]);

  // Word：拉取文件后转 HTML，应用内预览
  useEffect(() => {
    if (!isDocx || pdfOrText) return;
    let cancelled = false;
    setPreviewing(true);
    setLoadError(null);
    setHtml(null);

    (async () => {
      try {
        const res = await fetch(doc.viewPath);
        if (!res.ok) {
          throw new Error(`读取文档失败（HTTP ${res.status}）`);
        }
        const buffer = await res.arrayBuffer();
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        if (cancelled) return;
        if (!result.value?.trim()) {
          throw new Error("文档内容为空或无法解析");
        }
        setHtml(result.value);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Word 预览失败，请下载到本地查看",
          );
        }
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc.viewPath, isDocx, pdfOrText]);

  const showFallback = !pdfOrText && !isDocx;

  return (
    <div
      className="fixed inset-0 z-[2000] flex flex-col bg-[rgba(11,30,58,0.55)]"
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 bg-gradient-to-r from-[#0b1e3a] to-[#12305c] px-4 text-white">
        <div className="min-w-0 truncate text-[15px] font-medium">{name}</div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            className="rounded-md border border-white/25 bg-white/15 px-3 py-1.5 text-[13px] disabled:opacity-50"
          >
            {downloading ? "下载中…" : "下载到本地"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-[13px]"
          >
            关闭
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-[#f3f5f8]">
        {pdfOrText ? (
          <iframe
            title={name}
            src={doc.viewPath}
            className="h-full w-full border-0 bg-white"
          />
        ) : isDocx ? (
          <div className="min-h-0 flex-1 overflow-auto bg-white">
            {previewing && (
              <p className="px-6 py-8 text-[13px] text-[var(--primary-light)]">
                正在生成预览…
              </p>
            )}
            {loadError && (
              <div className="m-auto max-w-md px-6 py-10 text-center">
                <p className="text-[13px] text-[#b42318]">{loadError}</p>
                <button
                  type="button"
                  onClick={() => void handleDownload()}
                  disabled={downloading}
                  className="mt-5 inline-flex rounded-lg bg-[var(--primary-light)] px-4 py-2.5 text-sm text-white disabled:opacity-50"
                >
                  {downloading ? "下载中…" : "下载到本地"}
                </button>
              </div>
            )}
            {html && (
              <div
                className="doc-html mx-auto max-w-3xl px-5 py-6 text-[14px] leading-7 text-[var(--text-main)]"
                // mammoth 输出受控转换结果，仅用于预览
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </div>
        ) : (
          <div className="m-auto max-w-md px-6 text-center">
            <p className="text-[15px] font-medium text-[var(--text-main)]">
              {name}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-sub)]">
              该格式暂不支持页面内预览。请下载到本地后用对应软件打开，不会跳转外部浏览器。
            </p>
            {downloadHint && (
              <p className="mt-4 text-[13px] text-[var(--accent)]">
                {downloadHint}
              </p>
            )}
            {loadError && (
              <p className="mt-4 text-[13px] text-[#b42318]">{loadError}</p>
            )}
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="mt-5 inline-flex rounded-lg bg-[var(--primary-light)] px-4 py-2.5 text-sm text-white disabled:opacity-50"
            >
              {downloading ? "下载中…" : "下载到本地"}
            </button>
          </div>
        )}
      </div>

      {showFallback && downloadHint && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-[#12305c] px-3 py-1.5 text-[12px] text-white">
          {downloadHint}
        </div>
      )}
    </div>
  );
}
