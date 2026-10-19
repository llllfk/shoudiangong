"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DocumentViewer,
  type DocViewerState,
} from "@/components/DocumentViewer";
import { compressImageFile } from "@/lib/compress-image";
import {
  extractDocumentUrls,
  guessFilenameFromUrl,
  isDocumentUrl,
  looksLikeDocumentName,
} from "@/lib/documents";
import { downloadToLocal } from "@/lib/download";
import { canSpeak, speakText, stopSpeaking } from "@/lib/speech";
import { createId } from "@/lib/utils";
import type {
  ApiResponse,
  ChatMessage,
  ChatStartResult,
  ChatStatusResult,
  ConversationItem,
  ConversationsResult,
  HistoryResult,
  ShortcutCommand,
  ShortcutsResult,
  UploadResult,
} from "@/types";

type IngestedDoc = {
  uri: string;
  viewPath: string;
  contentType: string;
  filename: string;
};

type ConfigState = "loading" | "ready" | "missing";

const MAX_PENDING_IMAGES = 20;

/** 等待回复时依次切换，播完最后一条后停住，不循环 */
const ANALYZING_HINTS = [
  "正在识别部件外观特征…",
  "对照检修标准比对中…",
  "梳理检查项与判定结果…",
  "整理检修建议与台账要点…",
  "即将返回检测结论…",
];

function createOpeningMessage(prologue: string): ChatMessage | null {
  const content = prologue.trim();
  if (!content) return null;
  return {
    id: createId("opening"),
    role: "assistant",
    content,
    createdAt: Date.now(),
  };
}

function mapHistoryMessages(
  messages: HistoryResult["messages"],
): ChatMessage[] {
  return messages.map((m) => {
    const urls =
      m.imageUrls && m.imageUrls.length > 0
        ? m.imageUrls
        : m.imageUrl
          ? [m.imageUrl]
          : [];
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      imagePreviewUrl: urls[0],
      imagePreviewUrls: urls.length > 0 ? urls : undefined,
      createdAt: Date.parse(m.createdAt) || Date.now(),
    };
  });
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
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendHint, setSendHint] = useState("检修助手处理中…");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [docCache, setDocCache] = useState<Record<string, IngestedDoc>>({});
  const [docViewer, setDocViewer] = useState<DocViewerState | null>(null);
  const [docBusyUrl, setDocBusyUrl] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutCommand[]>([]);
  const [prologue, setPrologue] = useState("");
  const conversationIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const hintTimerRef = useRef<number | null>(null);
  const ingestingRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const activeChatRef = useRef<{
    conversationId: string;
    chatId: string;
  } | null>(null);

  const stopHintSequence = useCallback(() => {
    if (hintTimerRef.current != null) {
      window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
  }, []);

  /** 按顺序切换文案，每条只出现一次，播完停在最后一条 */
  const startHintSequence = useCallback(() => {
    stopHintSequence();
    let index = 0;
    setSendHint(ANALYZING_HINTS[0]);

    const tick = () => {
      index += 1;
      if (index >= ANALYZING_HINTS.length) {
        hintTimerRef.current = null;
        return;
      }
      setSendHint(ANALYZING_HINTS[index]);
      if (index < ANALYZING_HINTS.length - 1) {
        hintTimerRef.current = window.setTimeout(tick, 2800);
      } else {
        hintTimerRef.current = null;
      }
    };

    hintTimerRef.current = window.setTimeout(tick, 2800);
  }, [stopHintSequence]);

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
      stopSpeechPlayback();
      if (!conversationId) {
        conversationIdRef.current = null;
        setActiveId(null);
        const opening = createOpeningMessage(prologue);
        setMessages(opening ? [opening] : []);
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
    [prologue],
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

        let openingText = "";
        try {
          const scRes = await fetch("/api/shortcuts");
          const scJson =
            (await scRes.json()) as ApiResponse<ShortcutsResult>;
          if (!cancelled && scRes.ok && "data" in scJson) {
            setShortcuts(scJson.data.shortcuts || []);
            openingText = (scJson.data.prologue || "").trim();
            setPrologue(openingText);
          }
        } catch {
          // 快捷指令/开场白失败不阻断主流程
        }
        if (cancelled) return;

        const histRes = await fetch("/api/history");
        const histJson =
          (await histRes.json()) as ApiResponse<HistoryResult>;
        if (cancelled || !histRes.ok || !("data" in histJson)) return;

        if (histJson.data.conversationId) {
          conversationIdRef.current = histJson.data.conversationId;
          setActiveId(histJson.data.conversationId);
          setMessages(mapHistoryMessages(histJson.data.messages));
        } else {
          const opening = createOpeningMessage(openingText);
          setMessages(opening ? [opening] : []);
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
    const urls = pendingImages.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [pendingImages]);

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

  const ingestDocument = useCallback(
    async (url: string, preferredName?: string) => {
      const cached = docCache[url];
      if (cached) return cached;
      if (ingestingRef.current.has(url)) return null;
      ingestingRef.current.add(url);
      try {
        const filename =
          (preferredName && looksLikeDocumentName(preferredName)
            ? preferredName.trim()
            : "") || guessFilenameFromUrl(url);
        const res = await fetch("/api/documents/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, filename }),
        });
        const json = (await res.json()) as ApiResponse<IngestedDoc>;
        if (!res.ok || !("data" in json)) {
          throw new Error(
            "error" in json ? json.error : "文档缓存到存储失败",
          );
        }
        const doc = json.data;
        setDocCache((prev) => ({ ...prev, [url]: doc }));
        return doc;
      } finally {
        ingestingRef.current.delete(url);
      }
    },
    [docCache],
  );

  const openDocument = useCallback(
    async (url: string, title?: string) => {
      setDocBusyUrl(url);
      try {
        const doc =
          docCache[url] || (await ingestDocument(url, title));
        if (!doc) {
          throw new Error("文档处理中，请稍后再试");
        }
        const niceName =
          (title && looksLikeDocumentName(title) ? title.trim() : "") ||
          doc.filename;
        setDocViewer({
          title: niceName,
          viewPath: doc.viewPath,
          contentType: doc.contentType,
          filename: niceName,
        });
      } catch (err) {
        showError(err instanceof Error ? err.message : "无法打开文档");
      } finally {
        setDocBusyUrl(null);
      }
    },
    [docCache, ingestDocument, showError],
  );

  const downloadDocument = useCallback(
    async (url: string, title?: string) => {
      setDocBusyUrl(url);
      try {
        const doc =
          docCache[url] || (await ingestDocument(url, title));
        if (!doc) {
          throw new Error("文档处理中，请稍后再试");
        }
        await downloadToLocal(doc.viewPath, doc.filename);
      } catch (err) {
        showError(err instanceof Error ? err.message : "下载失败");
      } finally {
        setDocBusyUrl(null);
      }
    },
    [docCache, ingestDocument, showError],
  );

  // 智能体回复里的文档链接：后台自动拉到 S3，点击时应用内打开
  useEffect(() => {
    const urls = new Set<string>();
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const u of extractDocumentUrls(m.content)) urls.add(u);
    }
    for (const url of urls) {
      if (docCache[url] || ingestingRef.current.has(url)) continue;
      void ingestDocument(url).catch(() => {
        // 预缓存失败不打扰用户，点击时再提示
      });
    }
  }, [messages, docCache, ingestDocument]);

  const clearPendingImages = useCallback(() => {
    setPendingImages([]);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  }, []);

  const pickImageFiles = useCallback(
    (files: FileList | File[] | null | undefined) => {
      if (!files || sending || loadingHistory) return;
      const list = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (list.length === 0) return;
      // 仅加入输入区待发送，不自动发消息
      setPendingImages((prev) => {
        const merged = [...prev, ...list];
        if (merged.length > MAX_PENDING_IMAGES) {
          showError(`一次最多上传 ${MAX_PENDING_IMAGES} 张照片`);
          return merged.slice(0, MAX_PENDING_IMAGES);
        }
        return merged;
      });
      setAttachMenuOpen(false);
      window.setTimeout(() => textInputRef.current?.focus(), 0);
    },
    [loadingHistory, sending, showError],
  );

  /** 快捷指令写入输入框，不自动发送 */
  const applyShortcut = useCallback(
    (sc: ShortcutCommand) => {
      if (sending || loadingHistory) return;
      const text = (sc.queryTemplate || sc.command || sc.name).trim();
      if (!text) return;
      setInput(text);
      window.setTimeout(() => {
        const el = textInputRef.current;
        if (!el) return;
        el.focus();
        const len = text.length;
        el.setSelectionRange(len, len);
      }, 0);
    },
    [loadingHistory, sending],
  );

  const removePendingAt = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
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
      const fromItems: File[] = [];
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) fromItems.push(file);
          }
        }
      }
      const fromFiles = e.clipboardData?.files
        ? Array.from(e.clipboardData.files).filter((f) =>
            f.type.startsWith("image/"),
          )
        : [];
      const images = fromItems.length > 0 ? fromItems : fromFiles;
      if (images.length === 0) return;
      e.preventDefault();
      pickImageFiles(images);
    },
    [loadingHistory, pickImageFiles, sending],
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
    stopSpeechPlayback();
    conversationIdRef.current = null;
    setActiveId(null);
    const opening = createOpeningMessage(prologue);
    setMessages(opening ? [opening] : []);
    setInput("");
    clearPendingImages();
    setErrorToast(null);
    setAttachMenuOpen(false);
    setSidebarOpen(false);
  }, [clearPendingImages, prologue, sending]);

  const handleSelectConversation = useCallback(
    async (conversationId: string) => {
      if (sending || conversationId === activeId) {
        setSidebarOpen(false);
        return;
      }
      try {
        await loadConversation(conversationId);
        setInput("");
        clearPendingImages();
        setSidebarOpen(false);
      } catch (err) {
        showError(err instanceof Error ? err.message : "加载对话失败");
      }
    },
    [activeId, clearPendingImages, loadConversation, sending, showError],
  );

  const handleStop = useCallback(async () => {
    abortRef.current?.abort();
    const active = activeChatRef.current;
    if (active) {
      try {
        await fetch("/api/chat/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: active.conversationId,
            chatId: active.chatId,
          }),
        });
      } catch {
        // 本地中止优先；取消接口失败不阻断
      }
    }
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (sending || (!text && pendingImages.length === 0)) {
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    activeChatRef.current = null;

    setSending(true);
    setErrorToast(null);
    setSendHint(
      pendingImages.length > 0
        ? "正在压缩并上传照片…"
        : "正在提交检测请求…",
    );

    const imageFiles = [...pendingImages];
    // 独立创建气泡预览 URL，避免清空待发送区时 revoke 导致图片空白
    const localPreviews = imageFiles.map((f) => URL.createObjectURL(f));
    const defaultText =
      imageFiles.length > 1 ? "检测这些部件" : "检测这个部件";
    const displayText =
      text || (imageFiles.length > 0 ? defaultText : "");
    const userMsg: ChatMessage = {
      id: createId("user"),
      role: "user",
      content: displayText,
      imagePreviewUrl: localPreviews[0],
      imagePreviewUrls:
        localPreviews.length > 0 ? localPreviews : undefined,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    clearPendingImages();

    const throwIfAborted = () => {
      if (ac.signal.aborted) {
        throw new DOMException("已结束本轮", "AbortError");
      }
    };

    try {
      const fileIds: string[] = [];
      const imageUris: string[] = [];
      const imageUrls: string[] = [];

      for (let i = 0; i < imageFiles.length; i++) {
        throwIfAborted();
        const imageFile = imageFiles[i];
        setSendHint(
          imageFiles.length > 1
            ? `正在上传照片 ${i + 1}/${imageFiles.length}…`
            : "正在上传照片…",
        );
        const compressed = await compressImageFile(imageFile);
        throwIfAborted();
        const form = new FormData();
        form.append("file", compressed);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: form,
          signal: ac.signal,
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
        fileIds.push(uploadJson.data.fileId);
        if (uploadJson.data.imageUri) {
          imageUris.push(uploadJson.data.imageUri);
        }
        if (uploadJson.data.imageUrl) {
          imageUrls.push(uploadJson.data.imageUrl);
        }
      }

      if (imageUrls.length > 0) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMsg.id
              ? {
                  ...m,
                  imagePreviewUrl: imageUrls[0],
                  imagePreviewUrls: imageUrls,
                }
              : m,
          ),
        );
        for (const url of localPreviews) URL.revokeObjectURL(url);
      }

      throwIfAborted();
      setSendHint("正在提交检测请求…");
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text || undefined,
          fileIds: fileIds.length > 0 ? fileIds : undefined,
          imageUris: imageUris.length > 0 ? imageUris : undefined,
          imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
          conversationId: conversationIdRef.current || undefined,
        }),
        signal: ac.signal,
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
      activeChatRef.current = { conversationId, chatId };

      startHintSequence();

      // 短轮询取结果，避免一次请求挂太久被网关掐成 Failed to fetch
      const maxPolls = 180;
      let answer = "";
      for (let i = 0; i < maxPolls; i++) {
        throwIfAborted();
        await new Promise<void>((resolve, reject) => {
          const t = window.setTimeout(() => {
            ac.signal.removeEventListener("abort", onAbort);
            resolve();
          }, 1000);
          const onAbort = () => {
            window.clearTimeout(t);
            reject(new DOMException("已结束本轮", "AbortError"));
          };
          ac.signal.addEventListener("abort", onAbort, { once: true });
        });
        throwIfAborted();
        const statusRes = await fetch(
          `/api/chat/status?conversationId=${encodeURIComponent(conversationId)}&chatId=${encodeURIComponent(chatId)}`,
          { signal: ac.signal },
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
        if (status === "canceled") {
          throw new DOMException("已结束本轮", "AbortError");
        }
        if (
          status === "failed" ||
          status === "required_action"
        ) {
          throw new Error(error || `对话未正常完成: ${status}`);
        }
      }
      if (!answer) {
        throwIfAborted();
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
      const aborted =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error &&
          (/abort|已结束本轮/i.test(err.message) || err.name === "AbortError"));
      if (aborted) {
        setMessages((prev) => [
          ...prev,
          {
            id: createId("system"),
            role: "system",
            content: "已结束本轮",
            createdAt: Date.now(),
          },
        ]);
        return;
      }

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
      stopHintSequence();
      abortRef.current = null;
      activeChatRef.current = null;
      setSending(false);
    }
  }, [
    clearPendingImages,
    input,
    pendingImages,
    refreshConversations,
    sending,
    showError,
    startHintSequence,
    stopHintSequence,
  ]);

  useEffect(() => () => stopHintSequence(), [stopHintSequence]);

  useEffect(() => () => stopSpeechPlayback(), []);

  if (configState === "loading") {
    return (
      <div className="app-root">
        <AppHeader onToggleSidebar={() => undefined} showMenu={false} />
        <div
          className="chat-main"
          style={{ alignItems: "center", justifyContent: "center", gap: 16 }}
        >
          <div className="spinner lg" aria-hidden="true" />
          <span style={{ color: "var(--text-sub)", fontSize: 14 }}>
            正在连接检修助手
          </span>
        </div>
      </div>
    );
  }

  if (configState === "missing") {
    return (
      <div className="app-root">
        <AppHeader onToggleSidebar={() => undefined} showMenu={false} />
        <div
          className="chat-main"
          style={{ alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div className="center-card">
            <div className="center-icon" aria-hidden="true">
              ⚙
            </div>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 16,
                fontWeight: 700,
                color: "var(--text-main)",
              }}
            >
              系统准备中
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--text-sub)",
              }}
            >
              请在服务端环境变量中配置 BOT_ID 与 BOT_PAT 后刷新页面，即可开始智能检修辅助。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-root">
      <AppHeader
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        sidebarOpen={sidebarOpen}
        showMenu
      />

      <div className="app-body">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="关闭侧栏"
            className="side-mask"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside className={`side-panel${sidebarOpen ? " is-open" : ""}`}>
          <div className="side-head">
            <button
              type="button"
              onClick={handleNewSession}
              disabled={sending}
              className="btn-primary btn-block"
            >
              <span aria-hidden="true">+</span>
              新建对话
            </button>
            <button
              type="button"
              aria-label="收起对话记录"
              title="收起"
              onClick={() => setSidebarOpen(false)}
              className="side-collapse"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
          </div>

          <p className="side-label">对话记录</p>

          <div className="side-list">
            {conversations.length === 0 && (
              <p className="side-empty">暂无历史记录</p>
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
                  className={`side-item${selected ? " is-active" : ""}`}
                >
                  <div className="side-item-title">{item.title}</div>
                  <div className="side-item-meta">
                    <span>{formatListTime(item.updatedAt)}</span>
                    <span>{item.messageCount} 条</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="chat-main">
          {errorToast && (
            <div className="toast-warn" role="status">
              <span aria-hidden="true">⚠</span>
              <span>{errorToast}</span>
            </div>
          )}

          <div ref={listRef} className="msg-list">
            {loadingHistory && (
              <div className="loading-row">
                <div className="spinner" aria-hidden="true" />
                加载对话中…
              </div>
            )}

            {!loadingHistory &&
              messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onOpenDocument={openDocument}
                  onDownloadDocument={downloadDocument}
                  busyDocUrl={docBusyUrl}
                  onSpeechError={(msg) =>
                    showError(
                      msg ||
                        "豆包朗读失败。请确认 BOT_PAT 已开通 createSpeech",
                    )
                  }
                />
              ))}

            {sending && (
              <div className="send-hint" aria-live="polite">
                {sendHint}
              </div>
            )}
          </div>

          <div className="composer">
            {shortcuts.length > 0 && (
              <div className="chip-row">
                {shortcuts.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    title={sc.description || sc.queryTemplate || sc.name}
                    disabled={sending || loadingHistory}
                    onClick={() => applyShortcut(sc)}
                    className="chip"
                  >
                    {sc.name}
                  </button>
                ))}
              </div>
            )}

            <div className="composer-row">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="file-hidden"
                onChange={(e) => {
                  pickImageFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                className="file-hidden"
                onChange={(e) => {
                  pickImageFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              <div ref={attachMenuRef} className="attach-wrap">
                {attachMenuOpen && (
                  <div className="attach-menu">
                    <button type="button" onClick={openCamera}>
                      拍照
                    </button>
                    <button type="button" onClick={openGallery}>
                      选择照片（可多选）
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  aria-label="添加部件照片到输入框"
                  aria-expanded={attachMenuOpen}
                  disabled={
                    sending ||
                    loadingHistory ||
                    pendingImages.length >= MAX_PENDING_IMAGES
                  }
                  onClick={() => setAttachMenuOpen((v) => !v)}
                  className="btn-ghost"
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

              <div className="composer-box">
                {previewUrls.length > 0 && (
                  <div className="pending-row">
                    {previewUrls.map((url, index) => (
                      <div key={`${url}-${index}`} className="pending-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`待发送部件照片 ${index + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() => removePendingAt(index)}
                          disabled={sending}
                          aria-label={`移除第 ${index + 1} 张图片`}
                          className="pending-remove"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <span className="pending-meta">
                      {previewUrls.length}/{MAX_PENDING_IMAGES}
                    </span>
                    <button
                      type="button"
                      onClick={clearPendingImages}
                      className="pending-clear"
                      disabled={sending}
                    >
                      清空
                    </button>
                  </div>
                )}
                <textarea
                  ref={textInputRef}
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
                  placeholder={
                    previewUrls.length > 0
                      ? "可补充文字说明，再点发送…"
                      : shortcuts.length > 0
                        ? "输入说明，或点上方快捷指令填入后发送…"
                        : "输入说明，可多选/粘贴图片或拍照上传…"
                  }
                  disabled={sending || loadingHistory}
                />
              </div>

              {sending ? (
                <button
                  type="button"
                  onClick={() => void handleStop()}
                  className="btn-primary btn-stop"
                >
                  结束
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={
                    loadingHistory ||
                    (!input.trim() && pendingImages.length === 0)
                  }
                  className="btn-primary"
                >
                  发送
                </button>
              )}
            </div>
          </div>
        </main>
      </div>

      {docViewer && (
        <DocumentViewer doc={docViewer} onClose={() => setDocViewer(null)} />
      )}
    </div>
  );
}

function AppHeader({
  onToggleSidebar,
  sidebarOpen = false,
  showMenu,
}: {
  onToggleSidebar: () => void;
  sidebarOpen?: boolean;
  showMenu: boolean;
}) {
  return (
    <header className="app-header">
      <div className="app-header-main">
        {showMenu && (
          <button
            type="button"
            aria-label={sidebarOpen ? "收起对话记录" : "打开对话记录"}
            aria-expanded={sidebarOpen}
            title={sidebarOpen ? "收起对话记录" : "打开对话记录"}
            onClick={onToggleSidebar}
            className="icon-btn"
          >
            {sidebarOpen ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
            ) : (
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
            )}
          </button>
        )}
        <span className="status-dot" aria-hidden="true" />
        <h1 className="app-title">受电弓智能检修系统</h1>
      </div>
      <span
        className="app-badge"
        title="AI 大模型外观检测与参数智能比对系统"
      >
        AI 大模型外观检测与参数智能比对系统
      </span>
    </header>
  );
}

/** 去掉智能体 Markdown 中的图片语法，避免界面展示参考图 */
function stripAssistantImages(content: string): string {
  return content
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*]\[[^\]]*]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 朗读用纯文本：去掉 Markdown 标记与图片 */
function plainTextForSpeech(content: string): string {
  return stripAssistantImages(content)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~>#|]+/g, " ")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

type SpeechListener = (id: string | null) => void;
let speakingMessageId: string | null = null;
const speechListeners = new Set<SpeechListener>();

function notifySpeechListeners() {
  for (const listener of speechListeners) {
    listener(speakingMessageId);
  }
}

function stopSpeechPlayback() {
  void stopSpeaking();
  if (speakingMessageId != null) {
    speakingMessageId = null;
    notifySpeechListeners();
  }
}

function useSpeechPlayback(
  messageId: string,
  text: string,
  onSpeechError?: (message: string) => void,
) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const listener: SpeechListener = (id) => setActiveId(id);
    speechListeners.add(listener);
    setActiveId(speakingMessageId);
    return () => {
      speechListeners.delete(listener);
    };
  }, []);

  const speaking = activeId === messageId;
  const toggle = useCallback(() => {
    if (speakingMessageId === messageId) {
      stopSpeechPlayback();
      return;
    }
    if (!canSpeak()) {
      onSpeechError?.("当前环境无法播放音频");
      return;
    }
    const content = text.trim();
    if (!content) return;

    speakingMessageId = messageId;
    notifySpeechListeners();

    void speakText(content)
      .catch((err) => {
        const msg =
          err instanceof Error ? err.message : "豆包朗读失败";
        onSpeechError?.(msg);
      })
      .finally(() => {
        if (speakingMessageId === messageId) {
          speakingMessageId = null;
          notifySpeechListeners();
        }
      });
  }, [messageId, onSpeechError, text]);

  return { speaking, toggle };
}

function MessageBubble({
  message,
  onOpenDocument,
  onDownloadDocument,
  busyDocUrl,
  onSpeechError,
}: {
  message: ChatMessage;
  onOpenDocument?: (url: string, title?: string) => void;
  onDownloadDocument?: (url: string, title?: string) => void;
  busyDocUrl?: string | null;
  onSpeechError?: (message: string) => void;
}) {
  if (message.role === "system") {
    return <div className="msg-system">{message.content}</div>;
  }

  return (
    <MessageBubbleBody
      message={message}
      onOpenDocument={onOpenDocument}
      onDownloadDocument={onDownloadDocument}
      busyDocUrl={busyDocUrl}
      onSpeechError={onSpeechError}
    />
  );
}

function MessageBubbleBody({
  message,
  onOpenDocument,
  onDownloadDocument,
  busyDocUrl,
  onSpeechError,
}: {
  message: ChatMessage;
  onOpenDocument?: (url: string, title?: string) => void;
  onDownloadDocument?: (url: string, title?: string) => void;
  busyDocUrl?: string | null;
  onSpeechError?: (message: string) => void;
}) {
  const isUser = message.role === "user";
  const speechText = isUser ? "" : plainTextForSpeech(message.content);
  const { speaking, toggle } = useSpeechPlayback(
    message.id,
    speechText,
    onSpeechError,
  );
  const previewImages =
    message.imagePreviewUrls && message.imagePreviewUrls.length > 0
      ? message.imagePreviewUrls
      : message.imagePreviewUrl
        ? [message.imagePreviewUrl]
        : [];
  // 有助手正文就显示朗读按钮；不支持语音的环境点击后再提示
  const showSpeak = !isUser && speechText.length > 0;

  return (
    <div className={`msg-row ${isUser ? "is-user" : "is-assistant"}`}>
      <div className={`msg-bubble${isUser ? " is-user" : ""}`}>
        {previewImages.length > 0 && (
          <div className="msg-images">
            {previewImages.map((url, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${url}-${index}`}
                src={url}
                alt={`部件照片 ${index + 1}`}
              />
            ))}
          </div>
        )}
        {isUser ? (
          <div className="msg-user-text">{message.content}</div>
        ) : (
          <div className="chat-md">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => {
                  const url = typeof href === "string" ? href : "";
                  const label =
                    typeof children === "string"
                      ? children
                      : Array.isArray(children)
                        ? children.map(String).join("")
                        : "文档";
                  const isDoc = Boolean(
                    url &&
                      (isDocumentUrl(url) || looksLikeDocumentName(label)),
                  );
                  const busy = Boolean(url && busyDocUrl === url);

                  if (isDoc && (onOpenDocument || onDownloadDocument)) {
                    return (
                      <span
                        style={{
                          display: "inline-flex",
                          flexWrap: "wrap",
                          gap: "4px 8px",
                          alignItems: "baseline",
                        }}
                      >
                        {onOpenDocument && (
                          <button
                            type="button"
                            onClick={() => void onOpenDocument(url, label)}
                            disabled={busy}
                            className="doc-link"
                          >
                            {busy ? `处理中「${label}」…` : children}
                          </button>
                        )}
                        {onDownloadDocument && (
                          <button
                            type="button"
                            onClick={() => void onDownloadDocument(url, label)}
                            disabled={busy}
                            className="doc-download"
                          >
                            下载到本地
                          </button>
                        )}
                      </span>
                    );
                  }

                  return <a href={url || undefined}>{children}</a>;
                },
                img: () => null,
              }}
            >
              {stripAssistantImages(message.content)}
            </ReactMarkdown>
          </div>
        )}
        {showSpeak && (
          <div className="speak-bar">
            <button
              type="button"
              onClick={toggle}
              aria-pressed={speaking}
              className={`speak-btn${speaking ? " is-on" : ""}`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                {speaking ? (
                  <path d="M6 6h4v12H6zM14 6h4v12h-4z" />
                ) : (
                  <>
                    <path d="M11 5L6 9H3v6h3l5 4V5z" />
                    <path d="M15.5 8.5a4 4 0 010 7M18 6a7 7 0 010 12" />
                  </>
                )}
              </svg>
              {speaking ? "结束朗读" : "朗读"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
