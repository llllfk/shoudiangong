import { NextResponse } from "next/server";
import { CozeApiError, getPublishedBotConfig } from "@/lib/coze";

/** 拉取智能体已配置的快捷指令与开场白（不回传密钥） */
export async function GET() {
  try {
    const { shortcuts, prologue } = await getPublishedBotConfig();
    return NextResponse.json({
      data: {
        shortcuts: shortcuts.map((s) => ({
          id: s.id,
          name: s.name,
          command: s.command,
          description: s.description,
          queryTemplate: s.queryTemplate,
          iconUrl: s.iconUrl,
        })),
        prologue,
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
      error instanceof Error ? error.message : "获取智能体配置失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
