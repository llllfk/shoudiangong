import { NextRequest, NextResponse } from "next/server";
import { CozeApiError, getUserId, uploadFile } from "@/lib/coze";
import {
  addDraftImage,
  clearDraftImages,
  countDraftImages,
  deleteDraftImage,
  listDraftImages,
} from "@/lib/draft-images";
import { isDatabaseConfigured } from "@/lib/db";
import {
  getPresignedGetUrl,
  isStorageConfigured,
  uploadImageObject,
} from "@/lib/storage";

const MAX_DRAFT_IMAGES = 20;

/**
 * 多端待发照片：
 * GET  列表
 * POST 上传并加入待发队列（平板拍完即入队，电脑可拉取后发送）
 * DELETE ?id= 删一张；无 id 则清空
 */
export async function GET() {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ data: { images: [], available: false } });
    }
    const userId = getUserId();
    const images = await listDraftImages(userId);
    return NextResponse.json({ data: { images, available: true } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "读取待发照片失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { error: "未配置数据库，无法跨端共享待发照片" },
        { status: 503 },
      );
    }

    const userId = getUserId();
    const current = await countDraftImages(userId);
    if (current >= MAX_DRAFT_IMAGES) {
      return NextResponse.json(
        { error: `待发照片最多 ${MAX_DRAFT_IMAGES} 张，请先发送或清空` },
        { status: 400 },
      );
    }

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

    const image = await addDraftImage({
      userId,
      fileId,
      imageUri,
      imageUrl,
      filename,
    });

    return NextResponse.json({ data: { image } });
  } catch (error) {
    if (error instanceof CozeApiError) {
      const status =
        error.status && error.status >= 400 && error.status < 600
          ? error.status
          : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    const message =
      error instanceof Error ? error.message : "加入待发失败，请重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ data: { ok: true, cleared: 0 } });
    }
    const userId = getUserId();
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (id) {
      const ok = await deleteDraftImage(userId, id);
      if (!ok) {
        return NextResponse.json({ error: "照片不存在或已删除" }, { status: 404 });
      }
      return NextResponse.json({ data: { ok: true, cleared: 1 } });
    }
    const cleared = await clearDraftImages(userId);
    return NextResponse.json({ data: { ok: true, cleared } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "清空待发失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
