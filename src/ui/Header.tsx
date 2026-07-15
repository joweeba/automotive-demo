import { Badge } from "@liquidai/react";
import { EnvironmentPanel } from "./EnvironmentPanel";

/** Top-left overlay: app title + the environment display (external temp + weather)
 *  that drives every Auto setting. */
export function Header() {
  return (
    <div className="pointer-events-none absolute left-6 top-5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-base font-medium text-foreground">
          AI Automotive Assistance
        </span>
        <Badge variant="secondary">Demo</Badge>
      </div>
      <EnvironmentPanel />
    </div>
  );
}
