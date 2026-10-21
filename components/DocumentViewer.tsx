"use client";

import { useCallback, useState } from "react";
import {
  canInlinePreview,
  displayDocName,
} from "@/lib/documents";
import { downloadToLocal } from "@/lib/download";
import { PdfCanvasViewer } from "@/components/PdfCanvasViewer";

export type DocViewerState = {
  title: string;
  viewPath: string;
  contentType: string;
  filename: string;
};

function isPdfDoc(contentType: string, filename: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes("pdf")) return true;
  return /\.pdf$/i.test(filename);
}

export function DocumentViewer({
  doc,
  onClose,
}: {
  doc: DocViewerState;
  onClose: () => void;
}) {
  const name = displayDocName(doc.title, doc.filename);
  const pdf = isPdfDoc(doc.contentType, name);
  const textPreview =
    !pdf && canInlinePreview(doc.contentType, doc.filename);

  const [downloading, setDownloading] = useState(false);
  const [downloadHint, setDownloadHint] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
        {pdf ? (
          <PdfCanvasViewer src={doc.viewPath} title={name} />
        ) : textPreview ? (
          <iframe
            title={name}
            src={doc.viewPath}
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="m-auto max-w-md px-6 text-center">
            <p className="text-[15px] font-medium text-[var(--text-main)]">
              {name}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-sub)]">
              当前格式无法在应用内预览。建议智能体输出 PDF
              报告，即可直接在页面内查看；也可先下载到本地打开。
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
    </div>
  );
}
