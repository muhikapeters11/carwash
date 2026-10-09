/** Compress image data URL for cloud sync */
export function compressImageDataUrl(
  dataUrl: string,
  maxSide = 160,
  quality = 0.5
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
      let q = quality;
      let out = canvas.toDataURL("image/jpeg", q);
      // Keep under ~25KB characters so REST upsert / Realtime can carry it
      while (out.length > 28_000 && q > 0.28) {
        q -= 0.08;
        out = canvas.toDataURL("image/jpeg", q);
      }
      resolve(out);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const [meta, b64] = dataUrl.split(",");
    if (!b64) return null;
    const mime = /data:([^;]+)/.exec(meta || "")?.[1] || "image/jpeg";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Prefer Supabase Storage public URL so every device loads the same image.
 * Falls back to a small data URL if Storage is not set up yet.
 */
export async function resolveProductImageForCloud(
  supabaseUrl: string,
  anonKey: string,
  productId: string,
  imageUrl: string | undefined | null
): Promise<string | null> {
  if (!imageUrl) return null;
  // Already a normal URL (Storage or external)
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;

  let dataUrl = imageUrl;
  if (dataUrl.startsWith("data:")) {
    dataUrl = await compressImageDataUrl(dataUrl, 160, 0.5);
  } else {
    return imageUrl;
  }

  const blob = dataUrlToBlob(dataUrl);
  if (blob && supabaseUrl && anonKey) {
    const path = `${productId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jpg`;
    try {
      const endpoint = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/product-images/${path}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "image/jpeg",
          "x-upsert": "true",
        },
        body: blob,
      });
      if (res.ok || res.status === 200 || res.status === 201) {
        return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/product-images/${path}`;
      }
      // try update if exists
      const res2 = await fetch(endpoint, {
        method: "PUT",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "image/jpeg",
          "x-upsert": "true",
        },
        body: blob,
      });
      if (res2.ok || res2.status === 200 || res2.status === 201) {
        return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/product-images/${path}`;
      }
    } catch {
      /* fall through to data URL */
    }
  }

  // Fallback: only keep tiny data URLs in the products row
  if (dataUrl.length <= 28_000) return dataUrl;
  return null;
}
