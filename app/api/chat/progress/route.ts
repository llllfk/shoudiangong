import { NextRequest, NextResponse } from "next/server";
import { getChatProgress } from "@/lib/chat-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 短轮询流式进度：返回已累计的 thinking / answer。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get("conversationId")?.trim();
  const chatId = searchParams.get("chatId")?.trim();

  if (!conversationId || !chatId) {
    return NextResponse.json(
      { error: "缺少 conversationId 或 chatId" },
      { status: 400 },
    );
  }

  const progress = getChatProgress(conversationId, chatId);
  if (!progress) {
    return NextResponse.json({
      data: {
        conversationId,
        chatId,
        status: "running" as const,
        reasoning: "",
        answer: "",
      },
    });
  }

  return NextResponse.json({
    data: {
      conversationId: progress.conversationId,
      chatId: progress.chatId,
      status: progress.status,
      reasoning: progress.reasoning,
      answer: progress.answer,
      error: progress.error,
    },
  });
}
