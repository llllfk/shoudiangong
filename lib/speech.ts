/**
 * 朗读优先走服务端豆包音色（/api/tts）；失败时再回退系统 TTS。
 */

import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

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

function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function hasWebSpeech(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined"
  );
}

export function canSpeak(): boolean {
  // 页面朗读走服务端豆包；环境只要能播音频即可
  return typeof window !== "undefined";
}

async function stopNativeAndWeb(): Promise<void> {
  if (isNativeApp()) {
    try {
      await TextToSpeech.stop();
    } catch {
      // ignore
    }
  }
  if (hasWebSpeech()) {
    window.speechSynthesis.cancel();
  }
}

export async function stopSpeaking(): Promise<void> {
  playToken += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  await stopNativeAndWeb();
}

async function fetchDoubaoChunk(text: string, signal?: AbortSignal): Promise<Blob> {
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

async function speakViaNative(text: string): Promise<void> {
  await TextToSpeech.speak({
    text,
    lang: "zh-CN",
    rate: 0.95,
    pitch: 1.0,
    volume: 1.0,
    category: "playback",
  });
}

async function speakViaWeb(text: string): Promise<void> {
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
    // 豆包合成失败时回退本机音色，保证按钮仍可用
  }

  if (isNativeApp()) {
    await speakViaNative(content);
    return;
  }

  if (hasWebSpeech()) {
    await speakViaWeb(content);
    return;
  }

  throw new Error("UNSUPPORTED");
}
