import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import {
  appendChatAnswer,
  appendChatReasoning,
  initChatProgress,
  patchChatProgress,
} from "@/lib/chat-progress";
import {
  CozeApiError,
  createChatStreamResponse,
  getUserId,
  iterateCozeChatStream,
} from "@/lib/coze";
import { isDatabaseConfigured } from "@/lib/db";
import {
  appendMessage,
  encodeMultiValue,
  ensureConversation,
  hasAssistantForChat,
} from "@/lib/history";
import type { ChatRequestBody } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * 启动流式对话：等拿到 conversation/chat id 后立即返回 JSON，
 * 在 after() 中继续消费扣子 SSE，写入进度供前端短轮询。
 * （平台网关常缓冲 SSE，直接推给浏览器无法边想边显示）
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
    const imageUrls = asStringList(body.imageUrls);
    const imageUris = asStringList(body.imageUris);
    const fileIds = asStringList(body.fileIds);
    const conversationId =
      typeof body.conversationId === "string"
        ? body.conversationId.trim()
        : undefined;
    const shortcutCommandId =
      typeof body.shortcutCommandId === "string"
        ? body.shortcutCommandId.trim()
        : undefined;

    const allFileIds = [
      ...fileIds,
      ...(fileId && !fileIds.includes(fileId) ? [fileId] : []),
    ];
    const allImageUrls = [
      ...imageUrls,
      ...(imageUrl && !imageUrls.includes(imageUrl) ? [imageUrl] : []),
    ];
    const allImageUris = [
      ...imageUris,
      ...(imageUri && !imageUris.includes(imageUri) ? [imageUri] : []),
    ];

    if (
      !text?.trim() &&
      allFileIds.length === 0 &&
      allImageUrls.length === 0 &&
      !shortcutCommandId
    ) {
      return NextResponse.json(
        { error: "请提供文本、图片或快捷指令" },
        { status: 400 },
      );
    }

    const userContent =
      text?.trim() ||
      (allFileIds.length > 0 || allImageUrls.length > 0
        ? "检测这个部件"
        : shortcutCommandId
          ? "快捷指令"
          : "");

    const cozeRes = await createChatStreamResponse({
      text,
      imageUrl: allImageUrls[0],
      imageUrls: allImageUrls,
      fileId: allFileIds[0],
      fileIds: allFileIds,
      conversationId,
      shortcutCommandId,
    });

    const gen = iterateCozeChatStream(cozeRes.body!);
    let convId = "";
    let chatId = "";

    for await (const piece of gen) {
      if (piece.kind === "error") {
        throw new CozeApiError(piece.message);
      }
      if (piece.kind === "meta") {
        convId = piece.conversationId;
        chatId = piece.chatId;
        break;
      }
      if (piece.kind === "done" && piece.conversationId && piece.chatId) {
        convId = piece.conversationId;
        chatId = piece.chatId;
        break;
      }
    }

    if (!convId || !chatId) {
      throw new CozeApiError("流式对话未返回 conversation_id / chat_id");
    }

    initChatProgress(convId, chatId);

    if (isDatabaseConfigured()) {
      try {
        await ensureConversation(convId, getUserId());
        await appendMessage({
          conversationId: convId,
          role: "user",
          content: userContent,
          imageUri: encodeMultiValue(allImageUris),
          imageUrl: encodeMultiValue(allImageUrls),
          cozeFileId: encodeMultiValue(allFileIds),
          cozeChatId: chatId,
        });
      } catch (persistErr) {
        console.error("[chat/stream] persist user failed:", persistErr);
      }
    }

    // 响应返回后继续消费 SSE，把思维链写入进度
    after(async () => {
      let answer = "";
      let reasoning = "";
      try {
        for await (const piece of gen) {
          if (piece.kind === "reasoning_delta") {
            reasoning += piece.text;
            appendChatReasoning(convId, chatId, piece.text);
            continue;
          }
          if (piece.kind === "answer_delta") {
            answer += piece.text;
            appendChatAnswer(convId, chatId, piece.text);
            continue;
          }
          if (piece.kind === "error") {
            patchChatProgress(convId, chatId, {
              status: "error",
              error: piece.message,
            });
            return;
          }
          if (piece.kind === "done") {
            break;
          }
        }

        if (!answer.trim()) {
          patchChatProgress(convId, chatId, {
            status: "error",
            error: "对话已完成但未取得回复内容",
            reasoning,
            answer,
          });
          return;
        }

        patchChatProgress(convId, chatId, {
          status: "done",
          reasoning,
          answer,
        });

        if (isDatabaseConfigured()) {
          try {
            const exists = await hasAssistantForChat(convId, chatId);
            if (!exists) {
              await appendMessage({
                conversationId: convId,
                role: "assistant",
                content: answer,
                reasoning: reasoning || null,
                cozeChatId: chatId,
              });
            }
          } catch (persistErr) {
            console.error(
              "[chat/stream] persist assistant failed:",
              persistErr,
            );
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "流式对话失败";
        patchChatProgress(convId, chatId, {
          status: "error",
          error: message,
          reasoning,
          answer,
        });
      }
    });

    return NextResponse.json({
      data: { conversationId: convId, chatId },
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
      error instanceof Error ? error.message : "发起流式对话失败，请重试本轮";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
