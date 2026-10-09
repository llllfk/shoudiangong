import { NextRequest, NextResponse } from "next/server";
import { CozeApiError, createChat, getUserId } from "@/lib/coze";
import { isDatabaseConfigured } from "@/lib/db";
import {
  appendMessage,
  encodeMultiValue,
  ensureConversation,
} from "@/lib/history";
import type { ChatRequestBody } from "@/types";

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * 发起对话（短请求）：返回 conversationId + chatId。
 * 结果由前端轮询 GET /api/chat/status，避免长连接被网关超时掐断。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const text = typeof body.text === "string" ? body.text : undefined;
    const imageUrl =
      typeof body.imageUrl === "string" ? body.imageUrl.trim() : undefined;
    const imageUri =
      typeof body.imageUri === "string" ? body.imageUri.trim() : undefined;
    const fileId =
      typeof body.fileId === "string" ? body.fileId.trim() : undefined;
    const imageUrls = asStringList(body.imageUrls);
    const imageUris = asStringList(body.imageUris);
    const fileIds = asStringList(body.fileIds);
    const conversationId =
      typeof body.conversationId === "string"
        ? body.conversationId.trim()
        : undefined;

    const allFileIds = [
      ...fileIds,
      ...(fileId && !fileIds.includes(fileId) ? [fileId] : []),
    ];
    const allImageUrls = [
      ...imageUrls,
      ...(imageUrl && !imageUrls.includes(imageUrl) ? [imageUrl] : []),
    ];
    const allImageUris = [
      ...imageUris,
      ...(imageUri && !imageUris.includes(imageUri) ? [imageUri] : []),
    ];

    if (!text?.trim() && allFileIds.length === 0 && allImageUrls.length === 0) {
      return NextResponse.json(
        { error: "请提供文本或图片" },
        { status: 400 },
      );
    }

    const userContent =
      text?.trim() ||
      (allFileIds.length > 0 || allImageUrls.length > 0
        ? "检测这个部件"
        : "");

    const started = await createChat({
      text,
      imageUrl: allImageUrls[0],
      imageUrls: allImageUrls,
      fileId: allFileIds[0],
      fileIds: allFileIds,
      conversationId,
    });

    if (isDatabaseConfigured()) {
      try {
        await ensureConversation(started.conversationId, getUserId());
        await appendMessage({
          conversationId: started.conversationId,
          role: "user",
          content: userContent,
          imageUri: encodeMultiValue(allImageUris),
          imageUrl: encodeMultiValue(allImageUrls),
          cozeFileId: encodeMultiValue(allFileIds),
          cozeChatId: started.chatId,
        });
      } catch (persistErr) {
        console.error("[chat] persist user failed:", persistErr);
      }
    }

    return NextResponse.json({
      data: {
        conversationId: started.conversationId,
        chatId: started.chatId,
      },
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
      error instanceof Error ? error.message : "发起对话失败，请重试本轮";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
