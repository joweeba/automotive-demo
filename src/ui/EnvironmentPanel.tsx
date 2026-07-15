import { useVehicle } from "../state/vehicleState";
import { stepExternalTemp, cycleWeather } from "../state/vehicleCommands";
import { isNight } from "../state/autoResolve";
import { Rain, Sun, Moon, Mist, ChevronUp, ChevronDown } from "./icons";

// The environment display under the app title: external temperature + weather.
// This is the outside world that drives every "Auto" setting (see autoResolve).
// Interactive for the demo — chevrons nudge the temp, clicking the weather cycles
// clear → rain → fog. Day/night comes from the device clock (the Clear icon).
const WEATHER_LABEL = { clear: "Clear", rain: "Rain", fog: "Foggy" } as const;

export function EnvironmentPanel() {
  const externalTemp = useVehicle((s) => s.environment.externalTemp);
  const weather = useVehicle((s) => s.environment.weather);

  const WeatherIcon = weather === "rain" ? Rain : weather === "fog" ? Mist : isNight() ? Moon : Sun;

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-foreground">{externalTemp}°</span>
        <span className="text-muted-foreground">External temperature</span>
        <span className="pointer-events-auto ml-0.5 flex flex-col leading-[0]">
          <button
            aria-label="Raise external temperature"
            onClick={() => stepExternalTemp(1)}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronUp size={14} />
          </button>
          <button
            aria-label="Lower external temperature"
            onClick={() => stepExternalTemp(-1)}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown size={14} />
          </button>
        </span>
      </div>

      <button
        onClick={cycleWeather}
        aria-label={`Weather: ${WEATHER_LABEL[weather]}. Click to change.`}
        className="pointer-events-auto flex w-fit items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <WeatherIcon />
        <span>{WEATHER_LABEL[weather]}</span>
      </button>
    </div>
  );
}
