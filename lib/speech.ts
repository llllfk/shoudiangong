/**
 * 朗读走服务端豆包音色（/api/tts）+ 浏览器 Audio 播放。
 * 不依赖 Capacitor 插件，避免云端构建 Module not found。
 */

/** 扣子 speech input 上限 1024 字节，略留余量 */
const MAX_TTS_BYTES = 900;

let currentAudio: HTMLAudioElement | null = null;
let playToken = 0;

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 按 UTF-8 字节切分，避免超过接口限制 */
export function chunkTextForTts(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (utf8Bytes(normalized) <= MAX_TTS_BYTES) return [normalized];

  const chunks: string[] = [];
  let current = "";
  let bytes = 0;

  const flush = () => {
    const part = current.trim();
    if (part) chunks.push(part);
    current = "";
    bytes = 0;
  };

  for (const ch of normalized) {
    const size = utf8Bytes(ch);
    if (bytes + size > MAX_TTS_BYTES && current) {
      flush();
    }
    current += ch;
    bytes += size;
    if (/[。！？；\n.!?;]/.test(ch) && bytes >= MAX_TTS_BYTES * 0.55) {
      flush();
    }
  }
  flush();
  return chunks;
}

export function canSpeak(): boolean {
  return typeof window !== "undefined";
}

export async function stopSpeaking(): Promise<void> {
  playToken += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

async function fetchDoubaoChunk(
  text: string,
  signal?: AbortSignal,
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

function playBlob(blob: Blob, token: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token !== playToken) {
      resolve();
      return;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      reject(new Error("音频播放失败"));
    };
    void audio.play().catch(reject);
  });
}

async function speakViaDoubao(text: string): Promise<void> {
  const chunks = chunkTextForTts(text);
  if (chunks.length === 0) return;
  const token = playToken;
  for (const chunk of chunks) {
    if (token !== playToken) return;
    const blob = await fetchDoubaoChunk(chunk);
    if (token !== playToken) return;
    await playBlob(blob, token);
  }
}

async function speakViaWeb(text: string): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    throw new Error("UNSUPPORTED");
  }
  window.speechSynthesis.getVoices();
  await new Promise<void>((resolve, reject) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "zh-CN";
    utter.rate = 0.95;
    utter.onend = () => resolve();
    utter.onerror = () => reject(new Error("SPEECH_ERROR"));
    window.speechSynthesis.speak(utter);
  });
}

export async function speakText(text: string): Promise<void> {
  const content = text.trim();
  if (!content) return;

  await stopSpeaking();

  try {
    await speakViaDoubao(content);
    return;
  } catch {
    // 豆包失败时回退浏览器语音
  }

  if (typeof window !== "undefined" && window.speechSynthesis) {
    await speakViaWeb(content);
    return;
  }

  throw new Error("UNSUPPORTED");
}
