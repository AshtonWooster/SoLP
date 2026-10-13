import { type ReactNode, useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { newId } from "../../shared/engine.ts";
import { friendlyError, storage } from "../firebase.ts";
import { canResize, extensionFor, type ImageCrop, type ImageKind, resizeImage } from "../imageSize.ts";
import { ImageEditor } from "./ImageEditor.tsx";

const MAX_BYTES = 5 * 1024 * 1024;
/** Biggest file we'll try to shrink: phone photos are often over 5 MB before resizing. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
/** The image types storage.rules accepts: raster images, no SVG (it can carry scripts). */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"];
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");

/** Check, shrink to its displayed size (see `IMAGE_PRESETS`) and upload one image under `folder`; resolves to its download URL. */
export async function uploadImage(folder: string, file: File, kind: ImageKind, crop?: ImageCrop): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Pick a PNG, JPEG, GIF or WebP image.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Images must be under 40 MB.");
  const blob = await resizeImage(file, kind, crop);
  if (blob.size > MAX_BYTES) throw new Error("Images must be under 5 MB.");
  const r = ref(storage, `${folder}/${newId()}.${extensionFor(blob.type)}`);
  await uploadBytes(r, blob, { contentType: blob.type });
  return getDownloadURL(r);
}

/**
 * Pick, frame and upload an image: `pick(file)` opens the framing editor (render `editor`), then
 * uploads what was framed and reports its URL. GIFs skip the editor so they keep animating.
 */
export function useImageUpload(folder: string, kind: ImageKind, onUploaded: (url: string, file: File) => void, onError?: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<File | null>(null);
  const report = (m: string) => (setError(m), onError?.(m));
  const upload = async (file: File, crop?: ImageCrop) => {
    setBusy(true);
    report("");
    try {
      onUploaded(await uploadImage(folder, file, kind, crop), file);
    } catch (err) {
      report(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return report("Pick a PNG, JPEG, GIF or WebP image.");
    if (!canResize(file.type)) return void upload(file);
    report("");
    setPending(file);
  };
  const editor: ReactNode = pending && (
    <ImageEditor
      file={pending}
      kind={kind}
      onCancel={() => setPending(null)}
      onDone={(crop) => {
        const file = pending;
        setPending(null);
        void upload(file, crop);
      }}
    />
  );
  return { busy, error, pick, editor };
}

/** Tap the picture to upload an image to Cloud Storage under `folder`; reports its URL. */
export function ImageUpload({
  folder,
  kind,
  value,
  onChange,
  label = "Image",
  shape = "square",
  ring,
}: {
  folder: string;
  /** What the image is for, which sets the size it's stored at. */
  kind: ImageKind;
  value?: string;
  onChange: (url: string | undefined) => void;
  label?: string;
  /** "page": 4:3 landscape, like Page art everywhere it's shown. "cover": an 8:3 banner, like a game's image. */
  shape?: "square" | "page" | "cover";
  /** A colored ring around the picture, like a token's color. */
  ring?: string;
}) {
  const { busy, error, pick, editor } = useImageUpload(folder, kind, (url) => onChange(url));
  return (
    <div className={`image-upload ${shape}`}>
      <label className={"image-preview pickable" + (busy ? " busy" : "")} title={value ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`} style={ring ? { borderColor: ring, boxShadow: `0 0 0 2px ${ring}` } : undefined}>
        {value ? <img src={value} alt="" /> : <span className="muted small">{busy ? "Uploading…" : `Tap to add ${label.toLowerCase()}`}</span>}
        {busy && value && <span className="image-busy small">Uploading…</span>}
        <input
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          aria-label={label}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            pick(file);
          }}
        />
      </label>
      <div className="image-actions">
        {value && (
          <button type="button" className="link" onClick={() => onChange(undefined)}>
            Remove
          </button>
        )}
        {error && <span className="error small">{error}</span>}
      </div>
      {editor}
    </div>
  );
}
