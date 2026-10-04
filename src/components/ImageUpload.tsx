import { useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { newId } from "../../shared/engine.ts";
import { friendlyError, storage } from "../firebase.ts";

const MAX_BYTES = 5 * 1024 * 1024;

/** Check and upload one image file under `folder`; resolves to its download URL. */
export async function uploadImage(folder: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Pick an image file.");
  if (file.size > MAX_BYTES) throw new Error("Images must be under 5 MB.");
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const r = ref(storage, `${folder}/${newId()}.${ext}`);
  await uploadBytes(r, file, { contentType: file.type });
  return getDownloadURL(r);
}

/** Upload an image to Cloud Storage under `folder` and report its URL. */
export function ImageUpload({
  folder,
  value,
  onChange,
  label = "Image",
  shape = "square",
}: {
  folder: string;
  value?: string;
  onChange: (url: string | undefined) => void;
  label?: string;
  /** "page": 4:3 landscape, like Page art everywhere it's shown. */
  shape?: "square" | "page";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className={`image-upload ${shape}`}>
      <div className="image-preview">{value ? <img src={value} alt="" /> : <span className="muted small">No {label.toLowerCase()}</span>}</div>
      <div className="image-actions">
        <label className={"button-like" + (busy ? " disabled" : "")}>
          {busy ? "Uploading…" : value ? `Change ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
          <input
            type="file"
            accept="image/*"
            hidden
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
