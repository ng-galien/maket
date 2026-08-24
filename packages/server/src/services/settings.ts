/**
 * settings — user-level panel preferences persisted in a single JSON file.
 *
 * The file is anchored to the home directory, not to DATA_DIR, so language,
 * theme, accent, and the update channel stay put when the desktop application
 * switches workspaces. Writes are atomic (temp file + rename) because the
 * Electron main process reads the same file for its update channel.
 */

import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	DEFAULT_SETTINGS,
	normalizeSettings,
	type Settings,
} from "@maket/shared";
import type { Bus } from "./bus.js";
import type { Config } from "./config.js";

export interface SettingsService {
	/** The current settings; always complete, never partial. */
	get(): Settings;
	/** Merge `partial` over the current value, persist, and emit `settings:changed`. */
	patch(partial: Partial<Settings>): Settings;
}

export interface SettingsDeps {
	config: Config;
	bus: Bus;
}

/** Read the settings file, falling back to defaults when it is absent or corrupt. */
export function readSettingsFile(path: string): Settings {
	try {
		return normalizeSettings(JSON.parse(readFileSync(path, "utf-8")));
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

/** Replace the settings file atomically so a concurrent reader never sees a partial write. */
export function writeSettingsFile(path: string, settings: Settings): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${process.pid}.settings.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
			mode: 0o600,
		});
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

function sameSettings(left: Settings, right: Settings): boolean {
	return (
		left.language === right.language &&
		left.themeMode === right.themeMode &&
		left.accentColor === right.accentColor &&
		left.autoFocusFit === right.autoFocusFit &&
		left.updateChannel === right.updateChannel
	);
}

/** Reads on every access rather than caching: the Electron main process writes
 *  updateChannel to the same file before the server exists, so an in-memory
 *  snapshot would go stale and be written back over the newer value. */
export function createSettings({ config, bus }: SettingsDeps): SettingsService {
	return {
		get() {
			return readSettingsFile(config.SETTINGS_PATH);
		},
		patch(partial) {
			const current = readSettingsFile(config.SETTINGS_PATH);
			const next = normalizeSettings({ ...current, ...partial });
			if (sameSettings(next, current)) return current;
			writeSettingsFile(config.SETTINGS_PATH, next);
			bus.emit("settings:changed", next);
			return next;
		},
	};
}
