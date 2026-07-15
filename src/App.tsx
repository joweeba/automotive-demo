import { useEffect } from "react";
import { AppShell } from "./ui/AppShell";
import { installAgentRuntime } from "./agent/agentRuntime";

export default function App() {
  // Expose the window.LiquidCar bridge the LLM assistant hooks into (see AGENT_TOOLBOX.md).
  useEffect(() => {
    installAgentRuntime();
  }, []);

  return <AppShell />;
}
