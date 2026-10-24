import { after, NextRequest, NextResponse } from "next/server";
import { CozeApiError, uploadFile } from "@/lib/coze";
import {
  getPresignedGetUrl,
  isStorageConfigured,
  uploadImageObject,
} from "@/lib/storage";

/**
 * 本地图片：
 * 1) 上传扣子 → file_id（对话必需，先返回）
 * 2) 对象存储延后写入；若请求带 waitStorage=1 则并行等待（发送落库需要 uri 时用）
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const waitStorage =
      form.get("waitStorage") === "1" ||
      form.get("waitStorage") === "true";

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
    const contentType = file.type || "image/jpeg";

    const fileIdPromise = uploadFile(
      new Blob([new Uint8Array(buffer)], { type: contentType }),
      filename,
    );

    let imageUri: string | undefined;
    let imageUrl: string | undefined;

    if (isStorageConfigured() && waitStorage) {
      // 发送落库：扣子与 S3 并行，总耗时≈较慢的那个
      const [fileId, uploaded] = await Promise.all([
        fileIdPromise,
        uploadImageObject(buffer, { contentType, filename }),
      ]);
      imageUri = uploaded.uri;
      imageUrl = await getPresignedGetUrl(uploaded.uri);
      return NextResponse.json({
        data: { fileId, imageUri, imageUrl },
      });
    }

    const fileId = await fileIdPromise;

    if (isStorageConfigured()) {
      const bufCopy = Buffer.from(buffer);
      after(async () => {
        try {
          await uploadImageObject(bufCopy, { contentType, filename });
        } catch (err) {
          console.error(
            "[upload] background storage upload failed:",
            err instanceof Error ? err.message : err,
          );
        }
      });
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
