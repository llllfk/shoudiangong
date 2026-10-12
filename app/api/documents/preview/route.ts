import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { canDocxPreview } from "@/lib/documents";
import { getObjectBytes, isStorageConfigured } from "@/lib/storage";

/**
 * 服务端将 Word（docx）转为 HTML，供应用内预览。
 * 避免在浏览器端打包 mammoth 导致模块找不到。
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

    const obj = await getObjectBytes(uri);
    if (!canDocxPreview(obj.contentType, obj.filename)) {
      return NextResponse.json(
        { error: "仅支持 Word 文档预览" },
        { status: 400 },
      );
    }

    const result = await mammoth.convertToHtml({ buffer: obj.body });
    if (!result.value?.trim()) {
      return NextResponse.json(
        { error: "文档内容为空或无法解析" },
        { status: 422 },
      );
    }

    return NextResponse.json({
      data: {
        html: result.value,
        filename: obj.filename,
        messages: result.messages?.map((m) => m.message) || [],
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "文档预览失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
