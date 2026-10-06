/** Where to show a hover card for a list row: beside it, kept on screen. */
export const PEEK_WIDTH = 300;

export function peekPosition(el: HTMLElement): { top: number; left: number } {
  const r = el.getBoundingClientRect();
  const right = r.right + 12;
  const left = right + PEEK_WIDTH < window.innerWidth ? right : Math.max(8, r.left - PEEK_WIDTH - 12);
  const top = Math.max(8, Math.min(r.top - 40, window.innerHeight - 520));
  return { top, left };
}
