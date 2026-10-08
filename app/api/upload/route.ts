import { NextRequest, NextResponse } from "next/server";
import { CozeApiError, uploadFile } from "@/lib/coze";
import {
  getPresignedGetUrl,
  isStorageConfigured,
  uploadImageObject,
} from "@/lib/storage";

/**
 * 本地图片：
 * 1) 上传扣子文件服务 → file_id（对话多模态）
 * 2) 同步写入 Coze S3 → image_uri（永久标识入库存）
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传图片文件" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "仅支持图片文件" }, { status: 400 });
    }

    const maxBytes = 20 * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: "图片过大，请控制在 20MB 以内" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name || "part.jpg";

    const fileId = await uploadFile(
      new Blob([new Uint8Array(buffer)], {
        type: file.type || "image/jpeg",
      }),
      filename,
    );

    let imageUri: string | undefined;
    let imageUrl: string | undefined;

    if (isStorageConfigured()) {
      const uploaded = await uploadImageObject(buffer, {
        contentType: file.type || "image/jpeg",
        filename,
      });
      imageUri = uploaded.uri;
      imageUrl = await getPresignedGetUrl(uploaded.uri);
    }

    return NextResponse.json({
      data: { fileId, imageUri, imageUrl },
    });
  } catch (error) {
    if (error instanceof CozeApiError) {
      const status =
        error.status && error.status >= 400 && error.status < 600
          ? error.status
          : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    const message =
      error instanceof Error ? error.message : "上传失败，请重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
