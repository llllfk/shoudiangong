import { NextRequest, NextResponse } from "next/server";
import { canDocxPreview } from "@/lib/documents";
import { getPresignedGetUrl, isStorageConfigured } from "@/lib/storage";

/**
 * 生成 Office 在线预览嵌入地址（无需 mammoth）。
 * 用对象存储临时签名 URL 作为 src，应用内 iframe 打开。
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
    const filename =
      request.nextUrl.searchParams.get("filename")?.trim() || "";
    if (!uri) {
      return NextResponse.json({ error: "缺少 uri" }, { status: 400 });
    }

    if (
      !canDocxPreview("application/vnd.openxmlformats-officedocument", filename) &&
      !/\.docx?($|\?)/i.test(uri) &&
      !/\.docx?/i.test(filename)
    ) {
      return NextResponse.json(
        { error: "仅支持 Word 文档在线预览" },
        { status: 400 },
      );
    }

    const signedUrl = await getPresignedGetUrl(uri, 2 * 60 * 60);
    const embedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;

    return NextResponse.json({
      data: { embedUrl, filename: filename || undefined },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "生成预览地址失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
