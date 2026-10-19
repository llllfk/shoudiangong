import { NextResponse } from "next/server";
import { CozeApiError, synthesizeSpeech } from "@/lib/coze";

/** 豆包音色语音合成（服务端代理，不回传密钥） */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "缺少朗读文本" }, { status: 400 });
    }

    const { audio, contentType } = await synthesizeSpeech(text);
    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
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
      error instanceof Error ? error.message : "语音合成失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
