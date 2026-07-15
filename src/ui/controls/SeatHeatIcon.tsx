import type { SeatLevel } from "../../state/vehicleState";
import {
  SEAT_ARROW_PATHS,
  SEAT_HEAT_HOT,
  SEAT_HEAT_OFF,
  SEAT_HEAT_OFF_OPACITY,
} from "../../seatArrowPaths";

// Three heat-wave arrows. For level N the first N arrows are hot, the rest inert.
export function SeatHeatIcon({ level, size = 20 }: { level: SeatLevel; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      {SEAT_ARROW_PATHS.map((d, i) => (
        <path
          key={i}
          fillRule="evenodd"
          clipRule="evenodd"
          d={d}
          fill={i < level ? SEAT_HEAT_HOT : SEAT_HEAT_OFF}
          fillOpacity={i < level ? 1 : SEAT_HEAT_OFF_OPACITY}
        />
      ))}
    </svg>
  );
}
