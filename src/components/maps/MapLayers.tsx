import { useState } from "react";
import type { MapInfo, MapItem, Token } from "../../../shared/types.ts";
import { visibleMap, visibleTokens } from "../../../shared/maps.ts";
import { FogLayer } from "./Fog.tsx";

export const PIN_COLORS = ["#e0b04f", "#d9534f", "#5c8fe0", "#6cc070", "#9b7ede", "#f1e9df"];

/** Where something measured in tiles sits on a map drawn at any size, as percentages. */
export function placeStyle(map: MapInfo, x: number, y: number, w?: number, h?: number): React.CSSProperties {
  return {
    left: `${(x / map.width) * 100}%`,
    top: `${(y / map.height) * 100}%`,
    ...(w !== undefined ? { width: `${(w / map.width) * 100}%` } : {}),
    ...(h !== undefined ? { height: `${(h / map.height) * 100}%` } : {}),
  };
}

/** Hands an asset or pin to the GM's drag on the table. */
export type GrabItem = (e: React.PointerEvent, item: MapItem) => void;

/** The middle layer: images and other assets. The GM sees hidden ones faded, and can drag them with `onGrab`. */
export function AssetLayer({ map, onGrab }: { map: MapInfo; onGrab?: GrabItem }) {
  const images = (map.items ?? []).filter((i) => i.kind === "image");
  if (!images.length) return null;
  return (
    <div className={"map-layer assets" + (onGrab ? " grabbable" : "")} aria-hidden={onGrab ? undefined : "true"}>
      {images.map((i) => (
        <img
          key={i.id}
          src={i.url}
          alt={onGrab ? (i.name ?? "Asset") : ""}
          title={onGrab ? (i.locked ? `${i.name ?? "Asset"} (locked in the map editor)` : (i.name ?? "Asset")) : undefined}
          draggable={false}
          className={"map-asset" + (i.hidden ? " is-hidden" : "") + (i.locked ? " is-locked" : "")}
          style={{ ...placeStyle(map, i.x, i.y, i.w, i.h), rotate: i.rotation ? `${i.rotation}deg` : undefined }}
          onPointerDown={onGrab && ((e) => onGrab(e, i))}
        />
      ))}
    </div>
  );
}

/**
 * Pins and notes, drawn above the tokens. Tap one to read its note. With `onGrab` the GM can drag
 * them; `wasDragged` says a click is the end of a drag, not a tap.
 */
export function PinLayer({ map, onGrab, wasDragged }: { map: MapInfo; onGrab?: GrabItem; wasDragged?: () => boolean }) {
  const pins = (map.items ?? []).filter((i) => i.kind === "pin");
  const [open, setOpen] = useState<string | null>(null);
  if (!pins.length) return null;
  return (
    <div className={"map-layer pins" + (onGrab ? " grabbable" : "")}>
      {pins.map((p) => (
        <Pin
          key={p.id}
          map={map}
          pin={p}
          open={open === p.id}
          onPointerDown={onGrab && ((e) => onGrab(e, p))}
          onClick={() => {
            if (wasDragged?.()) return;
            setOpen(open === p.id ? null : p.id);
          }}
        />
      ))}
    </div>
  );
}

export function Pin({
  map,
  pin,
  open,
  onClick,
  onPointerDown,
  selected,
}: {
  map: MapInfo;
  pin: MapItem;
  open?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  selected?: boolean;
}) {
  return (
    <div className={"map-pin" + (pin.hidden ? " is-hidden" : "") + (selected ? " selected" : "")} style={{ ...placeStyle(map, pin.x, pin.y), color: pin.color ?? PIN_COLORS[0] }}>
      <button type="button" className="pin-head" aria-label={pin.name || "Pin"} title={pin.name || "Pin"} onClick={onClick} onPointerDown={onPointerDown} />
      {pin.name && <span className="pin-label">{pin.name}</span>}
      {open && pin.note && <span className="pin-note">{pin.note}</span>}
    </div>
  );
}

/**
 * A still picture of a map: background, assets, tokens and pins. `asPlayers` leaves out what the GM
 * hid, the way players will see it.
 */
export function MapPicture({
  map: full,
  tokens,
  asPlayers,
  className = "",
}: {
  map: MapInfo;
  tokens: Token[];
  asPlayers?: boolean;
  className?: string;
}) {
  const map = asPlayers ? visibleMap(full) : full;
  const shown = asPlayers ? visibleTokens(full, tokens) : tokens;
  return (
    <div className={"map-picture " + className} style={{ aspectRatio: `${map.width} / ${map.height}` }} role="img" aria-label={`${full.name}, ${full.width} by ${full.height} tiles`}>
      {map.background && <img className={"picture-bg" + (map.backgroundHidden ? " is-hidden" : "")} src={map.background} alt="" />}
      {!map.hideGrid && <span className="picture-lines" style={{ backgroundSize: `${100 / map.width}% ${100 / map.height}%` }} />}
      {map.background && map.backgroundHidden && !asPlayers && <span className="hidden-tag">Background hidden</span>}
      <AssetLayer map={map} />
      <FogLayer map={full} gm={!asPlayers} />
      {shown.map((t) => (
        <span
          key={t.id}
          className={`picture-token ${t.side}` + (t.hidden ? " is-hidden" : "")}
          style={{ ...placeStyle(map, t.x + 0.1, t.y + 0.1, 0.8, 0.8), background: t.portrait ? `center / cover url("${t.portrait}"), ${t.color}` : t.color }}
          title={t.name}
        />
      ))}
      {(map.items ?? [])
        .filter((i) => i.kind === "pin")
        .map((p) => (
          <span key={p.id} className={"picture-pin" + (p.hidden ? " is-hidden" : "")} style={{ ...placeStyle(map, p.x, p.y), color: p.color ?? PIN_COLORS[0] }} />
        ))}
    </div>
  );
}
