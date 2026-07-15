import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// Segmented control matching the Tidal Tabs look (track --muted / 10px, active thumb
// neutral-700 / 8px, text-sm) but with a single sliding thumb that animates between
// options instead of a per-button cross-fade.

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Fill the row width (default true — matches the sidebar layout). */
  stretch?: boolean;
  /** Greyed + non-interactive (e.g. Fog lights while headlights are off). */
  disabled?: boolean;
  "aria-label"?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  stretch = true,
  disabled = false,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef(new Map<string, HTMLButtonElement>());
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  // Position the sliding thumb over the active option (re-measured on value/size change).
  useLayoutEffect(() => {
    const measure = () => {
      const el = btnRefs.current.get(value);
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (trackRef.current) ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, [value, options.length, stretch]);

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={ariaLabel}
      className={`relative flex items-center gap-0.5 rounded-[10px] bg-[color:var(--muted)] p-0.5 ${
        stretch ? "w-full" : "inline-flex"
      } ${disabled ? "pointer-events-none opacity-40" : ""}`}
    >
      {thumb && (
        <span
          aria-hidden
          className="absolute bottom-0.5 top-0.5 left-0 z-0 rounded-[8px] bg-neutral-700 transition-[transform,width] duration-200 ease-out"
          style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            ref={(el) => {
              if (el) btnRefs.current.set(o.value, el);
              else btnRefs.current.delete(o.value);
            }}
            onClick={() => !disabled && onChange(o.value)}
            className={`relative z-10 flex h-8 items-center justify-center whitespace-nowrap rounded-[8px] px-2.5 text-sm font-medium transition-colors ${
              stretch ? "flex-1" : ""
            } ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Shared option sets.
export const ON_OFF: SegmentedOption<"on" | "off">[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

export const AUTO_ON_OFF: SegmentedOption<"auto" | "on" | "off">[] = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

export const OPEN_CLOSE: SegmentedOption<"open" | "close">[] = [
  { value: "open", label: "Open" },
  { value: "close", label: "Close" },
];
