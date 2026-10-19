import { NextRequest, NextResponse } from "next/server";
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
import { sanitizeReasoning } from "@/lib/sanitize-reasoning";
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

type ClientEvent =
  | { type: "meta"; conversationId: string; chatId: string }
  | { type: "reasoning"; text: string }
  | { type: "answer"; text: string }
  | {
      type: "done";
      conversationId: string;
      chatId: string;
      answer: string;
      reasoning: string;
    }
  | { type: "error"; error: string };

/**
 * 在同一次请求中消费扣子 SSE，并把思维链/回复以 NDJSON 推给前端。
 * 不使用 after()：平台上后台任务常被掐断，会导致一直「思考中」。
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

    const cozeRes = await createChatStreamResponse(
      {
        text,
        imageUrl: allImageUrls[0],
        imageUrls: allImageUrls,
        fileId: allFileIds[0],
        fileIds: allFileIds,
        conversationId,
        shortcutCommandId,
      },
      request.signal,
    );

    const encoder = new TextEncoder();
    let persistedUser = false;
    let persistedAssistant = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: ClientEvent) => {
          try {
            controller.enqueue(
              encoder.encode(`${JSON.stringify(event)}\n`),
            );
          } catch {
            // 客户端已断开
          }
        };

        let convId = "";
        let chatId = "";
        let answer = "";
        let reasoning = "";
        let finished = false;

        try {
          for await (const piece of iterateCozeChatStream(cozeRes.body!)) {
            if (request.signal.aborted) break;

            if (piece.kind === "meta") {
              convId = piece.conversationId;
              chatId = piece.chatId;
              send({ type: "meta", conversationId: convId, chatId });

              if (!persistedUser && isDatabaseConfigured()) {
                persistedUser = true;
                void ensureConversation(convId, getUserId())
                  .then(() =>
                    appendMessage({
                      conversationId: convId,
                      role: "user",
                      content: userContent,
                      imageUri: encodeMultiValue(allImageUris),
                      imageUrl: encodeMultiValue(allImageUrls),
                      cozeFileId: encodeMultiValue(allFileIds),
                      cozeChatId: chatId,
                    }),
                  )
                  .catch((err) => {
                    console.error("[chat/stream] persist user failed:", err);
                  });
              }
              continue;
            }

            if (piece.kind === "reasoning_delta") {
              reasoning += piece.text;
              send({
                type: "reasoning",
                text: sanitizeReasoning(reasoning),
              });
              continue;
            }

            if (piece.kind === "answer_delta") {
              answer += piece.text;
              send({ type: "answer", text: answer });
              continue;
            }

            if (piece.kind === "error") {
              send({ type: "error", error: piece.message });
              finished = true;
              break;
            }

            if (piece.kind === "done") {
              convId = piece.conversationId || convId;
              chatId = piece.chatId || chatId;
              if (!answer.trim()) {
                send({
                  type: "error",
                  error: "对话已完成但未取得回复内容",
                });
              } else {
                if (
                  !persistedAssistant &&
                  isDatabaseConfigured() &&
                  convId &&
                  chatId
                ) {
                  persistedAssistant = true;
                  try {
                    const exists = await hasAssistantForChat(convId, chatId);
                    if (!exists) {
                      const safeReasoning = sanitizeReasoning(reasoning);
                      await appendMessage({
                        conversationId: convId,
                        role: "assistant",
                        content: answer,
                        reasoning: safeReasoning || null,
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
                send({
                  type: "done",
                  conversationId: convId,
                  chatId,
                  answer,
                  reasoning: sanitizeReasoning(reasoning),
                });
              }
              finished = true;
              break;
            }
          }

          if (!finished && !request.signal.aborted) {
            if (answer.trim() && convId && chatId) {
              send({
                type: "done",
                conversationId: convId,
                chatId,
                answer,
                reasoning: sanitizeReasoning(reasoning),
              });
            } else {
              send({ type: "error", error: "流式对话异常结束" });
            }
          }
        } catch (err) {
          if (!request.signal.aborted) {
            const message =
              err instanceof CozeApiError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "流式对话失败";
            send({ type: "error", error: message });
          }
        } finally {
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
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
      error instanceof Error ? error.message : "发起流式对话失败，请重试本轮";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
