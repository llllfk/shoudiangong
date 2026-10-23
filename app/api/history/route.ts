import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/coze";
import { isDatabaseConfigured } from "@/lib/db";
import {
  getLatestConversationId,
  isConversationActive,
  listMessages,
} from "@/lib/history";

/**
 * 拉取最近一场（或指定 conversationId）的消息，供刷新后恢复。
 * 已逻辑删除的会话不返回。
 */
export async function GET(request: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({
        data: { conversationId: null, messages: [] },
      });
    }

    const userId = getUserId();
    const { searchParams } = new URL(request.url);
    let conversationId = searchParams.get("conversationId")?.trim() || null;

    if (!conversationId) {
      conversationId = await getLatestConversationId(userId);
    } else if (!(await isConversationActive(conversationId, userId))) {
      return NextResponse.json({
        data: { conversationId: null, messages: [] },
      });
    }

    if (!conversationId) {
      return NextResponse.json({
        data: { conversationId: null, messages: [] },
      });
    }

    const messages = await listMessages(conversationId);
    return NextResponse.json({
      data: { conversationId, messages },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "读取历史失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
