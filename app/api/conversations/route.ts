import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/coze";
import { isDatabaseConfigured } from "@/lib/db";
import { listConversations, softDeleteConversation } from "@/lib/history";

/** 当前用户的对话记录列表（按更新时间倒序，不含已逻辑删除） */
export async function GET() {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ data: { conversations: [] } });
    }
    const conversations = await listConversations(getUserId());
    return NextResponse.json({ data: { conversations } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "读取对话列表失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 逻辑删除指定对话（侧栏不再展示，数据保留） */
export async function DELETE(request: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { error: "数据库未配置，无法删除对话" },
        { status: 503 },
      );
    }

    let conversationId =
      request.nextUrl.searchParams.get("conversationId")?.trim() || "";
    if (!conversationId) {
      try {
        const body = (await request.json()) as { conversationId?: string };
        conversationId =
          typeof body.conversationId === "string"
            ? body.conversationId.trim()
            : "";
      } catch {
        // 无 body
      }
    }
    if (!conversationId) {
      return NextResponse.json({ error: "缺少 conversationId" }, { status: 400 });
    }

    const ok = await softDeleteConversation(conversationId, getUserId());
    if (!ok) {
      return NextResponse.json(
        { error: "对话不存在或已删除" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      data: { conversationId, deleted: true },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "删除对话失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
