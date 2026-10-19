/**
 * 朗读仅使用服务端豆包音色（/api/tts）+ Audio 播放，不回退系统/浏览器语音。
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
}

async function fetchDoubaoChunk(text: string): Promise<Blob> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
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

export async function speakText(text: string): Promise<void> {
  const content = text.trim();
  if (!content) return;

  await stopSpeaking();

  const chunks = chunkTextForTts(content);
  if (chunks.length === 0) return;

  const token = playToken;
  for (const chunk of chunks) {
    if (token !== playToken) return;
    const blob = await fetchDoubaoChunk(chunk);
    if (token !== playToken) return;
    await playBlob(blob, token);
  }
}
