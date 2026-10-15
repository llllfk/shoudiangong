import { NextRequest, NextResponse } from "next/server";
import { cancelChat, CozeApiError } from "@/lib/coze";

/** 取消进行中的对话 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      conversationId?: string;
      chatId?: string;
    };
    const conversationId =
      typeof body.conversationId === "string"
        ? body.conversationId.trim()
        : "";
    const chatId =
      typeof body.chatId === "string" ? body.chatId.trim() : "";

    if (!conversationId || !chatId) {
      return NextResponse.json(
        { error: "缺少 conversationId 或 chatId" },
        { status: 400 },
      );
    }

    await cancelChat(conversationId, chatId);
    return NextResponse.json({
      data: { conversationId, chatId, status: "canceled" },
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
      error instanceof Error ? error.message : "取消对话失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
