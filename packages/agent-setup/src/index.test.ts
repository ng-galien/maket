import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentClient, createAgentSetupService } from "./index.ts";

const roots: string[] = [];
const endpoint = "http://127.0.0.1:24843/mcp";
const skillContent = "---\nname: maket\n---\n\nUse maket_learn first.\n";

function fixture() {
  const homeDir = mkdtempSync(join(tmpdir(), "maket-agent-setup-"));
  roots.push(homeDir);
  return {
    homeDir,
    service: createAgentSetupService({
      homeDir,
      statePath: join(homeDir, ".maket-app", "agent-setup.json"),
      endpoint,
      skillContent,
    }),
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AgentSetupService", () => {
  it("leaves no temporary file behind and keeps the destination permissions", () => {
    const { homeDir, service } = fixture();
    const path = join(homeDir, ".claude.json");
    writeFileSync(path, `${JSON.stringify({ projects: { a: { history: [] } } }, null, 2)}\n`, {
      mode: 0o644,
    });
    chmodSync(path, 0o644);

    service.install("claude");

    expect(readdirSync(homeDir).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    expect(statSync(path).mode & 0o777).toBe(0o644);
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.mcpServers.maket).toEqual({ type: "http", url: endpoint });
    expect(written.projects).toEqual({ a: { history: [] } });
  });

  it("creates a new agent configuration owner-only", () => {
    const { homeDir, service } = fixture();

    service.install("gemini");

    expect(statSync(join(homeDir, ".gemini", "settings.json")).mode & 0o777).toBe(0o600);
  });

  it.each<[AgentClient, string, Record<string, unknown>]>([
    ["claude", ".claude.json", { type: "http", url: endpoint }],
    ["gemini", ".gemini/settings.json", { httpUrl: endpoint }],
  ])("migrates and restores the %s JSON entry", (client, relativePath, expected) => {
    const { homeDir, service } = fixture();
    const path = join(homeDir, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    const previous = { command: "maket", args: ["mcp", "stdio"] };
    writeFileSync(
      path,
      `${JSON.stringify({ keep: true, mcpServers: { maket: previous, other: { command: "other" } } }, null, 2)}\n`,
    );

    service.install(client);
    const installed = JSON.parse(readFileSync(path, "utf8"));
    expect(installed.mcpServers.maket).toEqual(expected);
    expect(installed.mcpServers.other).toEqual({ command: "other" });
    expect(service.diagnose().find((item) => item.client === client)).toMatchObject({
      status: "valid",
      managed: true,
    });

    service.uninstall(client);
    const restored = JSON.parse(readFileSync(path, "utf8"));
    expect(restored).toEqual({ keep: true, mcpServers: { maket: previous, other: { command: "other" } } });
  });

  it("migrates and restores the Codex TOML section without touching other settings", () => {
    const { homeDir, service } = fixture();
    const path = join(homeDir, ".codex", "config.toml");
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    const previous = [
      'model = "gpt-5"',
      "",
      "[mcp_servers.maket]",
      'command = "maket"',
      'args = ["mcp", "stdio"]',
      "",
      "[mcp_servers.other]",
      'command = "other"',
      "",
    ].join("\n");
    writeFileSync(path, previous);

    service.install("codex");
    const installed = readFileSync(path, "utf8");
    expect(installed).toContain(`[mcp_servers.maket]\nurl = ${JSON.stringify(endpoint)}`);
    expect(installed).toContain("[mcp_servers.other]");

    service.uninstall("codex");
    const restored = readFileSync(path, "utf8");
    expect(restored).toContain('[mcp_servers.maket]\ncommand = "maket"\nargs = ["mcp", "stdio"]');
    expect(restored).toContain("[mcp_servers.other]");
  });

  it("installs only clients detected on startup", () => {
    const { homeDir, service } = fixture();
    mkdirSync(join(homeDir, ".codex"), { recursive: true });

    const findings = service.installDetected();
    expect(findings.find((item) => item.client === "codex")).toMatchObject({ status: "valid" });
    expect(findings.find((item) => item.client === "claude")).toMatchObject({ status: "missing" });
    expect(findings.find((item) => item.client === "gemini")).toMatchObject({ status: "missing" });
    expect(service.pendingRestartClients()).toEqual(["codex"]);
  });

  it.each<[AgentClient, string]>([
    ["claude", ".claude.json"],
    ["codex", ".codex/config.toml"],
    ["gemini", ".gemini/settings.json"],
  ])("restores the original absence of the %s configuration", (client, relativePath) => {
    const { homeDir, service } = fixture();
    const path = join(homeDir, relativePath);

    service.install(client);
    expect(existsSync(path)).toBe(true);
    service.uninstall(client);

    expect(existsSync(path)).toBe(false);
  });

  it("rolls back configuration and state when skill installation fails", () => {
    const { homeDir, service } = fixture();
    const configPath = join(homeDir, ".codex", "config.toml");
    const statePath = join(homeDir, ".maket-app", "agent-setup.json");
    mkdirSync(join(homeDir, ".agents", "skills"), { recursive: true });
    writeFileSync(join(homeDir, ".agents", "skills", "maket"), "blocks the skill directory");

    expect(() => service.install("codex")).toThrow();
    expect(existsSync(configPath)).toBe(false);
    expect(existsSync(statePath)).toBe(false);
  });

  it("rolls back an uninstall when a later restoration step fails", () => {
    const { homeDir, service } = fixture();
    const configPath = join(homeDir, ".codex", "config.toml");
    const skillDir = join(homeDir, ".agents", "skills", "maket");
    const skillPath = join(skillDir, "SKILL.md");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, "original skill\n");
    service.install("codex");
    const managedConfig = readFileSync(configPath, "utf8");
    rmSync(skillDir, { recursive: true });
    writeFileSync(skillDir, "blocks skill restoration");

    expect(() => service.uninstall("codex")).toThrow();

    expect(readFileSync(configPath, "utf8")).toBe(managedConfig);
    expect(service.diagnose().find((finding) => finding.client === "codex")).toMatchObject({
      managed: true,
      mcpStatus: "valid",
    });
  });

  it("refuses invalid existing configuration instead of overwriting it", () => {
    const { homeDir, service } = fixture();
    writeFileSync(join(homeDir, ".claude.json"), "not json\n");

    expect(() => service.install("claude")).toThrow(/Invalid JSON/);
    expect(readFileSync(join(homeDir, ".claude.json"), "utf8")).toBe("not json\n");
  });
});
