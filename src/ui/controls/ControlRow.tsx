import { cn } from "@liquidai/react";
import type { ReactNode } from "react";

/**
 * A sidebar row: muted label (with optional leading icon) on the left, the control
 * on the right. When `active`, the leading icon brightens from muted to foreground —
 * the Tidal "muted unless selected" convention.
 *
 * The label sits in a fixed-width column (wide enough for the longest label) and the
 * control *fills* the rest of the row — so every control lines up at the same left
 * edge and shares the same width, at both panel sizes (500px, or 400px beside the chat).
 */
export function ControlRow({
  label,
  icon,
  active = false,
  children,
}: {
  label: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-[124px] shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium text-muted-foreground">
        {icon && (
          <span
            className={cn(
              "[&>svg]:h-[18px] [&>svg]:w-[18px]",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {icon}
          </span>
        )}
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
