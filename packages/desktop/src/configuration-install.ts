import type {
  DesktopConfigurationAction,
  DesktopOnboardingActionResult,
  DesktopOnboardingSelection,
} from "@maket/shared";
import type { RuntimeOwner } from "./workspace-controller.js";

type AgentAction = "claude" | "codex" | "gemini";

interface DesktopOnboardingServices {
  installAgent: (client: AgentAction) => void;
  openClaudeDesktop: () => Promise<void>;
  takeControl: (owner: RuntimeOwner) => Promise<void>;
  startRuntime: () => Promise<void>;
  awaitClaudeDesktop: () => void;
  complete: () => void;
  restartApplication: () => void;
}

interface DesktopOnboardingOptions {
  selection: DesktopOnboardingSelection;
  owner: RuntimeOwner | null;
  services: DesktopOnboardingServices;
}

export interface DesktopOnboardingExecution {
  results: DesktopOnboardingActionResult[];
  restarting: boolean;
}

const AGENT_ACTIONS = new Set<DesktopConfigurationAction>(["claude", "codex", "gemini"]);

export function validateOnboardingSelection(value: unknown): DesktopOnboardingSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Desktop onboarding selection must be an object");
  }
  const actions = (value as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) {
    throw new TypeError("Desktop onboarding actions must be an array");
  }
  const valid = new Set<DesktopConfigurationAction>(["runtime", "claude", "codex", "gemini", "claude-desktop"]);
  if (actions.some((action) => typeof action !== "string" || !valid.has(action as never))) {
    throw new TypeError("Desktop onboarding contains an unknown action");
  }
  return {
    actions: [...new Set(actions as DesktopConfigurationAction[])],
  };
}

export async function applyDesktopOnboarding({
  selection,
  owner,
  services,
}: DesktopOnboardingOptions): Promise<DesktopOnboardingExecution> {
  const results = installSelectedAgents(selection.actions, services);
  await installClaudeDesktop(selection.actions, services, results);
  if (results.some((result) => result.status === "failed")) {
    return { results, restarting: false };
  }
  if (selection.actions.includes("runtime")) {
    if (!(await activateRuntime(owner, services, results))) {
      return { results, restarting: false };
    }
  }
  const awaitsClaude = results.some((result) => result.status === "confirmation-required");
  if (!awaitsClaude) services.complete();
  if (selection.actions.includes("runtime")) {
    services.restartApplication();
    return { results, restarting: true };
  }
  return { results, restarting: false };
}

function installSelectedAgents(
  actions: DesktopConfigurationAction[],
  services: DesktopOnboardingServices,
): DesktopOnboardingActionResult[] {
  const results: DesktopOnboardingActionResult[] = [];
  for (const action of actions) {
    if (!AGENT_ACTIONS.has(action)) continue;
    try {
      services.installAgent(action as AgentAction);
      results.push({ action, status: "applied" });
    } catch (error) {
      results.push({ action, status: "failed", detail: errorMessage(error) });
    }
  }
  return results;
}

async function installClaudeDesktop(
  actions: DesktopConfigurationAction[],
  services: DesktopOnboardingServices,
  results: DesktopOnboardingActionResult[],
): Promise<void> {
  if (!actions.includes("claude-desktop")) return;
  try {
    await services.openClaudeDesktop();
    services.awaitClaudeDesktop();
    results.push({ action: "claude-desktop", status: "confirmation-required" });
  } catch (error) {
    results.push({
      action: "claude-desktop",
      status: "failed",
      detail: errorMessage(error),
    });
  }
}

async function activateRuntime(
  owner: RuntimeOwner | null,
  services: DesktopOnboardingServices,
  results: DesktopOnboardingActionResult[],
): Promise<boolean> {
  try {
    if (owner) await services.takeControl(owner);
    else await services.startRuntime();
    results.push({ action: "runtime", status: "applied" });
    return true;
  } catch (error) {
    results.push({
      action: "runtime",
      status: "failed",
      detail: errorMessage(error),
    });
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
