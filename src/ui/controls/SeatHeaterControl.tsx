import { cn } from "@liquidai/react";
import { useVehicle } from "../../state/vehicleState";
import type { SeatId } from "../../state/vehicleState";
import { cycleSeatHeat } from "../../state/vehicleCommands";
import { SeatHeatIcon } from "./SeatHeatIcon";

const SEATS: { id: SeatId; label: string }[] = [
  { id: "driver", label: "Driver" },
  { id: "passenger", label: "Passenger" },
  { id: "rear", label: "Backseat" },
];

/**
 * Driver / Passenger / Backseat heaters — three tall buttons with the heat icon
 * over a label. Each cell cycles 0 → 1 → 2 → 3 → 0; the icon shows N hot arrows.
 */
export function SeatHeaterControl() {
  const seatHeat = useVehicle((s) => s.seatHeat);

  return (
    <div className="grid grid-cols-3 gap-2">
      {SEATS.map(({ id, label }) => {
        const level = seatHeat[id];
        const active = level > 0;
        return (
          <button
            key={id}
            type="button"
            onClick={() => cycleSeatHeat(id)}
            aria-label={`${label} seat heater, level ${level} of 3`}
            className={cn(
              "flex h-[84px] min-w-0 flex-col items-center justify-center gap-2 rounded-lg bg-secondary px-3 text-sm font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <SeatHeatIcon level={level} size={22} />
            <span className="w-full truncate text-center">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
