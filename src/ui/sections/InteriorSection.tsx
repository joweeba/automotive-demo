import { useVehicle } from "../../state/vehicleState";
import type { Climate } from "../../state/vehicleState";
import { setClimate, setFan, setRecirculation } from "../../state/vehicleCommands";
import { ControlRow } from "../controls/ControlRow";
import {
  SegmentedControl,
  ON_OFF,
  type SegmentedOption,
} from "../controls/SegmentedControl";
import { TemperatureStepper } from "../controls/TemperatureStepper";
import { SeatHeaterControl } from "../controls/SeatHeaterControl";
import { Fan, Recirculate } from "../icons";

const CLIMATE_OPTS: SegmentedOption<Climate>[] = [
  { value: "off", label: "Off" },
  { value: "auto", label: "Auto" },
  { value: "ac", label: "AC" },
  { value: "heat", label: "Heat" },
];

/** Interior band rows (Climate, Temperature, Fan, Re-circulation, Seat heater). */
export function InteriorSection() {
  const climate = useVehicle((s) => s.climate);
  const fan = useVehicle((s) => s.fan);
  const recirculation = useVehicle((s) => s.recirculation);

  return (
    <>
      <ControlRow label="Climate control">
        <SegmentedControl
          aria-label="Climate control"
          value={climate}
          options={CLIMATE_OPTS}
          onChange={setClimate}
        />
      </ControlRow>

      <ControlRow label="Internal temperature">
        <TemperatureStepper />
      </ControlRow>

      <ControlRow label="Fan" icon={<Fan />} active={fan}>
        <SegmentedControl
          aria-label="Fan"
          value={fan ? "on" : "off"}
          options={ON_OFF}
          onChange={(v) => setFan(v === "on")}
        />
      </ControlRow>

      <ControlRow label="Re-circulation" icon={<Recirculate />} active={recirculation}>
        <SegmentedControl
          aria-label="Re-circulation"
          value={recirculation ? "on" : "off"}
          options={ON_OFF}
          onChange={(v) => setRecirculation(v === "on")}
        />
      </ControlRow>

      <ControlRow label="Seat heater">
        <SeatHeaterControl />
      </ControlRow>
    </>
  );
}
