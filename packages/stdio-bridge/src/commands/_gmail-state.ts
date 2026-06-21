import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GmailPaths {
	credentialsPath: string;
	tokenPath: string;
}

export interface GmailState extends GmailPaths {
	hasCredentials: boolean;
	hasToken: boolean;
	withRead: boolean;
}

export function gmailPaths(dataDir: string): GmailPaths {
	return {
		credentialsPath: join(dataDir, "google-credentials.json"),
		tokenPath: join(dataDir, "google-token.json"),
	};
}

export function readGmailState(dataDir: string): GmailState {
	const paths = gmailPaths(dataDir);
	const hasCredentials = existsSync(paths.credentialsPath);
	let hasToken = false;
	let withRead = false;
	try {
		const parsed = JSON.parse(readFileSync(paths.tokenPath, "utf-8"));
		hasToken = true;
		withRead = parsed?.with_read === true;
	} catch {}
	return { ...paths, hasCredentials, hasToken, withRead };
}
