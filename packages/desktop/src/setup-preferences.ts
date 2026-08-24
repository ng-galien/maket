import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface DesktopSetupData {
  schemaVersion: 1;
  completed: boolean;
  awaitingClaudeDesktop: boolean;
}

const EMPTY_SETUP: DesktopSetupData = {
  schemaVersion: 1,
  completed: false,
  awaitingClaudeDesktop: false,
};

export class DesktopSetupPreferences {
  constructor(private readonly path: string) {}

  isRequired(): boolean {
    return !this.read().completed;
  }

  isAwaitingClaudeDesktop(): boolean {
    return this.read().awaitingClaudeDesktop;
  }

  awaitClaudeDesktop(): void {
    this.write({
      ...this.read(),
      completed: false,
      awaitingClaudeDesktop: true,
    });
  }

  complete(): void {
    this.write({
      ...this.read(),
      completed: true,
      awaitingClaudeDesktop: false,
    });
  }

  private read(): DesktopSetupData {
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return EMPTY_SETUP;
      }
      const data = value as Partial<DesktopSetupData>;
      if (data.schemaVersion !== 1) return EMPTY_SETUP;
      return {
        schemaVersion: 1,
        completed: data.completed === true,
        awaitingClaudeDesktop: data.awaitingClaudeDesktop === true,
      };
    } catch {
      return EMPTY_SETUP;
    }
  }

  private write(data: DesktopSetupData): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}
