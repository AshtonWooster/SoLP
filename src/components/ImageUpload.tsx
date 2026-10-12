import { useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { newId } from "../../shared/engine.ts";
import { friendlyError, storage } from "../firebase.ts";

const MAX_BYTES = 5 * 1024 * 1024;
/** The image types storage.rules accepts: raster images, no SVG (it can carry scripts). */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"];
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");

/** Check and upload one image file under `folder`; resolves to its download URL. */
export async function uploadImage(folder: string, file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Pick a PNG, JPEG, GIF or WebP image.");
  if (file.size > MAX_BYTES) throw new Error("Images must be under 5 MB.");
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const r = ref(storage, `${folder}/${newId()}.${ext}`);
  await uploadBytes(r, file, { contentType: file.type });
  return getDownloadURL(r);
}

/** Tap the picture to upload an image to Cloud Storage under `folder`; reports its URL. */
export function ImageUpload({
  folder,
  value,
  onChange,
  label = "Image",
  shape = "square",
  ring,
}: {
  folder: string;
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
              onChange(await uploadImage(folder, file));
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
