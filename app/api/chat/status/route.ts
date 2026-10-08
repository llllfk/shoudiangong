import { NextRequest, NextResponse } from "next/server";
import {
  CozeApiError,
  listChatAnswer,
  retrieveChatStatus,
} from "@/lib/coze";
import { isDatabaseConfigured } from "@/lib/db";
import { appendMessage, hasAssistantForChat } from "@/lib/history";

/**
 * 单次查询对话状态；completed 时拉取 answer 并落库。
 * 前端每秒调用，避免一次 HTTP 挂太久。
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversationId")?.trim();
    const chatId = searchParams.get("chatId")?.trim();

    if (!conversationId || !chatId) {
      return NextResponse.json(
        { error: "缺少 conversationId 或 chatId" },
        { status: 400 },
      );
    }

    const status = await retrieveChatStatus(conversationId, chatId);

    if (status === "completed") {
      const answer = await listChatAnswer(conversationId, chatId);

      if (isDatabaseConfigured()) {
        try {
          const exists = await hasAssistantForChat(conversationId, chatId);
          if (!exists) {
            await appendMessage({
              conversationId,
              role: "assistant",
              content: answer,
              cozeChatId: chatId,
            });
          }
        } catch (persistErr) {
          console.error("[chat/status] persist assistant failed:", persistErr);
        }
      }

      return NextResponse.json({
        data: { status, conversationId, chatId, answer },
      });
    }

    if (
      status === "failed" ||
      status === "canceled" ||
      status === "required_action"
    ) {
      return NextResponse.json({
        data: {
          status,
          conversationId,
          chatId,
          error: `对话未正常完成: ${status}`,
        },
      });
    }

    return NextResponse.json({
      data: { status, conversationId, chatId },
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
      error instanceof Error ? error.message : "查询对话状态失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
