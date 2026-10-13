import { useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { newId } from "../../shared/engine.ts";
import { friendlyError, storage } from "../firebase.ts";
import { extensionFor, resizeImage, type ImageKind } from "../imageSize.ts";

const MAX_BYTES = 5 * 1024 * 1024;
/** Biggest file we'll try to shrink: phone photos are often over 5 MB before resizing. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
/** The image types storage.rules accepts: raster images, no SVG (it can carry scripts). */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"];
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");

/** Check, shrink to its displayed size (see `IMAGE_PRESETS`) and upload one image under `folder`; resolves to its download URL. */
export async function uploadImage(folder: string, file: File, kind: ImageKind): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Pick a PNG, JPEG, GIF or WebP image.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Images must be under 40 MB.");
  const blob = await resizeImage(file, kind);
  if (blob.size > MAX_BYTES) throw new Error("Images must be under 5 MB.");
  const r = ref(storage, `${folder}/${newId()}.${extensionFor(blob.type)}`);
  await uploadBytes(r, blob, { contentType: blob.type });
  return getDownloadURL(r);
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
  /** "page": 4:3 landscape, like Page art everywhere it's shown. */
  shape?: "square" | "page";
  /** A colored ring around the picture, like a token's color. */
  ring?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              onChange(await uploadImage(folder, file, kind));
            } catch (err) {
              setError(friendlyError(err));
            } finally {
              setBusy(false);
            }
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
    </div>
  );
}
