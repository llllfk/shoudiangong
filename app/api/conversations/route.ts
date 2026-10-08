import { NextResponse } from "next/server";
import { getUserId } from "@/lib/coze";
import { isDatabaseConfigured } from "@/lib/db";
import { listConversations } from "@/lib/history";

/** 当前用户的对话记录列表（按更新时间倒序） */
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
