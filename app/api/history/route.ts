import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/coze";
import { isDatabaseConfigured } from "@/lib/db";
import {
  getLatestConversationId,
  listMessages,
} from "@/lib/history";

/**
 * 拉取最近一场（或指定 conversationId）的消息，供刷新后恢复。
 */
export async function GET(request: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({
        data: { conversationId: null, messages: [] },
      });
    }

    const { searchParams } = new URL(request.url);
    let conversationId = searchParams.get("conversationId")?.trim() || null;

    if (!conversationId) {
      conversationId = await getLatestConversationId(getUserId());
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
