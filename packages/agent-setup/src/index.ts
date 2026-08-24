import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { McpConfigurationFinding } from "@maket/shared";

export type AgentClient = McpConfigurationFinding["client"];
export type RestartAgentClient = AgentClient;

export interface AgentSetupOptions {
  homeDir: string;
  statePath: string;
  endpoint: string;
  skillContent: string;
}

interface McpBackup {
  path: string;
  kind: "json" | "toml";
  hadFile?: boolean;
  hadEntry: boolean;
  previousEntry?: unknown;
  previousSection?: string;
}

interface SkillBackup {
  path: string;
  hadFile: boolean;
  previousContent?: string;
}

interface ClientBackup {
  mcp: McpBackup;
  skill: SkillBackup;
}

interface AgentSetupState {
  schemaVersion: 1;
  clients: Partial<Record<AgentClient, ClientBackup>>;
  restartClients: RestartAgentClient[];
}

interface ClientPaths {
  config: string;
  root: string;
  skill: string;
}

interface FileSnapshot {
  path: string;
  hadFile: boolean;
  content?: string;
}

const CLIENTS: AgentClient[] = ["claude", "codex", "gemini"];

function pathsFor(homeDir: string, client: AgentClient): ClientPaths {
  if (client === "claude") {
    return {
      config: join(homeDir, ".claude.json"),
      root: join(homeDir, ".claude"),
      skill: join(homeDir, ".claude", "skills", "maket", "SKILL.md"),
    };
  }
  if (client === "codex") {
    return {
      config: join(homeDir, ".codex", "config.toml"),
      root: join(homeDir, ".codex"),
      skill: join(homeDir, ".agents", "skills", "maket", "SKILL.md"),
    };
  }
  return {
    config: join(homeDir, ".gemini", "settings.json"),
    root: join(homeDir, ".gemini"),
    skill: join(homeDir, ".gemini", "skills", "maket", "SKILL.md"),
  };
}

function emptyState(): AgentSetupState {
  return { schemaVersion: 1, clients: {}, restartClients: [] };
}

function assertRegularTarget(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`Refusing to edit symbolic link: ${path}`);
  }
}

function atomicWrite(path: string, content: string): void {
  assertRegularTarget(path);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.maket-app-tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function captureFile(path: string): FileSnapshot {
  assertRegularTarget(path);
  const hadFile = existsSync(path);
  return {
    path,
    hadFile,
    content: hadFile ? readFileSync(path, "utf8") : undefined,
  };
}

function restoreFile(snapshot: FileSnapshot): void {
  if (snapshot.hadFile) {
    atomicWrite(snapshot.path, snapshot.content ?? "");
    return;
  }
  if (existsSync(snapshot.path)) {
    assertRegularTarget(snapshot.path);
    rmSync(snapshot.path);
  }
}

function runFileTransaction<T>(paths: string[], action: () => T): T {
  const snapshots = paths.map(captureFile);
  try {
    return action();
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const snapshot of snapshots.reverse()) {
      try {
        restoreFile(snapshot);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "Agent setup failed and rollback was incomplete");
    }
    throw error;
  }
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  assertRegularTarget(path);
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("root value must be an object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readState(path: string): AgentSetupState {
  if (!existsSync(path)) return emptyState();
  const json = readJson(path);
  if (json.schemaVersion !== 1 || json.clients === null || typeof json.clients !== "object") {
    throw new Error(`Unsupported Maket App agent setup state: ${path}`);
  }
  return {
    schemaVersion: 1,
    clients: json.clients as AgentSetupState["clients"],
    restartClients: Array.isArray(json.restartClients) ? json.restartClients.filter(isRestartAgentClient) : [],
  };
}

function writeState(path: string, state: AgentSetupState): void {
  atomicWrite(path, `${JSON.stringify(state, null, 2)}\n`);
}

function jsonServers(json: Record<string, unknown>): Record<string, unknown> {
  const current = json.mcpServers;
  if (current === undefined) {
    const servers: Record<string, unknown> = {};
    json.mcpServers = servers;
    return servers;
  }
  if (current === null || typeof current !== "object" || Array.isArray(current)) {
    throw new Error("mcpServers must be an object");
  }
  return current as Record<string, unknown>;
}

function extractMaketSection(toml: string): string | undefined {
  const lines = toml.split("\n");
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (start === -1 && /^\s*\[mcp_servers\.maket\]\s*$/.test(line)) {
      start = index;
      continue;
    }
    if (start !== -1 && /^\s*\[/.test(line)) {
      end = index;
      break;
    }
  }
  return start === -1 ? undefined : lines.slice(start, end).join("\n").replace(/\n+$/, "");
}

function stripMaketSection(toml: string): string {
  const lines = toml.split("\n");
  const output: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      inSection = /^\s*\[mcp_servers\.maket\]\s*$/.test(line);
      if (inSection) continue;
    }
    if (!inSection) output.push(line);
  }
  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n+$/, "");
}

function appendTomlSection(toml: string, section: string): string {
  const base = stripMaketSection(toml);
  return `${base}${base ? "\n\n" : ""}${section.trim()}\n`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function desiredToml(endpoint: string): string {
  return `[mcp_servers.maket]\nurl = ${tomlString(endpoint)}`;
}

function desiredJson(client: Exclude<AgentClient, "codex">, endpoint: string): Record<string, unknown> {
  return client === "claude" ? { type: "http", url: endpoint } : { httpUrl: endpoint };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sameJsonEntry(client: Exclude<AgentClient, "codex">, value: unknown, endpoint: string): boolean {
  const entry = objectValue(value);
  if (!entry) return false;
  return client === "claude" ? entry.type === "http" && entry.url === endpoint : entry.httpUrl === endpoint;
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function diagnoseSetup(options: AgentSetupOptions): McpConfigurationFinding[] {
  const state = readState(options.statePath);
  return CLIENTS.map((client) => diagnoseClient(options, client, state));
}

function installSetup(options: AgentSetupOptions, client: AgentClient): McpConfigurationFinding[] {
  const state = readState(options.statePath);
  const paths = pathsFor(options.homeDir, client);
  assertRegularTarget(paths.config);
  assertRegularTarget(paths.skill);
  runFileTransaction([paths.config, paths.skill, options.statePath], () => {
    if (!state.clients[client]) {
      state.clients[client] = {
        mcp: captureMcp(client, paths.config),
        skill: {
          path: paths.skill,
          hadFile: existsSync(paths.skill),
          previousContent: existsSync(paths.skill) ? readFileSync(paths.skill, "utf8") : undefined,
        },
      };
    }
    writeMcp(options, client, paths.config);
    atomicWrite(paths.skill, options.skillContent);
    if (!state.restartClients.includes(client)) state.restartClients.push(client);
    writeState(options.statePath, state);
  });
  return diagnoseSetup(options);
}

function uninstallSetup(options: AgentSetupOptions, client: AgentClient): McpConfigurationFinding[] {
  const state = readState(options.statePath);
  const backup = state.clients[client];
  if (!backup) return diagnoseSetup(options);
  runFileTransaction([backup.mcp.path, backup.skill.path, options.statePath], () => {
    restoreMcp(client, backup.mcp);
    restoreSkill(backup.skill);
    delete state.clients[client];
    if (!state.restartClients.includes(client)) state.restartClients.push(client);
    writeState(options.statePath, state);
  });
  return diagnoseSetup(options);
}

function diagnoseClient(
  options: AgentSetupOptions,
  client: AgentClient,
  state: AgentSetupState,
): McpConfigurationFinding {
  const paths = pathsFor(options.homeDir, client);
  const detected = existsSync(paths.root) || existsSync(paths.config) || existsSync(paths.skill);
  let mcpStatus: McpConfigurationFinding["mcpStatus"] = "missing";
  let detail = "Maket MCP is not configured.";
  try {
    if (client === "codex") {
      const section = existsSync(paths.config) ? extractMaketSection(readFileSync(paths.config, "utf8")) : undefined;
      if (section) {
        mcpStatus = section === desiredToml(options.endpoint) ? "valid" : "outdated";
        detail = mcpStatus === "valid" ? "MCP points to Maket App." : "Legacy Maket MCP entry can be migrated.";
      }
    } else {
      const json = readJson(paths.config);
      const servers = objectValue(json.mcpServers);
      const entry = servers?.maket;
      if (entry !== undefined) {
        mcpStatus = sameJsonEntry(client, entry, options.endpoint) ? "valid" : "outdated";
        detail = mcpStatus === "valid" ? "MCP points to Maket App." : "Legacy Maket MCP entry can be migrated.";
      }
    }
  } catch (error) {
    mcpStatus = "conflicting";
    detail = error instanceof Error ? error.message : String(error);
  }
  let skillStatus: McpConfigurationFinding["skillStatus"] = "missing";
  if (existsSync(paths.skill)) {
    try {
      skillStatus = hash(readFileSync(paths.skill, "utf8")) === hash(options.skillContent) ? "valid" : "outdated";
    } catch {
      skillStatus = "conflicting";
    }
  }
  const status =
    mcpStatus === "conflicting" || skillStatus === "conflicting"
      ? "conflicting"
      : mcpStatus === "valid" && skillStatus === "valid"
        ? "valid"
        : mcpStatus === "missing" && skillStatus === "missing"
          ? "missing"
          : "outdated";
  return {
    client,
    scope: "user",
    path: paths.config,
    status,
    detail,
    detected,
    managed: Boolean(state.clients[client]),
    skillPath: paths.skill,
    mcpStatus,
    skillStatus,
  };
}

function captureMcp(client: AgentClient, path: string): McpBackup {
  const hadFile = existsSync(path);
  if (client === "codex") {
    const content = hadFile ? readFileSync(path, "utf8") : "";
    const previousSection = extractMaketSection(content);
    return { path, kind: "toml", hadFile, hadEntry: previousSection !== undefined, previousSection };
  }
  const json = readJson(path);
  const servers = objectValue(json.mcpServers);
  return {
    path,
    kind: "json",
    hadFile,
    hadEntry: servers ? Object.hasOwn(servers, "maket") : false,
    previousEntry: servers?.maket,
  };
}

function writeMcp(options: AgentSetupOptions, client: AgentClient, path: string): void {
  if (client === "codex") {
    const content = existsSync(path) ? readFileSync(path, "utf8") : "";
    atomicWrite(path, appendTomlSection(content, desiredToml(options.endpoint)));
    return;
  }
  const json = readJson(path);
  jsonServers(json).maket = desiredJson(client, options.endpoint);
  atomicWrite(path, `${JSON.stringify(json, null, 2)}\n`);
}

function restoreMcp(client: AgentClient, backup: McpBackup): void {
  if (backup.kind === "toml" || client === "codex") {
    const content = existsSync(backup.path) ? readFileSync(backup.path, "utf8") : "";
    const stripped = stripMaketSection(content);
    const restored =
      backup.hadEntry && backup.previousSection
        ? `${stripped}${stripped ? "\n\n" : ""}${backup.previousSection}\n`
        : `${stripped}${stripped ? "\n" : ""}`;
    if (backup.hadFile === false && restored.trim() === "") {
      if (existsSync(backup.path)) rmSync(backup.path);
    } else {
      atomicWrite(backup.path, restored);
    }
    return;
  }
  const json = readJson(backup.path);
  const servers = jsonServers(json);
  if (backup.hadEntry) servers.maket = backup.previousEntry;
  else delete servers.maket;
  if (Object.keys(servers).length === 0) delete json.mcpServers;
  if (backup.hadFile === false && Object.keys(json).length === 0) {
    if (existsSync(backup.path)) rmSync(backup.path);
  } else {
    atomicWrite(backup.path, `${JSON.stringify(json, null, 2)}\n`);
  }
}

function restoreSkill(backup: SkillBackup): void {
  if (backup.hadFile) {
    atomicWrite(backup.path, backup.previousContent ?? "");
    return;
  }
  if (existsSync(backup.path)) rmSync(backup.path);
}

export interface AgentSetupService {
  diagnose(): McpConfigurationFinding[];
  installDetected(): McpConfigurationFinding[];
  install(client: AgentClient): McpConfigurationFinding[];
  uninstall(client: AgentClient): McpConfigurationFinding[];
  pendingRestartClients(): RestartAgentClient[];
  acknowledgeRestarts(): void;
}

export function createAgentSetupService(options: AgentSetupOptions): AgentSetupService {
  return {
    diagnose: () => diagnoseSetup(options),
    installDetected: () => {
      for (const finding of diagnoseSetup(options)) {
        if (finding.detected && (finding.status === "missing" || finding.status === "outdated")) {
          installSetup(options, finding.client);
        }
      }
      return diagnoseSetup(options);
    },
    install: (client) => installSetup(options, client),
    uninstall: (client) => uninstallSetup(options, client),
    pendingRestartClients: () => readState(options.statePath).restartClients,
    acknowledgeRestarts: () => {
      const state = readState(options.statePath);
      state.restartClients = [];
      writeState(options.statePath, state);
    },
  };
}

function isRestartAgentClient(value: unknown): value is RestartAgentClient {
  return value === "claude" || value === "codex" || value === "gemini";
}
