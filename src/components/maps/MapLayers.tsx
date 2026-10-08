import { useState } from "react";
import type { MapInfo, MapItem, Token } from "../../../shared/types.ts";
import { visibleMap } from "../../../shared/maps.ts";

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

/** The middle layer: images and other assets. The GM sees hidden ones faded. */
export function AssetLayer({ map }: { map: MapInfo }) {
  const images = (map.items ?? []).filter((i) => i.kind === "image");
  if (!images.length) return null;
  return (
    <div className="map-layer assets" aria-hidden="true">
      {images.map((i) => (
        <img
          key={i.id}
          src={i.url}
          alt=""
          draggable={false}
          className={"map-asset" + (i.hidden ? " is-hidden" : "")}
          style={{ ...placeStyle(map, i.x, i.y, i.w, i.h), rotate: i.rotation ? `${i.rotation}deg` : undefined }}
        />
      ))}
    </div>
  );
}

/** Pins and notes, drawn above the tokens. Tap one to read its note. */
export function PinLayer({ map }: { map: MapInfo }) {
  const pins = (map.items ?? []).filter((i) => i.kind === "pin");
  const [open, setOpen] = useState<string | null>(null);
  if (!pins.length) return null;
  return (
    <div className="map-layer pins">
      {pins.map((p) => (
        <Pin key={p.id} map={map} pin={p} open={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)} />
      ))}
    </div>
  );
}

export function Pin({ map, pin, open, onClick, selected }: { map: MapInfo; pin: MapItem; open?: boolean; onClick?: (e: React.MouseEvent) => void; selected?: boolean }) {
  return (
    <div className={"map-pin" + (pin.hidden ? " is-hidden" : "") + (selected ? " selected" : "")} style={{ ...placeStyle(map, pin.x, pin.y), color: pin.color ?? PIN_COLORS[0] }}>
      <button type="button" className="pin-head" aria-label={pin.name || "Pin"} title={pin.name || "Pin"} onClick={onClick} />
      {pin.name && <span className="pin-label">{pin.name}</span>}
      {open && pin.note && <span className="pin-note">{pin.note}</span>}
    </div>
  );
}

/**
 * A still picture of a map: background, assets, tokens and pins. `asPlayers` leaves out what the GM
 * hid, the way players will see it.
 */
export function MapPicture({ map: full, tokens, asPlayers, className = "" }: { map: MapInfo; tokens: Token[]; asPlayers?: boolean; className?: string }) {
  const map = asPlayers ? visibleMap(full) : full;
  const shown = asPlayers ? tokens.filter((t) => !t.hidden) : tokens;
  return (
    <div
      className={"map-picture " + className + (map.hideGrid ? " no-lines" : "")}
      style={{
        aspectRatio: `${map.width} / ${map.height}`,
        backgroundSize: `${100 / map.width}% ${100 / map.height}%, 100% 100%`,
        backgroundImage: [
          map.hideGrid ? "none" : "linear-gradient(#2a242099 1px, transparent 1px), linear-gradient(90deg, #2a242099 1px, transparent 1px)",
          map.background ? `url("${map.background}")` : "none",
        ].join(", "),
      }}
      role="img"
      aria-label={`${full.name}, ${full.width} by ${full.height} tiles`}
    >
      {map.background && map.backgroundHidden && !asPlayers && <span className="hidden-tag">Background hidden</span>}
      <AssetLayer map={map} />
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
