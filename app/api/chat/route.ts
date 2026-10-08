import { NextRequest, NextResponse } from "next/server";
import { CozeApiError, createChat, getUserId } from "@/lib/coze";
import { isDatabaseConfigured } from "@/lib/db";
import { appendMessage, ensureConversation } from "@/lib/history";
import type { ChatRequestBody } from "@/types";

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
    const conversationId =
      typeof body.conversationId === "string"
        ? body.conversationId.trim()
        : undefined;

    if (!text?.trim() && !imageUrl && !fileId) {
      return NextResponse.json(
        { error: "请提供文本或图片" },
        { status: 400 },
      );
    }

    const userContent =
      text?.trim() || (fileId || imageUrl ? "检测这个部件" : "");

    const started = await createChat({
      text,
      imageUrl,
      fileId,
      conversationId,
    });

    if (isDatabaseConfigured()) {
      try {
        await ensureConversation(started.conversationId, getUserId());
        await appendMessage({
          conversationId: started.conversationId,
          role: "user",
          content: userContent,
          imageUri: imageUri || null,
          imageUrl: imageUrl || null,
          cozeFileId: fileId || null,
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
