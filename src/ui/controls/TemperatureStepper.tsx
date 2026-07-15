import { IconButton } from "@liquidai/react";
import { useVehicle, TEMP_MIN, TEMP_MAX } from "../../state/vehicleState";
import { stepTemperature } from "../../state/vehicleCommands";
import { ChevronUp, ChevronDown } from "../icons";

/** Internal-temperature stepper: [▲]  72°  [▼] (up-left, down-right per mock). */
export function TemperatureStepper() {
  const temperature = useVehicle((s) => s.temperature);

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-secondary p-1.5">
      <IconButton
        variant="default"
        size="sm"
        aria-label="Raise temperature"
        disabled={temperature >= TEMP_MAX}
        onClick={() => stepTemperature(1)}
      >
        <ChevronUp />
      </IconButton>
      <span className="text-sm font-medium tabular-nums text-foreground">
        {temperature}°
      </span>
      <IconButton
        variant="default"
        size="sm"
        aria-label="Lower temperature"
        disabled={temperature <= TEMP_MIN}
        onClick={() => stepTemperature(-1)}
      >
        <ChevronDown />
      </IconButton>
    </div>
  );
}
