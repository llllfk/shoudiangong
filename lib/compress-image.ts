/**
 * 浏览器端压缩检修照片：限制最长边与体积，降低多模态模型限流失败率。
 * 输出 JPEG（部件外观图不需要透明通道）。
 */

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_MAX_BYTES = 1.2 * 1024 * 1024;
const DEFAULT_QUALITY = 0.82;

function replaceExtWithJpg(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "part";
  return `${base}.jpg`;
}

async function loadImageBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function drawToCanvas(
  source: ImageBitmap,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建画布，图片压缩失败");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("图片压缩失败"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

export async function compressImageFile(
  file: File,
  options?: {
    maxEdge?: number;
    maxBytes?: number;
    quality?: number;
  },
): Promise<File> {
  if (typeof document === "undefined") {
    return file;
  }

  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const startQuality = options?.quality ?? DEFAULT_QUALITY;

  let bitmap: ImageBitmap;
  try {
    bitmap = await loadImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const scale = Math.min(
      1,
      maxEdge / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    // 已足够小且无需缩放时，原样上传（避免重复编码损失）
    if (scale === 1 && file.size <= maxBytes && file.type === "image/jpeg") {
      return file;
    }

    const canvas = drawToCanvas(bitmap, width, height);
    let quality = startQuality;
    let blob = await canvasToBlob(canvas, quality);

    while (blob.size > maxBytes && quality > 0.45) {
      quality = Math.max(0.45, quality - 0.12);
      blob = await canvasToBlob(canvas, quality);
    }

    // 仍过大则再缩一档边长
    if (blob.size > maxBytes) {
      const scale2 = Math.min(
        1,
        1280 / Math.max(bitmap.width, bitmap.height),
      );
      const w2 = Math.max(1, Math.round(bitmap.width * scale2));
      const h2 = Math.max(1, Math.round(bitmap.height * scale2));
      if (w2 < width || h2 < height) {
        const canvas2 = drawToCanvas(bitmap, w2, h2);
        blob = await canvasToBlob(canvas2, 0.72);
      }
    }

    return new File([blob], replaceExtWithJpg(file.name || "part.jpg"), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
