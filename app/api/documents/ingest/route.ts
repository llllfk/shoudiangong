import { NextRequest, NextResponse } from "next/server";
import {
  guessFilenameFromUrl,
  isDocumentContentType,
  isDocumentUrl,
} from "@/lib/documents";
import { uploadObject } from "@/lib/storage";

const MAX_BYTES = 40 * 1024 * 1024;

/**
 * 将智能体返回的文档外链拉取后写入存储（Coze S3 或本地 storage/），
 * 返回 uri，供应用内同域预览（/api/documents/file）。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      url?: string;
      filename?: string;
    };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "请提供有效的文档链接" }, { status: 400 });
    }
    if (!isDocumentUrl(url) && !body.filename) {
      // 仍允许显式指定文件名时拉取（部分短链无扩展名）
      return NextResponse.json(
        { error: "仅支持文档类链接（如 PDF）" },
        { status: 400 },
      );
    }

    const upstream = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "pantograph-inspection-agent/1.0" },
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `下载文档失败（HTTP ${upstream.status}）` },
        { status: 502 },
      );
    }

    let contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: "文档内容为空" }, { status: 502 });
    }
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "文档过大，请控制在 40MB 以内" },
        { status: 400 },
      );
    }

    const filename =
      (typeof body.filename === "string" && body.filename.trim()) ||
      guessFilenameFromUrl(url);

    // 文件名是 .pdf 时强制正确 MIME，避免手机端当成附件下载
    if (/\.pdf$/i.test(filename) || contentType.toLowerCase().includes("pdf")) {
      contentType = "application/pdf";
    }

    // URL 无扩展名时，用 Content-Type 再校验一轮
    if (!isDocumentUrl(url) && !isDocumentContentType(contentType)) {
      return NextResponse.json(
        { error: "链接内容不是可识别的文档类型" },
        { status: 400 },
      );
    }

    const uploaded = await uploadObject(buf, {
      contentType,
      filename,
      folder: "docs",
    });

    return NextResponse.json({
      data: {
        uri: uploaded.uri,
        contentType: uploaded.contentType || contentType,
        filename,
        bytes: buf.byteLength,
        viewPath: `/api/documents/file?uri=${encodeURIComponent(uploaded.uri)}`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "文档缓存失败，请重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
