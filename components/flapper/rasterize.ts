/**
 * An uploaded image as a theme pack wants it: small, square-ish, one of the
 * two formats the pack accepts, inline. Drawing through a canvas is what
 * makes the size predictable, and it strips whatever else the file carried
 * (EXIF, an SVG's scripts, a 4000 px original).
 */

const ART_EDGE_PX = 128;

function toDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('could not read the image'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * @returns a `data:image/webp` (or png) URI no larger than `maxBytes`
 *   decoded, or throws with a reason the user can act on.
 */
export async function fileToArt(file: File, { edge = ART_EDGE_PX, maxBytes }: { edge?: number; maxBytes: number }) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('that file is not an image the browser can decode');
  }
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas available');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // WebP first at falling quality, PNG as the lossless fallback for tiny marks.
  for (const [type, quality] of [['image/webp', 0.92], ['image/webp', 0.8], ['image/webp', 0.6], ['image/png', undefined]] as const) {
    const blob = await encode(canvas, type, quality);
    if (!blob || blob.type !== type) continue;
    if (blob.size <= maxBytes) return { dataUri: await toDataUri(blob), bytes: blob.size, width, height };
  }
  throw new Error(`the image is too detailed to fit in ${Math.round(maxBytes / 1024)} KB at ${edge} px - try a simpler mark`);
}
