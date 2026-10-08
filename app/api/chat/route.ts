import { NextRequest, NextResponse } from "next/server";
import { CozeApiError, getUserId, sendChat } from "@/lib/coze";
import { isDatabaseConfigured } from "@/lib/db";
import { appendMessage, ensureConversation } from "@/lib/history";
import type { ChatRequestBody } from "@/types";

/**
 * 对话入口：一轮用户输入 → 轮询至完成 → 返回 answer，并写入 PostgreSQL。
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

    const userContent = text?.trim() || (fileId || imageUrl ? "检测这个部件" : "");

    const result = await sendChat({
      text,
      imageUrl,
      fileId,
      conversationId,
    });

    if (isDatabaseConfigured()) {
      try {
        const userId = getUserId();
        await ensureConversation(result.conversationId, userId);
        await appendMessage({
          conversationId: result.conversationId,
          role: "user",
          content: userContent,
          imageUri: imageUri || null,
          imageUrl: imageUrl || null,
          cozeFileId: fileId || null,
        });
        await appendMessage({
          conversationId: result.conversationId,
          role: "assistant",
          content: result.answer,
        });
      } catch (persistErr) {
        console.error("[chat] persist failed:", persistErr);
      }
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    if (error instanceof CozeApiError) {
      const status =
        error.status && error.status >= 400 && error.status < 600
          ? error.status
          : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    const message =
      error instanceof Error ? error.message : "对话调用失败，请重试本轮";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
