import { NextRequest, NextResponse } from "next/server";
import { getObjectBytes, isStorageConfigured } from "@/lib/storage";

/**
 * 同域输出 S3 文档，Content-Disposition: inline，
 * 供页面内 iframe/embed 打开，避免跳转外部浏览器。
 */
export async function GET(request: NextRequest) {
  try {
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: "对象存储未就绪" },
        { status: 503 },
      );
    }

    const uri = request.nextUrl.searchParams.get("uri")?.trim();
    if (!uri) {
      return NextResponse.json({ error: "缺少 uri" }, { status: 400 });
    }

    const asDownload =
      request.nextUrl.searchParams.get("download") === "1" ||
      request.nextUrl.searchParams.get("download") === "true";

    const obj = await getObjectBytes(uri);
    const filename = (obj.filename || "document").replace(/[\\"\r\n]/g, "_");
    const bytes = new Uint8Array(obj.body);

    // 按扩展名纠正 MIME，避免上游 octet-stream 导致手机直接下载
    let contentType = obj.contentType || "application/octet-stream";
    if (/\.pdf$/i.test(filename) || contentType.toLowerCase().includes("pdf")) {
      contentType = "application/pdf";
    } else if (/\.txt$/i.test(filename)) {
      contentType = "text/plain; charset=utf-8";
    } else if (/\.csv$/i.test(filename)) {
      contentType = "text/csv; charset=utf-8";
    }

    // 预览用纯 inline（不带 filename），减少 WebView 把响应当成附件下载
    const disposition = asDownload
      ? `attachment; filename="${filename}"`
      : "inline";

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=300",
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "读取文档失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
