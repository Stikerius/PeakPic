import Ionicons from "@expo/vector-icons/Ionicons";

import { flameColors, flameScale } from "@/constants/theme";
import type { FlameTier } from "@/lib/streak";

type FlameIconProps = {
  tier: FlameTier;
  /** Size at tier 0; higher tiers grow from here. */
  baseSize: number;
};

export function FlameIcon({ tier, baseSize }: FlameIconProps) {
  return (
    <Ionicons
      name="flame"
      size={Math.round(baseSize * flameScale[tier])}
      color={flameColors[tier]}
    />
  );
}
