import { NextRequest, NextResponse } from "next/server";
import { buildInspectionReportPdf } from "@/lib/report-pdf";
import {
  isInspectionReport,
  type InspectionReport,
} from "@/lib/report-types";
import { isStorageConfigured, uploadObject } from "@/lib/storage";

/**
 * 根据智能体报告 JSON 生成 PDF，写入对象存储，返回同域预览路径。
 */
export async function POST(request: NextRequest) {
  try {
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: "对象存储未就绪，无法生成报告" },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { report?: unknown };
    if (!isInspectionReport(body.report)) {
      return NextResponse.json(
        { error: "报告 JSON 格式不正确或缺少必要字段" },
        { status: 400 },
      );
    }

    const report = body.report as InspectionReport;
    const pdf = await buildInspectionReportPdf(report);
    const filename = `${report.title || "受电弓检修检验报告"}.pdf`.replace(
      /[\\/:*?"<>|]/g,
      "_",
    );

    const uploaded = await uploadObject(pdf, {
      contentType: "application/pdf",
      filename,
      folder: "reports",
    });

    return NextResponse.json({
      data: {
        uri: uploaded.uri,
        contentType: "application/pdf",
        filename,
        bytes: pdf.byteLength,
        viewPath: `/api/documents/file?uri=${encodeURIComponent(uploaded.uri)}`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "报告 PDF 生成失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
