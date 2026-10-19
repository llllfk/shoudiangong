/**
 * 朗读仅使用服务端豆包音色（/api/tts）+ Audio 播放。
 * 按段合成：播完一段再请求下一段，点结束即中止，不预合成全文。
 */

/** 单段上限（扣子 speech input ≤1024 字节）；偏短以便早停时少浪费 */
const MAX_TTS_BYTES = 480;
/** 首段更短，合成返回更快，朗读能尽快开始 */
const FIRST_TTS_BYTES = 160;

let currentAudio: HTMLAudioElement | null = null;
let playToken = 0;
let fetchAbort: AbortController | null = null;

export class SpeechAbortedError extends Error {
  constructor() {
    super("ABORTED");
    this.name = "SpeechAbortedError";
  }
}

export function isSpeechAborted(err: unknown): boolean {
  return (
    err instanceof SpeechAbortedError ||
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error &&
      (err.name === "AbortError" || err.message === "ABORTED"))
  );
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 按 UTF-8 字节切分，避免超过接口限制；首段更短以便尽快出声 */
export function chunkTextForTts(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = FIRST_TTS_BYTES;

  const flush = () => {
    const part = current.trim();
    if (part) chunks.push(part);
    current = "";
    bytes = 0;
    limit = MAX_TTS_BYTES;
  };

  for (const ch of normalized) {
    const size = utf8Bytes(ch);
    if (bytes + size > limit && current) flush();
    current += ch;
    bytes += size;
    const sentenceEnd = /[。！？；\n.!?;]/.test(ch);
    if (sentenceEnd && bytes >= Math.min(80, limit)) flush();
  }
  flush();
  return chunks;
}

export function canSpeak(): boolean {
  return typeof window !== "undefined";
}

function detachAudio(audio: HTMLAudioElement) {
  audio.onended = null;
  audio.onerror = null;
  audio.onpause = null;
  try {
    audio.pause();
  } catch {
    // ignore
  }
  const src = audio.src;
  try {
    audio.removeAttribute("src");
  } catch {
    // ignore
  }
  if (src.startsWith("blob:")) URL.revokeObjectURL(src);
}

export async function stopSpeaking(): Promise<void> {
  playToken += 1;
  if (fetchAbort) {
    fetchAbort.abort();
    fetchAbort = null;
  }
  if (currentAudio) {
    const audio = currentAudio;
    currentAudio = null;
    detachAudio(audio);
  }
}

async function fetchDoubaoChunk(
  text: string,
  signal: AbortSignal,
): Promise<Blob> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) {
    let message = "豆包语音合成失败";
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.blob();
}

function playBlob(
  blob: Blob,
  token: number,
  onNearEnd?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token !== playToken) {
      resolve();
      return;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    let nearEndFired = false;

    const finishOk = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };

    audio.ontimeupdate = () => {
      if (nearEndFired || token !== playToken || !onNearEnd) return;
      const { duration, currentTime } = audio;
      if (!Number.isFinite(duration) || duration <= 0) return;
      // 剩余约 1.2s 再预取下一段，早停时通常还没发起后续合成
      if (duration - currentTime <= 1.2) {
        nearEndFired = true;
        onNearEnd();
      }
    };

    audio.onended = finishOk;
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      // 点「结束」会中断播放，浏览器也会派发 error，不当成失败
      resolve();
    };

    void audio.play().then(
      () => undefined,
      (err: unknown) => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
        if (token !== playToken || isSpeechAborted(err)) {
          resolve();
          return;
        }
        reject(err instanceof Error ? err : new Error("音频播放失败"));
      },
    );
  });
}

export type SpeakPhase = "preparing" | "playing";

export async function speakText(
  text: string,
  onPhase?: (phase: SpeakPhase) => void,
): Promise<void> {
  const content = text.trim();
  if (!content) return;

  await stopSpeaking();

  const chunks = chunkTextForTts(content);
  if (chunks.length === 0) return;

  const token = playToken;
  const ac = new AbortController();
  fetchAbort = ac;

  try {
    let pending: Promise<Blob> | null = null;

    for (let i = 0; i < chunks.length; i++) {
      if (token !== playToken) throw new SpeechAbortedError();
      onPhase?.(i === 0 ? "preparing" : "playing");

      const blob = await (pending ?? fetchDoubaoChunk(chunks[i], ac.signal));
      pending = null;
      if (token !== playToken) throw new SpeechAbortedError();

      onPhase?.("playing");
      const hasNext = i + 1 < chunks.length;
      await playBlob(blob, token, hasNext
        ? () => {
            if (token !== playToken || pending) return;
            const next = fetchDoubaoChunk(chunks[i + 1], ac.signal);
            // 早停时可能不再 await，避免未处理的 Abort 拒绝
            void next.catch(() => undefined);
            pending = next;
          }
        : undefined);
    }
  } catch (err) {
    if (isSpeechAborted(err) || token !== playToken) {
      throw new SpeechAbortedError();
    }
    throw err;
  } finally {
    if (fetchAbort === ac) fetchAbort = null;
  }
}
