/** Compress image data URL for cloud sync (Supabase row size limits) */
export function compressImageDataUrl(
  dataUrl: string,
  maxSide = 200,
  quality = 0.55
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height || 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const out = canvas.toDataURL("image/jpeg", quality);
        // Cap ~120KB data URL to avoid Supabase payload failures
        if (out.length > 160_000 && quality > 0.35) {
          const smaller = canvas.toDataURL("image/jpeg", 0.35);
          resolve(smaller.length < out.length ? smaller : out);
        } else {
          resolve(out);
        }
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
