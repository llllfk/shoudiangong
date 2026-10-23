import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { getCozeAccessToken, isCozeIdentityConfigured } from "@/lib/coze-identity";
import { buildInspectionReportPdf } from "@/lib/report-pdf";
import {
  isInspectionReport,
  type InspectionReport,
} from "@/lib/report-types";
import { isStorageConfigured, uploadObject } from "@/lib/storage";

/**
 * 根据智能体报告 JSON 生成 PDF：
 * - 排版完成后立刻返回 PDF 字节，前端 blob 预览（不再等上传）
 * - 对象存储上传放到 after() 后台，避免拖慢首屏
 * - Coze：S3；本地无 S3：storage/（本地写入很快，仍同步以便带 uri）
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { report?: unknown };
    if (!isInspectionReport(body.report)) {
      return NextResponse.json(
        { error: "报告 JSON 格式不正确或缺少必要字段" },
        { status: 400 },
      );
    }

    const report = body.report as InspectionReport;

    const t0 = Date.now();
    // 有 S3 时并行预热令牌，不阻塞排版
    const warmToken =
      isStorageConfigured() && isCozeIdentityConfigured()
        ? getCozeAccessToken().catch(() => null)
        : Promise.resolve(null);

    const [pdf] = await Promise.all([
      buildInspectionReportPdf(report),
      warmToken,
    ]);
    const pdfMs = Date.now() - t0;

    const filename = `${report.title || "受电弓检修检验报告"}.pdf`.replace(
      /[\\/:*?"<>|]/g,
      "_",
    );
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "_") || "report.pdf";

    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${asciiName}"`,
      "Cache-Control": "no-store",
      "X-Report-Filename": encodeURIComponent(filename),
      "X-Report-Bytes": String(pdf.byteLength),
      "X-Report-Timing-Pdf": String(pdfMs),
    };

    if (isStorageConfigured()) {
      // 关键路径：先把 PDF 给前端；上传放到响应后执行
      const pdfCopy = Buffer.from(pdf);
      after(async () => {
        const tUp = Date.now();
        try {
          const uploaded = await uploadObject(pdfCopy, {
            contentType: "application/pdf",
            filename,
            folder: "reports",
          });
          console.info(
            `[reports/pdf] background upload ok uri=${uploaded.uri} uploadMs=${Date.now() - tUp}`,
          );
        } catch (err) {
          console.error(
            "[reports/pdf] background upload failed:",
            err instanceof Error ? err.message : err,
          );
        }
      });
      headers["X-Report-Timing-Upload"] = "0";
      console.info(
        `[reports/pdf] bytes=${pdf.byteLength} pdfMs=${pdfMs} upload=deferred`,
      );
    } else {
      // 本地落盘很快，同步写入以便带上可下载 uri
      const t1 = Date.now();
      const uploaded = await uploadObject(pdf, {
        contentType: "application/pdf",
        filename,
        folder: "reports",
      });
      const uploadMs = Date.now() - t1;
      headers["X-Report-Uri"] = uploaded.uri;
      headers["X-Report-View-Path"] =
        `/api/documents/file?uri=${encodeURIComponent(uploaded.uri)}`;
      headers["X-Report-Timing-Upload"] = String(uploadMs);
      console.info(
        `[reports/pdf] bytes=${pdf.byteLength} pdfMs=${pdfMs} uploadMs=${uploadMs}`,
      );
    }

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "报告 PDF 生成失败";
    console.error("[reports/pdf]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
