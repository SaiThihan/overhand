import type { Model } from "@/app/data";
import { useMapMode } from "@/app/mapMode";
import { AttentionMap } from "@/map/AttentionMap";
import type { WorldId } from "@/map/worlds";

/**
 * The window on the world: the attention map fills the clear part of Now's centre column (square on a phone), and is
 * its own keyboard surface. Settings › Look & sound › Still holds it still; it never goes away, since it's
 * information, not decoration.
 */
export function MapWindow({ m, world }: { m: Model; world: WorldId }) {
  const [mode] = useMapMode();
  return (
    <div data-scene-window="" className="relative aspect-square w-full self-center lg:aspect-auto lg:min-h-0 lg:flex-1">
      <AttentionMap m={m} world={world} still={mode !== "on"} />
    </div>
  );
}
