import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import {
  electricalWireNo,
  normalizeElectrical,
  normalizePerformanceRow,
  resolveReportMeta,
  type InspectionReport,
} from "@/lib/report-types";

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 36;
/** 预留给页脚，避免正文挤到页脚或 pdfkit 自动再开一页 */
const FOOTER_RESERVE = 32;
const CONTENT_W = PAGE_W - MARGIN * 2;
const PRIMARY = "#0B1E3A";
const ACCENT = "#12305C";
const LINE = "#C5CDD8";
const MUTED = "#5A6A7A";
const DANGER = "#B42318";

let cachedFontPath: string | null = null;

function resolveFontPath(): string {
  if (cachedFontPath) return cachedFontPath;
  const bundled = path.join(process.cwd(), "assets", "fonts", "ReportCJK.ttf");
  if (fs.existsSync(bundled)) {
    cachedFontPath = bundled;
    return bundled;
  }
  const win = [
    "C:\\Windows\\Fonts\\simhei.ttf",
    "C:\\Windows\\Fonts\\msyh.ttf",
    "C:\\Windows\\Fonts\\simsun.ttc",
  ];
  for (const p of win) {
    if (fs.existsSync(p)) {
      cachedFontPath = p;
      return p;
    }
  }
  throw new Error("缺少中文字体：请将 ReportCJK.ttf 放到 assets/fonts/");
}

function cellText(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** 按报告 JSON 生成 A4 PDF（Buffer） */
export async function buildInspectionReportPdf(
  report: InspectionReport,
): Promise<Buffer> {
  const fontPath = resolveFontPath();

  return new Promise((resolve, reject) => {
    // 默认用中文字体，避免加载 Helvetica（pdfkit 0.20 + pnpm 会报 #standard-fonts）
    const doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      font: fontPath,
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: report.title,
        Author: "受电弓智能检修系统",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font(fontPath);

    const meta = resolveReportMeta(report);

    // 顶栏
    doc.rect(0, 0, PAGE_W, 52).fill(PRIMARY);
    doc.fillColor("#FFFFFF").fontSize(14);
    doc.text(report.title, MARGIN, 18, {
      width: CONTENT_W,
      align: "center",
    });

    let y = 64;

    // 场次 / 工位 / 当天日期（同一行）
    const metaY = y;
    const colW = CONTENT_W / 3;
    doc.fillColor(PRIMARY).fontSize(10);
    doc.text(`场次号：${meta.sessionNo}`, MARGIN, metaY, {
      width: colW,
      align: "left",
      lineBreak: false,
    });
    doc.text(`工位号：${meta.stationNo}`, MARGIN + colW, metaY, {
      width: colW,
      align: "center",
      lineBreak: false,
    });
    doc.text(`日期：${meta.dateLabel}`, MARGIN + colW * 2, metaY, {
      width: colW,
      align: "right",
      lineBreak: false,
    });
    y = metaY + 20;
    doc
      .strokeColor(LINE)
      .lineWidth(0.6)
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + CONTENT_W, y)
      .stroke();
    y += 12;

    const ensureSpace = (need: number) => {
      if (y + need > PAGE_H - MARGIN - FOOTER_RESERVE) {
        doc.addPage();
        y = MARGIN;
      }
    };

    const sectionTitle = (text: string) => {
      ensureSpace(28);
      doc.fillColor(ACCENT).fontSize(12).text(text, MARGIN, y, {
        width: CONTENT_W,
      });
      y = doc.y + 6;
      doc
        .strokeColor(PRIMARY)
        .lineWidth(1)
        .moveTo(MARGIN, y)
        .lineTo(MARGIN + CONTENT_W, y)
        .stroke();
      y += 10;
    };

    const subTitle = (text: string) => {
      ensureSpace(22);
      doc.fillColor(PRIMARY).fontSize(10.5).text(text, MARGIN, y, {
        width: CONTENT_W,
      });
      y = doc.y + 6;
    };

    const bodyText = (text: string) => {
      if (!text.trim()) return;
      ensureSpace(40);
      doc.fillColor("#1A2332").fontSize(9).text(text, MARGIN, y, {
        width: CONTENT_W,
        lineGap: 2,
      });
      y = doc.y + 8;
    };

    // —— 一、机械组 ——
    sectionTitle("一、机械组（受电弓机械外观检修）");

    subTitle("1、外观部件检修明细");
    y = drawTable(
      doc,
      y,
      fontPath,
      ["序号", "部件名称", "检查项目", "检查结果", "缺陷描述", "处理措施"],
      [24, 68, 108, 52, 135, 136],
      report.mechanical.appearance.map((row) => [
        String(row.no),
        cellText(row.part),
        cellText(row.item),
        cellText(row.result),
        cellText(row.defect) || "—",
        cellText(row.action) || "—",
      ]),
      (row) => row[3].includes("▣") || row[3].includes("问题"),
    );

    subTitle("2、性能参数检测及调整记录");
    y = drawTable(
      doc,
      y,
      fontPath,
      ["检测项目", "第1次", "第2次", "第3次", "标准范围", "判定结果"],
      [108, 72, 72, 72, 88, 111],
      report.mechanical.performance.map((row) => {
        const p = normalizePerformanceRow(row);
        return [
          cellText(p.item),
          cellText(p.m1),
          cellText(p.m2),
          cellText(p.m3),
          cellText(p.range),
          cellText(p.result) || "—",
        ];
      }),
      (row) => row[5].includes("▣") || row[5].includes("异常"),
    );

    subTitle("3、对比分析");
    if (report.mechanical.analysis.vsStandard) {
      bodyText(`（1）与标准合格工单对比：${report.mechanical.analysis.vsStandard}`);
    }
    const measureSummary =
      report.mechanical.analysis.vsMeasurements?.trim() ||
      report.mechanical.analysis.vsHistory?.trim() ||
      "";
    if (measureSummary) {
      bodyText(`（2）三次参数测量比对：${measureSummary}`);
    }

    subTitle("4、维护建议");
    const tips = report.mechanical.suggestions.filter((s) => s.trim());
    if (tips.length === 0) {
      bodyText("无");
    } else {
      tips.slice(0, 3).forEach((s, i) => {
        bodyText(`${i + 1}. ${s}`);
      });
    }

    // —— 二、电气组 ——
    // 与纸质工单一致：六列表头 + 两行数据
    const electricalRows = normalizeElectrical(report.electrical);
    if (electricalRows) {
      sectionTitle("二、电气组（故障排查工单存档）");
      const elecCol = Math.floor(CONTENT_W / 6);
      const elecWidths = [
        elecCol,
        elecCol,
        elecCol,
        elecCol,
        elecCol,
        CONTENT_W - elecCol * 5,
      ];
      y = drawTable(
        doc,
        y,
        fontPath,
        ["故障类型", "故障现象", "故障猜想", "故障原因", "故障线号", "处理结果"],
        elecWidths,
        electricalRows.map((e) => [
          cellText(e.faultType) || "—",
          cellText(e.phenomenon) || "—",
          cellText(e.hypothesis) || "—",
          cellText(e.cause) || "—",
          cellText(electricalWireNo(e)) || "—",
          cellText(e.result) || "—",
        ]),
        undefined,
        120,
      );
    }

    // 页脚：临时取消底边距，并禁止自动换行，避免 pdfkit 再开一页
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .fontSize(8)
        .fillColor(MUTED)
        .text(
          `受电弓智能检修系统  ·  第 ${i + 1} / ${pages.count} 页`,
          MARGIN,
          PAGE_H - 22,
          {
            width: CONTENT_W,
            align: "center",
            lineBreak: false,
            height: 12,
          },
        );
      doc.page.margins.bottom = prevBottom;
    }

    doc.end();
  });
}

function drawTable(
  doc: PDFKit.PDFDocument,
  startY: number,
  fontPath: string,
  headers: string[],
  widths: number[],
  rows: string[][],
  isDangerRow?: (row: string[]) => boolean,
  maxRowHeight = 72,
): number {
  const fontSize = 8;
  const pad = 4;
  let y = startY;

  const measureRowHeight = (cells: string[], bold = false) => {
    doc.font(fontPath).fontSize(fontSize);
    if (bold) {
      // pdfkit 单字体无 bold 文件时仍用同一字体
    }
    let maxH = 16;
    cells.forEach((text, i) => {
      const h = doc.heightOfString(text || " ", {
        width: widths[i] - pad * 2,
        lineGap: 1,
      });
      maxH = Math.max(maxH, h + pad * 2);
    });
    return Math.min(maxH, maxRowHeight);
  };

  const drawRow = (
    cells: string[],
    opts: { header?: boolean; danger?: boolean },
  ) => {
    const h = measureRowHeight(cells, Boolean(opts.header));
    if (y + h > PAGE_H - MARGIN - FOOTER_RESERVE) {
      doc.addPage();
      y = MARGIN;
    }

    let x = MARGIN;
    cells.forEach((text, i) => {
      const w = widths[i];
      if (opts.header) {
        doc.rect(x, y, w, h).fill(ACCENT);
      } else {
        doc.rect(x, y, w, h).fill("#FFFFFF");
        doc.rect(x, y, w, h).strokeColor(LINE).lineWidth(0.5).stroke();
      }
      doc
        .fillColor(
          opts.header ? "#FFFFFF" : opts.danger ? DANGER : "#1A2332",
        )
        .fontSize(fontSize)
        .text(text || " ", x + pad, y + pad, {
          width: w - pad * 2,
          height: h - pad * 2,
          lineGap: 1,
        });
      x += w;
    });
    y += h;
  };

  drawRow(headers, { header: true });
  for (const row of rows) {
    drawRow(row, { danger: isDangerRow?.(row) });
  }
  return y + 10;
}
