/**
 * Convert a File to a base64 data URI string.
 * Images are resized to fit within maxDimension (default 600px) to save space.
 * Other file types are converted directly without processing.
 */

/** Resize an image file to a maximum dimension. Returns a data URI. */
async function resizeImage(file: File, maxDimension: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(file.type || "image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Convert any file to a data URI. Images are resized; other types are read as-is. */
export async function fileToDataUri(
  file: File,
  imageMaxDimension = 600,
): Promise<string> {
  if (file.type.startsWith("image/")) {
    return resizeImage(file, imageMaxDimension);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
