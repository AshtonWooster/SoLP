import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PlayerListEntry } from "../../shared/players.ts";

/**
 * A player's character as a small card: picture and name, plus anything in `extra`. When the
 * entry has a link (the GM's view) the card opens the character page; `newTab` opens it beside
 * the GM screen, which has to stay open to host the table.
 */
export function PlayerPreview({ entry, extra, newTab }: { entry: PlayerListEntry; extra?: ReactNode; newTab?: boolean }) {
  const c = entry.character;
  if (!c) return null;
  const body = (
    <>
      <span className="npc-portrait">{c.portrait ? <img src={c.portrait} alt="" /> : <span>{c.name[0].toUpperCase()}</span>}</span>
      <span className="player-preview-text">
        <strong>{c.name}</strong>
        {extra}
      </span>
    </>
  );
  const label = `Open ${c.name}'s character page`;
  if (!entry.href) return <div className="player-preview">{body}</div>;
  return newTab ? (
    <a className="player-preview clickable" href={entry.href} target="_blank" rel="noreferrer" aria-label={label}>
      {body}
    </a>
  ) : (
    <Link className="player-preview clickable" to={entry.href} aria-label={label}>
      {body}
    </Link>
  );
}
