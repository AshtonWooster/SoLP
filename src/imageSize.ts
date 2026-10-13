// How big each kind of uploaded image is stored: no bigger than the largest size the app ever shows it at.

/**
 * "cover": shown cropped to fill a box (portraits, Page art), so the shorter side must still fill it.
 * "contain": shown whole (maps, map images), so the longer side is what's capped.
 */
export type ImageFit = "cover" | "contain";

export interface ImagePreset {
  /** Largest box the image is shown in, in pixels, already doubled for high-density screens. */
  width: number;
  height: number;
  fit: ImageFit;
}

export type ImageKind = "portrait" | "photo" | "art" | "gameCover" | "mapImage" | "mapBackground" | "popup";

export const IMAGE_PRESETS: Record<ImageKind, ImagePreset> = {
  // Enemy and NPC portraits: the 170px license photo, list icons and tokens on the board (which zoom).
  portrait: { width: 512, height: 512, fit: "cover" },
  // A player's 3:4 license photo (170px wide), also cropped square for their token and icons.
  photo: { width: 432, height: 576, fit: "cover" },
  // Page and item art: 4:3, at most ~400px wide on a full card.
  art: { width: 800, height: 600, fit: "cover" },
  // A game's image: 8:3, a banner up to ~740px wide on the game's page and behind its box on the front page.
  gameCover: { width: 1600, height: 600, fit: "cover" },
  // Images placed on a map's asset layer: they can be stretched over several cells and zoomed.
  mapImage: { width: 2048, height: 2048, fit: "contain" },
  // Whole map backgrounds: generous, so they stay sharp when zoomed in.
  mapBackground: { width: 4096, height: 4096, fit: "contain" },
  // Images in the GM's popups to players: shown whole, up to a phone's or a laptop's popup width.
  popup: { width: 1280, height: 1280, fit: "contain" },
};

/**
 * The size to store a `width`×`height` image at for `preset`: scaled down to the preset's box,
 * never up, keeping its shape. A "cover" image very unlike its box is also capped at twice the
 * box's longer side, so a panorama portrait doesn't keep a huge long side nobody sees.
 */
export function fitImageSize(width: number, height: number, preset: ImagePreset): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0 };
  const sx = preset.width / width;
  const sy = preset.height / height;
  let scale = preset.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  if (preset.fit === "cover") scale = Math.min(scale, (2 * Math.max(preset.width, preset.height)) / Math.max(width, height));
  scale = Math.min(1, scale);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Types we re-encode. GIFs are left alone: drawing one on a canvas would drop its animation. */
export function canResize(type: string): boolean {
  return ["image/png", "image/jpeg", "image/webp", "image/avif", "image/bmp"].includes(type);
}

/**
 * Whether to upload the re-encoded image instead of the original: when it was shrunk, or when
 * re-encoding alone made it noticeably smaller (a huge PNG photo at its displayed size already).
 */
export function keepResized(original: { width: number; height: number; bytes: number }, resized: { width: number; height: number; bytes: number }): boolean {
  if (resized.bytes <= 0) return false;
  if (resized.width < original.width || resized.height < original.height) return true;
  return resized.bytes < original.bytes * 0.9;
}

/** File extension for a stored image type. */
export function extensionFor(type: string): string {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/bmp": "bmp" }[type] ?? "png";
}

/**
 * How the uploader framed an image: turned by `rotation` degrees, zoomed in by `zoom` (1 = just
 * filling the frame), with the source pixel (`cx`, `cy`) at the frame's center.
 */
export interface ImageCrop {
  rotation: number;
  zoom: number;
  cx: number;
  cy: number;
}

export const MAX_ZOOM = 5;

/** A crop that shows the whole frame filled, centered and unturned: the same as uploading without adjusting. */
export function defaultCrop(width: number, height: number): ImageCrop {
  return { rotation: 0, zoom: 1, cx: width / 2, cy: height / 2 };
}

/** The frame's shape for an image: the kind's own shape, or for maps the image's own (turned a quarter if rotated sideways). */
export function frameAspect(kind: ImageKind, width: number, height: number, rotation: number): number {
  const preset = IMAGE_PRESETS[kind];
  if (preset.fit === "cover") return preset.width / preset.height;
  const sideways = Math.round(rotation / 90) % 2 !== 0;
  return sideways ? height / width : width / height;
}

/** Frame pixels per source pixel at zoom 1: just enough that the turned image covers a `frameW`×`frameH` frame. */
export function coverScale(width: number, height: number, rotation: number, frameW: number, frameH: number): number {
  const a = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return Math.max((frameW * c + frameH * s) / width, (frameW * s + frameH * c) / height);
}

/** Keep the frame on the picture: move the center back in so no empty corner shows, and keep zoom in range. */
export function clampCrop(crop: ImageCrop, width: number, height: number, aspect: number): ImageCrop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  const frameW = aspect;
  const frameH = 1;
  const scale = coverScale(width, height, crop.rotation, frameW, frameH) * zoom;
  const a = (crop.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  // Half the frame's bounding box, in source pixels along the image's own axes.
  const ex = (frameW * c + frameH * s) / (2 * scale);
  const ey = (frameW * s + frameH * c) / (2 * scale);
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return { rotation: crop.rotation, zoom, cx: clamp(crop.cx, ex, width - ex), cy: clamp(crop.cy, ey, height - ey) };
}

/** The size to store a framed image at: the frame's area in source pixels, shrunk to the kind's preset. */
export function croppedSize(width: number, height: number, crop: ImageCrop, aspect: number, kind: ImageKind): { width: number; height: number } {
  const scale = coverScale(width, height, crop.rotation, aspect, 1) * crop.zoom;
  return fitImageSize(aspect / scale, 1 / scale, IMAGE_PRESETS[kind]);
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Shrink `file` to the largest size `kind` is ever shown at, as WebP (which keeps transparency).
 * Falls back to JPEG or PNG where the browser can't write WebP, and to the original file when
 * shrinking wouldn't help or the browser can't decode it.
 */
export async function resizeImage(file: Blob, kind: ImageKind, crop?: ImageCrop): Promise<Blob> {
  if (!canResize(file.type) || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const { width, height } = bitmap;
    const framed = crop ?? defaultCrop(width, height);
    const aspect = frameAspect(kind, width, height, framed.rotation);
    const size = croppedSize(width, height, framed, aspect, kind);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(size.width / 2, size.height / 2);
    ctx.rotate((framed.rotation * Math.PI) / 180);
    const scale = coverScale(width, height, framed.rotation, size.width, size.height) * framed.zoom;
    ctx.scale(scale, scale);
    ctx.drawImage(bitmap, -framed.cx, -framed.cy);
    let out = await encode(canvas, "image/webp", 0.85);
    // Browsers that can't write WebP hand back a PNG instead: use JPEG for photos, PNG for the rest.
    if (!out || out.type !== "image/webp") out = await encode(canvas, file.type === "image/jpeg" ? "image/jpeg" : "image/png", 0.85);
    if (!out) return file;
    // An untouched image that re-encoding wouldn't shrink goes up as it is; an adjusted one always uses the edit.
    const edited = crop && (crop.rotation % 360 !== 0 || crop.zoom !== 1 || Math.abs(crop.cx - width / 2) > 0.5 || Math.abs(crop.cy - height / 2) > 0.5);
    return edited || keepResized({ width, height, bytes: file.size }, { ...size, bytes: out.size }) ? out : file;
  } finally {
    bitmap.close();
  }
}
