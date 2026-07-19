import { Badge } from "@liquidai/react";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { useBrand } from "../brands/brandStore";

/** Top-left overlay: app title + the active vehicle (brand label + wake word) + the
 *  environment display (external temp + weather) that drives every Auto setting. The
 *  vehicle line is brand-config driven (BMW vs Mercedes), so a multi-brand demo shows
 *  which cabin the emulator stream is rendering. */
export function Header() {
  const brand = useBrand();
  return (
    <div className="pointer-events-none absolute left-6 top-5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-base font-medium text-foreground">
          AI Automotive Assistance
        </span>
        <Badge variant="secondary">Demo</Badge>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{brand.label}</span>
        <span aria-hidden>·</span>
        <span className="italic">“{brand.wakeWord}”</span>
      </div>
      <EnvironmentPanel />
    </div>
  );
}
