import type { DesktopConfigurationAction } from "@maket/shared";
import { describe, expect, it, vi } from "vitest";
import { applyDesktopOnboarding, validateOnboardingSelection } from "./configuration-install.js";
import type { RuntimeOwner } from "./workspace-controller.js";

const legacy: RuntimeOwner = {
  owner: "legacy",
  pid: 42,
  host: "127.0.0.1",
  port: 24842,
  dataDir: "/tmp/.maket",
};

function options(actions: DesktopConfigurationAction[]) {
  return {
    selection: { actions },
    owner: null as RuntimeOwner | null,
    services: {
      installAgent: vi.fn(),
      openClaudeDesktop: vi.fn().mockResolvedValue(undefined),
      takeControl: vi.fn().mockResolvedValue(undefined),
      startRuntime: vi.fn().mockResolvedValue(undefined),
      awaitClaudeDesktop: vi.fn(),
      complete: vi.fn(),
      restartApplication: vi.fn(),
    },
  };
}

describe("desktop onboarding configuration", () => {
  it("validates and de-duplicates the public selection", () => {
    expect(validateOnboardingSelection({ actions: ["codex", "codex", "runtime"] })).toEqual({
      actions: ["codex", "runtime"],
    });
    expect(() => validateOnboardingSelection({ actions: ["other"] })).toThrow("unknown action");
  });

  it("applies selected agents and completes setup", async () => {
    const setup = options(["codex", "gemini"]);

    const execution = await applyDesktopOnboarding(setup);

    expect(setup.services.installAgent.mock.calls).toEqual([["codex"], ["gemini"]]);
    expect(execution.results).toEqual([
      { action: "codex", status: "applied" },
      { action: "gemini", status: "applied" },
    ]);
    expect(setup.services.complete).toHaveBeenCalledOnce();
  });

  it("waits for Claude Desktop confirmation instead of claiming completion", async () => {
    const setup = options(["claude-desktop"]);

    const execution = await applyDesktopOnboarding(setup);

    expect(execution.results).toEqual([{ action: "claude-desktop", status: "confirmation-required" }]);
    expect(setup.services.awaitClaudeDesktop).toHaveBeenCalledOnce();
    expect(setup.services.complete).not.toHaveBeenCalled();
  });

  it("does not take over the server after an agent failure", async () => {
    const setup = options(["codex", "runtime"]);
    setup.owner = legacy;
    setup.services.installAgent.mockImplementation(() => {
      throw new Error("invalid config");
    });

    const execution = await applyDesktopOnboarding(setup);

    expect(execution.results).toEqual([{ action: "codex", status: "failed", detail: "invalid config" }]);
    expect(setup.services.takeControl).not.toHaveBeenCalled();
    expect(setup.services.restartApplication).not.toHaveBeenCalled();
  });

  it("takes control last and restarts Maket", async () => {
    const setup = options(["codex", "runtime"]);
    setup.owner = legacy;

    const execution = await applyDesktopOnboarding(setup);

    expect(setup.services.takeControl).toHaveBeenCalledWith(legacy);
    expect(setup.services.complete).toHaveBeenCalledOnce();
    expect(setup.services.restartApplication).toHaveBeenCalledOnce();
    expect(execution.restarting).toBe(true);
  });

  it("starts the embedded runtime when the previous owner has disappeared", async () => {
    const setup = options(["runtime"]);

    const execution = await applyDesktopOnboarding(setup);

    expect(setup.services.takeControl).not.toHaveBeenCalled();
    expect(setup.services.startRuntime).toHaveBeenCalledOnce();
    expect(execution.results).toEqual([{ action: "runtime", status: "applied" }]);
    expect(setup.services.complete).toHaveBeenCalledOnce();
    expect(setup.services.restartApplication).toHaveBeenCalledOnce();
    expect(execution.restarting).toBe(true);
  });
});
