// Floating-panel fill per Figma: a subtle top-to-bottom darkening wash over the
// sidebar background, a hairline border, small radius (shadow via `shadow-overlay`).
// Shared by the config Sidebar and the agent chat panel (same 500px slot).
export const PANEL_STYLE: React.CSSProperties = {
  borderRadius: "var(--radius)",
  border: "1px solid var(--sidebar-border)",
  background:
    "linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, var(--base-black-50, rgba(0, 0, 0, 0.03)) 100%), var(--sidebar-background)",
};
