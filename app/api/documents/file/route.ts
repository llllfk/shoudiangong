import { NextRequest, NextResponse } from "next/server";
import { getObjectBytes } from "@/lib/storage";

/**
 * 同域输出文档（S3 或本地 storage/），Content-Disposition: inline，
 * 供页面内 iframe/embed 打开，避免跳转外部浏览器。
 */
export async function GET(request: NextRequest) {
  try {
    const uri = request.nextUrl.searchParams.get("uri")?.trim();
    if (!uri) {
      return NextResponse.json({ error: "缺少 uri" }, { status: 400 });
    }

    const asDownload =
      request.nextUrl.searchParams.get("download") === "1" ||
      request.nextUrl.searchParams.get("download") === "true";

    const obj = await getObjectBytes(uri);
    const bytes = new Uint8Array(obj.body);

    // 客户端可传可读文件名；拒绝把整段 URL 当成文件名
    const requested = request.nextUrl.searchParams.get("filename")?.trim() || "";
    const fromStorage = (obj.filename || "document").replace(/[\\"\r\n]/g, "_");
    let filename = fromStorage;
    if (
      requested &&
      !/^https?:\/\//i.test(requested) &&
      !/[\/\\?]/.test(requested) &&
      requested.length <= 120
    ) {
      filename = requested.replace(/[\\"\r\n]/g, "_");
    }

    // 按扩展名纠正 MIME，避免上游 octet-stream 导致手机直接下载 / 图片空白
    let contentType = obj.contentType || "application/octet-stream";
    if (/\.pdf$/i.test(filename) || contentType.toLowerCase().includes("pdf")) {
      contentType = "application/pdf";
      if (!/\.pdf$/i.test(filename)) filename = `${filename}.pdf`;
    } else if (/\.png$/i.test(filename)) {
      contentType = "image/png";
    } else if (/\.webp$/i.test(filename)) {
      contentType = "image/webp";
    } else if (/\.gif$/i.test(filename)) {
      contentType = "image/gif";
    } else if (/\.jpe?g$/i.test(filename) || contentType.startsWith("image/")) {
      contentType = contentType.startsWith("image/")
        ? contentType
        : "image/jpeg";
    } else if (/\.txt$/i.test(filename)) {
      contentType = "text/plain; charset=utf-8";
    } else if (/\.csv$/i.test(filename)) {
      contentType = "text/csv; charset=utf-8";
    }

    // 预览用纯 inline；下载时 filename 必须 ASCII，中文走 filename*
    const asciiName =
      filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "") || "file";
    const disposition = asDownload
      ? `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`
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
