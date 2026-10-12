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
    const disposition = asDownload ? "attachment" : "inline";

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": obj.contentType,
        "Content-Disposition": `${disposition}; filename="${filename}"`,
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
