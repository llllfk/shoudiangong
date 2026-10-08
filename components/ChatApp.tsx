"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import { createId } from "@/lib/utils";
import type {
  ApiResponse,
  ChatMessage,
  ChatStartResult,
  ChatStatusResult,
  ConversationItem,
  ConversationsResult,
  HistoryResult,
  UploadResult,
} from "@/types";

type ConfigState = "loading" | "ready" | "missing";

function mapHistoryMessages(
  messages: HistoryResult["messages"],
): ChatMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    imagePreviewUrl: m.imageUrl || undefined,
    createdAt: Date.parse(m.createdAt) || Date.now(),
  }));
}

function formatListTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

export function ChatApp() {
  const [configState, setConfigState] = useState<ConfigState>("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      const json = (await res.json()) as ApiResponse<ConversationsResult>;
      if (res.ok && "data" in json) {
        setConversations(json.data.conversations);
      }
    } catch {
      // 列表失败不阻断主流程
    }
  }, []);

  const loadConversation = useCallback(
    async (conversationId: string | null) => {
      if (!conversationId) {
        conversationIdRef.current = null;
        setActiveId(null);
        setMessages([]);
        return;
      }
      setLoadingHistory(true);
      try {
        const histRes = await fetch(
          `/api/history?conversationId=${encodeURIComponent(conversationId)}`,
        );
        const histJson =
          (await histRes.json()) as ApiResponse<HistoryResult>;
        if (!histRes.ok || !("data" in histJson)) {
          throw new Error(
            "error" in histJson ? histJson.error : "加载对话失败",
          );
        }
        conversationIdRef.current = histJson.data.conversationId;
        setActiveId(histJson.data.conversationId);
        setMessages(mapHistoryMessages(histJson.data.messages));
      } finally {
        setLoadingHistory(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config");
        const json = (await res.json()) as ApiResponse<{
          configured: boolean;
        }>;
        if (cancelled) return;
        if (!("data" in json) || !json.data.configured) {
          setConfigState("missing");
          return;
        }

        setConfigState("ready");
        await refreshConversations();
        if (cancelled) return;

        const histRes = await fetch("/api/history");
        const histJson =
          (await histRes.json()) as ApiResponse<HistoryResult>;
        if (cancelled || !histRes.ok || !("data" in histJson)) return;

        if (histJson.data.conversationId) {
          conversationIdRef.current = histJson.data.conversationId;
          setActiveId(histJson.data.conversationId);
          setMessages(mapHistoryMessages(histJson.data.messages));
        }
      } catch {
        if (!cancelled) setConfigState("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshConversations]);

  useEffect(() => {
    if (!pendingImage) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingImage);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingImage]);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, sending]);

  const showError = useCallback((msg: string) => {
    setErrorToast(msg);
    window.setTimeout(() => setErrorToast(null), 5000);
  }, []);

  const clearPendingImage = useCallback(() => {
    setPendingImage(null);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  }, []);

  const pickImageFile = useCallback((file: File | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    setPendingImage(file);
    setAttachMenuOpen(false);
  }, []);

  const openCamera = useCallback(() => {
    setAttachMenuOpen(false);
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
      cameraInputRef.current.click();
    }
  }, []);

  const openGallery = useCallback(() => {
    setAttachMenuOpen(false);
    if (galleryInputRef.current) {
      galleryInputRef.current.value = "";
      galleryInputRef.current.click();
    }
  }, []);

  const handlePasteImage = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      if (sending || loadingHistory) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          pickImageFile(item.getAsFile() || undefined);
          return;
        }
      }
      const files = e.clipboardData?.files;
      if (files?.length) {
        for (const file of Array.from(files)) {
          if (file.type.startsWith("image/")) {
            e.preventDefault();
            pickImageFile(file);
            return;
          }
        }
      }
    },
    [loadingHistory, pickImageFile, sending],
  );

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onPointerDown = (ev: MouseEvent | TouchEvent) => {
      const el = attachMenuRef.current;
      if (el && !el.contains(ev.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [attachMenuOpen]);

  const handleNewSession = useCallback(() => {
    if (sending) return;
    conversationIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setInput("");
    clearPendingImage();
    setErrorToast(null);
    setAttachMenuOpen(false);
    setSidebarOpen(false);
  }, [clearPendingImage, sending]);

  const handleSelectConversation = useCallback(
    async (conversationId: string) => {
      if (sending || conversationId === activeId) {
        setSidebarOpen(false);
        return;
      }
      try {
        await loadConversation(conversationId);
        setInput("");
        clearPendingImage();
        setSidebarOpen(false);
      } catch (err) {
        showError(err instanceof Error ? err.message : "加载对话失败");
      }
    },
    [activeId, clearPendingImage, loadConversation, sending, showError],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (sending || (!text && !pendingImage)) return;

    setSending(true);
    setErrorToast(null);

    const userMsg: ChatMessage = {
      id: createId("user"),
      role: "user",
      content: text || (pendingImage ? "检测这个部件" : ""),
      imagePreviewUrl: previewUrl || undefined,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const imageFile = pendingImage;
    clearPendingImage();

    try {
      let fileId: string | undefined;
      let imageUri: string | undefined;
      let imageUrl: string | undefined;

      if (imageFile) {
        const form = new FormData();
        form.append("file", imageFile);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: form,
        });
        const uploadJson =
          (await uploadRes.json()) as ApiResponse<UploadResult>;
        if (!uploadRes.ok || !("data" in uploadJson)) {
          throw new Error(
            "error" in uploadJson
              ? uploadJson.error
              : "图片上传失败，请重试本轮",
          );
        }
        fileId = uploadJson.data.fileId;
        imageUri = uploadJson.data.imageUri;
        imageUrl = uploadJson.data.imageUrl;
        if (imageUrl) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === userMsg.id
                ? { ...m, imagePreviewUrl: imageUrl }
                : m,
            ),
          );
        }
      }

      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text || undefined,
          fileId,
          imageUri,
          imageUrl,
          conversationId: conversationIdRef.current || undefined,
        }),
      });
      const chatJson = (await chatRes.json()) as ApiResponse<ChatStartResult>;
      if (!chatRes.ok || !("data" in chatJson)) {
        throw new Error(
          "error" in chatJson ? chatJson.error : "发起对话失败，请重试本轮",
        );
      }

      const { conversationId, chatId } = chatJson.data;
      conversationIdRef.current = conversationId;
      setActiveId(conversationId);

      // 短轮询取结果，避免一次请求挂太久被网关掐成 Failed to fetch
      const maxPolls = 180;
      let answer = "";
      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const statusRes = await fetch(
          `/api/chat/status?conversationId=${encodeURIComponent(conversationId)}&chatId=${encodeURIComponent(chatId)}`,
        );
        const statusJson =
          (await statusRes.json()) as ApiResponse<ChatStatusResult>;
        if (!statusRes.ok || !("data" in statusJson)) {
          throw new Error(
            "error" in statusJson
              ? statusJson.error
              : "查询对话状态失败，请重试本轮",
          );
        }
        const { status, answer: nextAnswer, error } = statusJson.data;
        if (status === "completed" && nextAnswer) {
          answer = nextAnswer;
          break;
        }
        if (
          status === "failed" ||
          status === "canceled" ||
          status === "required_action"
        ) {
          throw new Error(error || `对话未正常完成: ${status}`);
        }
      }
      if (!answer) {
        throw new Error("对话超时，请稍后在对话记录中查看或重试本轮");
      }

      setMessages((prev) => [
        ...prev,
        {
          id: createId("assistant"),
          role: "assistant",
          content: answer,
          createdAt: Date.now(),
        },
      ]);
      void refreshConversations();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "对话失败，请重试本轮";
      // 若仅是网络中断，尝试从历史把已生成的回复捞回来
      const convId = conversationIdRef.current;
      if (convId && /failed to fetch|network|timeout|超时/i.test(msg)) {
        try {
          await new Promise((r) => setTimeout(r, 1500));
          const histRes = await fetch(
            `/api/history?conversationId=${encodeURIComponent(convId)}`,
          );
          const histJson =
            (await histRes.json()) as ApiResponse<HistoryResult>;
          if (histRes.ok && "data" in histJson) {
            const mapped = mapHistoryMessages(histJson.data.messages);
            const last = mapped[mapped.length - 1];
            if (last?.role === "assistant") {
              setMessages(mapped);
              void refreshConversations();
              showError("网络波动，已从记录恢复本轮回复");
              return;
            }
          }
        } catch {
          // fall through
        }
      }
      showError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: createId("system"),
          role: "system",
          content: `本轮未完成：${msg}`,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [
    clearPendingImage,
    input,
    pendingImage,
    previewUrl,
    refreshConversations,
    sending,
    showError,
  ]);

  if (configState === "loading") {
    return (
      <div className="flex h-dvh flex-col">
        <AppHeader onToggleSidebar={() => undefined} showMenu={false} />
        <div className="relative flex flex-1 flex-col items-center justify-center gap-4 bg-white">
          <div
            className="spinner h-[38px] w-[38px] rounded-full border-[3px] border-[rgba(18,48,92,0.15)] border-t-[#12305c]"
            aria-hidden="true"
          />
          <span className="text-sm tracking-wide text-[var(--text-sub)]">
            正在连接检修助手
          </span>
        </div>
      </div>
    );
  }

  if (configState === "missing") {
    return (
      <div className="flex h-dvh flex-col">
        <AppHeader onToggleSidebar={() => undefined} showMenu={false} />
        <div className="flex flex-1 items-center justify-center bg-[var(--bg)] p-6">
          <div className="w-full max-w-[380px] rounded-xl border border-[var(--line)] bg-white px-[26px] py-7 text-center shadow-[0_6px_24px_rgba(11,30,58,0.08)]">
            <div
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#12305c] to-[#1c4f8f] text-[26px] text-white"
              aria-hidden="true"
            >
              ⚙
            </div>
            <p className="mb-2 text-base font-bold text-[var(--text-main)]">
              系统准备中
            </p>
            <p className="m-0 text-[13px] leading-relaxed text-[var(--text-sub)]">
              请在服务端环境变量中配置 COZE_BOT_ID 与 COZE_PAT 后刷新页面，即可开始智能检修辅助。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        showMenu
      />

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="关闭侧栏"
            className="absolute inset-0 z-20 bg-black/35 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={`absolute inset-y-0 left-0 z-30 flex w-[280px] flex-col border-r border-[var(--line)] bg-[#f7f9fc] transition-transform duration-200 md:static md:z-0 md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="border-b border-[var(--line)] p-3">
            <button
              type="button"
              onClick={handleNewSession}
              disabled={sending}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary-light)] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              <span className="text-base leading-none" aria-hidden="true">
                +
              </span>
              新建对话
            </button>
          </div>

          <div className="px-3 pb-1 pt-3">
            <p className="text-xs font-semibold tracking-wide text-[var(--text-sub)]">
              对话记录
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {conversations.length === 0 && (
              <p className="px-2 py-6 text-center text-[13px] text-[var(--text-sub)]">
                暂无历史记录
              </p>
            )}
            {conversations.map((item) => {
              const selected = item.conversationId === activeId;
              return (
                <button
                  key={item.conversationId}
                  type="button"
                  disabled={sending || loadingHistory}
                  onClick={() =>
                    void handleSelectConversation(item.conversationId)
                  }
                  className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                    selected
                      ? "bg-[rgba(18,48,92,0.1)] text-[var(--primary-dark)]"
                      : "text-[var(--text-main)] hover:bg-white"
                  }`}
                >
                  <div className="truncate text-[13px] font-medium leading-5">
                    {item.title}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--text-sub)]">
                    <span>{formatListTime(item.updatedAt)}</span>
                    <span>{item.messageCount} 条</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg)]">
          {errorToast && (
            <div
              className="absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2 rounded-lg border border-[#ffe2a8] bg-[#fff7e6] px-3.5 py-2 text-[13px] text-[#8a5a00] shadow-[0_4px_14px_rgba(138,90,0,0.12)]"
              role="status"
            >
              <span aria-hidden="true">⚠</span>
              <span>{errorToast}</span>
            </div>
          )}

          <div
            ref={listRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4"
          >
            {loadingHistory && (
              <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--text-sub)]">
                <div
                  className="spinner h-4 w-4 rounded-full border-2 border-[rgba(18,48,92,0.15)] border-t-[#12305c]"
                  aria-hidden="true"
                />
                加载对话中…
              </div>
            )}

            {!loadingHistory && messages.length === 0 && (
              <div className="mx-auto mt-10 max-w-md rounded-xl border border-[var(--line)] bg-white px-5 py-6 text-center shadow-sm">
                <p className="mb-1 text-sm font-semibold text-[var(--text-main)]">
                  开始本场检修
                </p>
                <p className="text-[13px] leading-relaxed text-[var(--text-sub)]">
                  发送文字说明或部件照片。左侧可新建对话或切换历史记录；同一场检修保持上下文。
                </p>
              </div>
            )}

            {!loadingHistory &&
              messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}

            {sending && (
              <div className="flex items-center gap-2 px-1 text-[13px] text-[var(--text-sub)]">
                <div
                  className="spinner h-4 w-4 rounded-full border-2 border-[rgba(18,48,92,0.15)] border-t-[#12305c]"
                  aria-hidden="true"
                />
                <span>检修助手分析中…</span>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--line)] bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
            {previewUrl && (
              <div className="mb-2 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="待发送部件照片"
                  className="h-14 w-14 rounded-lg border border-[var(--line)] object-cover"
                />
                <button
                  type="button"
                  onClick={clearPendingImage}
                  className="text-[13px] text-[var(--text-sub)] underline"
                  disabled={sending}
                >
                  移除图片
                </button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => pickImageFile(e.target.files?.[0])}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickImageFile(e.target.files?.[0])}
              />

              <div ref={attachMenuRef} className="relative shrink-0">
                {attachMenuOpen && (
                  <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 min-w-[148px] overflow-hidden rounded-lg border border-[var(--line)] bg-white shadow-[0_8px_24px_rgba(11,30,58,0.12)]">
                    <button
                      type="button"
                      onClick={openCamera}
                      className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg)]"
                    >
                      拍照
                    </button>
                    <button
                      type="button"
                      onClick={openGallery}
                      className="flex w-full items-center gap-2 border-t border-[var(--line)] px-3.5 py-2.5 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg)]"
                    >
                      选择照片
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  aria-label="添加部件照片"
                  aria-expanded={attachMenuOpen}
                  disabled={sending || loadingHistory}
                  onClick={() => setAttachMenuOpen((v) => !v)}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[var(--primary-light)] disabled:opacity-50"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="M4 8h3l2-2h6l2 2h3v11H4V8z" />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>
                </button>
              </div>

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={handlePasteImage}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={1}
                placeholder="输入说明，可粘贴图片或拍照上传…"
                disabled={sending || loadingHistory}
                className="max-h-28 min-h-11 flex-1 resize-none rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--primary-light)] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={
                  sending ||
                  loadingHistory ||
                  (!input.trim() && !pendingImage)
                }
                className="h-11 shrink-0 rounded-lg bg-[var(--primary-light)] px-4 text-sm font-medium text-white disabled:opacity-45"
              >
                发送
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function AppHeader({
  onToggleSidebar,
  showMenu,
}: {
  onToggleSidebar: () => void;
  showMenu: boolean;
}) {
  return (
    <header className="relative z-[1001] flex h-14 items-center justify-between bg-gradient-to-r from-[#0b1e3a] to-[#12305c] px-[18px] shadow-[0_2px_8px_rgba(11,30,58,0.25)]">
      <div className="flex min-w-0 items-center gap-3">
        {showMenu && (
          <button
            type="button"
            aria-label="打开对话列表"
            onClick={onToggleSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white md:hidden"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        )}
        <span
          className="status-dot h-[10px] w-[10px] shrink-0 rounded-full bg-[var(--accent)]"
          aria-hidden="true"
        />
        <h1 className="m-0 truncate text-[17px] font-bold tracking-wide text-white">
          受电弓智能检修系统
        </h1>
      </div>
      <span className="ml-3 shrink-0 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs tracking-wide text-white/85">
        AI 辅助外观检测
      </span>
    </header>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-[#ffe2a8] bg-[#fff7e6] px-3 py-2 text-[13px] text-[#8a5a00]">
        {message.content}
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[80%] ${
          isUser
            ? "bg-[var(--primary-light)] text-white"
            : "border border-[var(--line)] bg-white text-[var(--text-main)] shadow-sm"
        }`}
      >
        {message.imagePreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.imagePreviewUrl}
            alt="部件照片"
            className="mb-2 max-h-48 w-auto rounded-lg object-cover"
          />
        )}
        <pre className="m-0 whitespace-pre-wrap break-words font-sans">
          {message.content}
        </pre>
      </div>
    </div>
  );
}
