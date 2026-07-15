import { useVehicle } from "../../state/vehicleState";
import { resolveHeadlights } from "../../state/autoResolve";
import {
  setHeadlights,
  setTaillights,
  setFoglights,
  setWiper,
  setTrunk,
  setFrunk,
} from "../../state/vehicleCommands";
import { ControlRow } from "../controls/ControlRow";
import {
  SegmentedControl,
  ON_OFF,
  AUTO_ON_OFF,
  OPEN_CLOSE,
} from "../controls/SegmentedControl";
import { Fog } from "../icons";

/** Exterior band rows: Head / Tail / Fog lights. */
export function ExteriorLightRows() {
  const headlights = useVehicle((s) => s.headlights);
  const taillights = useVehicle((s) => s.taillights);
  const foglights = useVehicle((s) => s.foglights);
  const weather = useVehicle((s) => s.environment.weather);
  // Fog lamps only work with the headlights on (resolving Auto against the weather/clock).
  const headlightsOn = resolveHeadlights(headlights, weather) === "on";

  return (
    <>
      <ControlRow label="Head lights">
        <SegmentedControl
          aria-label="Head lights"
          value={headlights}
          options={AUTO_ON_OFF}
          onChange={setHeadlights}
        />
      </ControlRow>

      <ControlRow label="Tail lights">
        <SegmentedControl
          aria-label="Tail lights"
          value={taillights}
          options={AUTO_ON_OFF}
          onChange={setTaillights}
        />
      </ControlRow>

      {/* Fog lights require the headlights on (they only cast with them) — the
          control greys out and the beam won't show while the headlights are off. */}
      <ControlRow
        label="Fog lights"
        icon={<Fog />}
        active={foglights && headlightsOn}
      >
        <SegmentedControl
          aria-label="Fog lights"
          value={foglights ? "on" : "off"}
          options={ON_OFF}
          disabled={!headlightsOn}
          onChange={(v) => setFoglights(v === "on")}
        />
      </ControlRow>
    </>
  );
}

/** Windshield wiper — its own divider-separated band (no title). */
export function WiperRow() {
  const wiper = useVehicle((s) => s.wiper);
  return (
    <ControlRow label="Windshield wiper">
      <SegmentedControl
        aria-label="Windshield wiper"
        value={wiper}
        options={AUTO_ON_OFF}
        onChange={setWiper}
      />
    </ControlRow>
  );
}

/** Trunk + Frunk — their own divider-separated band (no title). */
export function AccessRows() {
  const trunk = useVehicle((s) => s.trunk);
  const frunk = useVehicle((s) => s.frunk);
  return (
    <>
      <ControlRow label="Trunk">
        <SegmentedControl
          aria-label="Trunk"
          value={trunk ? "open" : "close"}
          options={OPEN_CLOSE}
          onChange={(v) => setTrunk(v === "open")}
        />
      </ControlRow>

      <ControlRow label="Frunk">
        <SegmentedControl
          aria-label="Frunk"
          value={frunk ? "open" : "close"}
          options={OPEN_CLOSE}
          onChange={(v) => setFrunk(v === "open")}
        />
      </ControlRow>
    </>
  );
}
