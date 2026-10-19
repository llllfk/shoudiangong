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
import type { ChatRequestBody } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 深度思考可能较久，放宽路由超时（平台支持时生效） */
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
 * 流式对话：SSE 推送 reasoning / answer，便于网关边收边刷。
 * 失败时前端可回退到 /api/chat + 轮询。
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
          // SSE：data 行 + 空行，利于代理分段转发
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        };

        let convId = "";
        let chatId = "";
        let answer = "";
        let reasoning = "";
        let finished = false;

        // 先推一段注释，减少反向代理整包缓冲
        controller.enqueue(encoder.encode(`: stream-open\n\n`));

        const persistUser = (cId: string, cChat: string) => {
          if (persistedUser || !isDatabaseConfigured()) return;
          persistedUser = true;
          void ensureConversation(cId, getUserId())
            .then(() =>
              appendMessage({
                conversationId: cId,
                role: "user",
                content: userContent,
                imageUri: encodeMultiValue(allImageUris),
                imageUrl: encodeMultiValue(allImageUrls),
                cozeFileId: encodeMultiValue(allFileIds),
                cozeChatId: cChat,
              }),
            )
            .catch((persistErr) => {
              console.error("[chat/stream] persist user failed:", persistErr);
            });
        };

        const persistAssistant = async (
          cId: string,
          cChat: string,
          finalAnswer: string,
          finalReasoning: string,
        ) => {
          if (persistedAssistant || !isDatabaseConfigured()) return;
          persistedAssistant = true;
          try {
            const exists = await hasAssistantForChat(cId, cChat);
            if (!exists) {
              await appendMessage({
                conversationId: cId,
                role: "assistant",
                content: finalAnswer,
                reasoning: finalReasoning || null,
                cozeChatId: cChat,
              });
            }
          } catch (persistErr) {
            console.error(
              "[chat/stream] persist assistant failed:",
              persistErr,
            );
          }
        };

        try {
          for await (const piece of iterateCozeChatStream(cozeRes.body!)) {
            if (request.signal.aborted) break;

            if (piece.kind === "meta") {
              convId = piece.conversationId;
              chatId = piece.chatId;
              send({
                type: "meta",
                conversationId: convId,
                chatId,
              });
              persistUser(convId, chatId);
              continue;
            }

            if (piece.kind === "reasoning_delta") {
              reasoning += piece.text;
              send({ type: "reasoning", text: reasoning });
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
                await persistAssistant(convId, chatId, answer, reasoning);
                send({
                  type: "done",
                  conversationId: convId,
                  chatId,
                  answer,
                  reasoning,
                });
              }
              finished = true;
              break;
            }
          }

          if (!finished && !request.signal.aborted) {
            if (answer.trim() && convId && chatId) {
              await persistAssistant(convId, chatId, answer, reasoning);
              send({
                type: "done",
                conversationId: convId,
                chatId,
                answer,
                reasoning,
              });
            } else {
              send({ type: "error", error: "流式对话异常结束" });
            }
          }
        } catch (err) {
          if (request.signal.aborted) {
            controller.close();
            return;
          }
          const message =
            err instanceof CozeApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "流式对话失败";
          send({ type: "error", error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
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
