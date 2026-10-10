import { DEFAULT_THEME, themeOf, type ThemeId } from "../shared/account.ts";

const KEY = "solp-theme";
const FONTS: Partial<Record<ThemeId, string>> = {
  library: "family=Alegreya+Sans:wght@400;500;700&family=Cormorant+SC:wght@500;600;700",
  reception: "family=Barlow:wght@400;500;600;700&family=Chakra+Petch:wght@500;600;700&family=Saira+Condensed:wght@500;600;700;800",
};
const THEME_COLOR: Record<ThemeId, string> = { classic: "#14110f", library: "#100c09", reception: "#07090c" };

/** The theme this device used last, so the page opens in it before the account loads. */
export function savedTheme(): ThemeId {
  try {
    return themeOf(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** Switches the whole app's look: styles key off <html data-theme> (src/themes.css). */
export function applyTheme(theme: ThemeId) {
  const root = document.documentElement;
  if (theme === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  const fonts = FONTS[theme];
  if (fonts && !document.getElementById(`fonts-${theme}`)) {
    const link = document.createElement("link");
    link.id = `fonts-${theme}`;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${fonts}&display=swap`;
    document.head.appendChild(link);
  }
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private windows can refuse storage; the account's theme still applies once it loads.
  }
}
