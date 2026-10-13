import { useMemo } from "react";
import { statusVfxOn, vfxByStatus, type VfxDef } from "../../../shared/vfx.ts";
import type { GameDoc } from "../../../shared/types.ts";
import { useCollection } from "../../api.ts";
import type { VfxByStatus } from "./VfxView.tsx";

/** The game's VFX library, by id. Pass null to skip loading it. */
export function useVfxLibrary(gameId: string | null): Record<string, VfxDef> | undefined {
  return useCollection<VfxDef>(gameId ? `games/${gameId}/vfx` : null);
}

/**
 * The game's VFX by the status Effect they play on, for the map. Only loaded while "Status effect VFX"
 * is on in Game settings: off, the map reads nothing more than it did before VFX.
 */
export function useStatusVfx(gameId: string, game: GameDoc | undefined): VfxByStatus | undefined {
  const library = useVfxLibrary(gameId && statusVfxOn(game) ? gameId : null);
  return useMemo(() => (library ? vfxByStatus(library) : undefined), [library]);
}
