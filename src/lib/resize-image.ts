/** Resize an image Blob/File client-side, return as JPEG data URI */
function resizeBlob(blob: Blob, maxWidth: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

/** Resize an image file client-side, return as JPEG data URI */
export function resizeImageFile(file: File, maxWidth: number): Promise<string> {
  return resizeBlob(file, maxWidth);
}

/** Extract an image from a ClipboardEvent's paste data and resize it */
export async function getImageFromClipboard(
  e: React.ClipboardEvent | ClipboardEvent,
  maxWidth: number,
): Promise<string | null> {
  const items = e.clipboardData?.items;
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const blob = item.getAsFile();
      if (!blob) continue;
      return resizeBlob(blob, maxWidth);
    }
  }
  return null;
}
