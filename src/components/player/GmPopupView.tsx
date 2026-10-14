import { ANY_STAT, POPUP_STATS, statLabel } from "../../../shared/popups.ts";
import { STORY_DIE } from "../../../shared/ruleset.ts";
import type { PlayerPopup } from "../../../shared/types.ts";
import { AnyStatIcon } from "../LorIcons.tsx";
import { Overlay } from "./Overlay.tsx";
import { StableLabel } from "../StableLabel.tsx";

/**
 * A popup the GM sent this player: any mix of text, an image and a Story Roll prompt. The roll goes
 * in the table log like any Story Roll; closing it hides it for good on this player's screens.
 */
export function GmPopupView({
  popup,
  more,
  stats,
  canRoll,
  onRoll,
  onClose,
}: {
  popup: PlayerPopup;
  /** How many more popups are waiting behind this one. */
  more: number;
  /** The player's Stats, for the bonus each adds. */
  stats: Record<string, number>;
  /** False until the player has a token on the table. */
  canRoll: boolean;
  onRoll: (stat?: string) => void;
  onClose: () => void;
}) {
  const roll = popup.roll;
  const bonus = (key: string) => {
    const v = stats[key] ?? 0;
    return `${v >= 0 ? "+" : ""}${v}`;
  };
  return (
    <Overlay title={popup.title || "From your GM"} onClose={onClose}>
      <div className="gm-popup">
        {popup.image && <img className="gm-popup-image" src={popup.image} alt="" />}
        {popup.text && <p className="gm-popup-text">{popup.text}</p>}
        {roll && (
          <div className="gm-popup-roll">
            {popup.rolled !== undefined ? (
              <p role="status">
                <strong>You rolled {popup.rolled}.</strong> <span className="muted small">It's in the table log.</span>
              </p>
            ) : roll.stat === ANY_STAT ? (
              <>
                <p className="muted small">Your GM asks for a Story Roll. Pick a Stat: 1d{STORY_DIE} + the Stat.</p>
                <div className="story-grid">
                  {POPUP_STATS.map((s) => (
                    <button type="button" key={s.key} className="story-stat" disabled={!canRoll} onClick={() => onRoll(s.key)}>
                      <span className="story-name">
                        <AnyStatIcon stat={s.key} /> {s.label}
                      </span>
                      <span className="muted">{bonus(s.key)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button type="button" className="big-button" disabled={!canRoll} onClick={() => onRoll()}>
                Roll {statLabel(roll.stat)} (1d{STORY_DIE} {bonus(roll.stat)})
              </button>
            )}
            {!canRoll && popup.rolled === undefined && <p className="muted small">You can roll once your character is on the table.</p>}
          </div>
        )}
        <div className="row-between">
          <span className="muted small">{more > 0 ? `${more} more from your GM` : ""}</span>
          <button type="button" onClick={onClose}>
            <StableLabel labels={roll ? ["Close", "Next", "Close without rolling"] : ["Close", "Next"]} show={roll && popup.rolled === undefined ? 2 : more > 0 ? 1 : 0} />
          </button>
        </div>
      </div>
    </Overlay>
  );
}
