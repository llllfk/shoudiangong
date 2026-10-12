"use client";

import { useCallback, useEffect, useState } from "react";
import { canInlinePreview } from "@/lib/documents";
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
  const inline = canInlinePreview(doc.contentType, doc.filename);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadHint, setDownloadHint] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setDownloadHint(null);
    setLoadError(null);
    try {
      await downloadToLocal(doc.viewPath, doc.filename);
      setDownloadHint("已开始下载到本地");
      window.setTimeout(() => setDownloadHint(null), 2500);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "下载失败");
    } finally {
      setDownloading(false);
    }
  }, [doc.filename, doc.viewPath]);

  // 非预览格式：打开层后自动拉起本地下载
  useEffect(() => {
    if (inline) return;
    void handleDownload();
  }, [inline, handleDownload]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex flex-col bg-[rgba(11,30,58,0.55)]"
      role="dialog"
      aria-modal="true"
      aria-label={doc.title}
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 bg-gradient-to-r from-[#0b1e3a] to-[#12305c] px-4 text-white">
        <div className="min-w-0 truncate text-[15px] font-medium">
          {doc.title || doc.filename}
        </div>
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
        {inline ? (
          <iframe
            title={doc.filename}
            src={doc.viewPath}
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="m-auto max-w-md px-6 text-center">
            <p className="text-[15px] font-medium text-[var(--text-main)]">
              {doc.filename}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-sub)]">
              该格式不便在页面内预览。请点击「下载到本地」保存到设备，不会跳转外部浏览器。
            </p>
            {downloading && (
              <p className="mt-4 text-[13px] text-[var(--primary-light)]">
                正在下载…
              </p>
            )}
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
    </div>
  );
}
