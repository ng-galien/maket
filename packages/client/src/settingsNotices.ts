import type { DesktopUpdateState } from "@maket/shared";
import { useEffect, useState } from "react";
import {
	configurationNoticeKeys,
	type DesktopConfigurationState,
} from "./desktopConfiguration";

const STORAGE_KEY = "maket.settings.read-notices";
interface ReadNotices {
	configuration: string[];
	update: string[];
}

/** Reading a notice changes its badge, never the underlying action. */
export function useSettingsNotices(
	open: boolean,
	update: DesktopUpdateState,
	configuration: DesktopConfigurationState,
) {
	const [read, setRead] = useState(loadReadNotices);
	const configurationKeys = JSON.stringify(
		configurationNoticeKeys(configuration.plan),
	);
	const updateKeys = JSON.stringify(
		update.status === "ready" || update.status === "error"
			? [
					JSON.stringify([
						update.status,
						update.channel,
						update.version,
						update.reason,
						update.message,
					]),
				]
			: [],
	);
	const configurationKnown =
		configuration.status === "ready" && configuration.plan !== null;
	const updateKnown =
		update.status === "ready" ||
		update.status === "error" ||
		update.status === "up-to-date";
	useEffect(() => {
		const next = {
			configuration: reconcileRead(
				read.configuration,
				JSON.parse(configurationKeys),
				open,
				configurationKnown,
			),
			update: reconcileRead(
				read.update,
				JSON.parse(updateKeys),
				open,
				updateKnown,
			),
		};
		if (JSON.stringify(next) === JSON.stringify(read)) return;
		setRead(next);
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {}
	}, [
		open,
		configurationKeys,
		updateKeys,
		configurationKnown,
		updateKnown,
		read,
	]);
	return {
		configuration:
			!open &&
			(JSON.parse(configurationKeys) as string[]).some(
				(key) => !read.configuration.includes(key),
			),
		update:
			!open &&
			(JSON.parse(updateKeys) as string[]).some(
				(key) => !read.update.includes(key),
			),
	};
}

/** Loading/checking is not evidence that an outstanding action was resolved. */
function reconcileRead(
	read: string[],
	current: string[],
	open: boolean,
	known: boolean,
): string[] {
	if (!known) return read;
	return open ? current : read.filter((key) => current.includes(key));
}

/** Missing, invalid or unavailable preferences leave actions unread. */
function loadReadNotices(): ReadNotices {
	try {
		const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
		if (
			value &&
			[value.configuration, value.update].every(
				(keys) =>
					Array.isArray(keys) && keys.every((key) => typeof key === "string"),
			)
		)
			return value;
	} catch {}
	return { configuration: [], update: [] };
}
