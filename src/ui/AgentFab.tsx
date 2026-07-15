import { openChat } from "../agent/agentStore";

/**
 * Liquid-agent launcher — round button with the Liquid logomark. Opens the chat
 * panel (which replaces the config sidebar while open).
 */
export function AgentFab() {
  return (
    <button
      type="button"
      onClick={openChat}
      aria-label="Open Liquid agent"
      className="flex h-14 w-14 items-center justify-center rounded-full border border-neutral-600 bg-neutral-700 shadow-overlay transition hover:brightness-110"
    >
      <img
        src="/brand/liquid-logomark-white.png"
        alt=""
        className="h-6 w-6 object-contain"
      />
    </button>
  );
}
