import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createOnboardingDocument } from "./onboarding-document.js";

const ROOT = resolve(import.meta.dirname, "../../../..");
const CANONICAL_AGENT_JOURNAL_URL =
	"https://ng-galien.github.io/categories/mcp-maket/";

const productSites = [
	["English", "docs/index.html", "Agent journal", "agent-journal.svg"],
	[
		"French",
		"docs/fr/index.html",
		"Journal des agents",
		"../agent-journal.svg",
	],
] as const;

describe("agent journal public links", () => {
	it("keeps a tertiary, marked journal link in the README", () => {
		const content = readFileSync(join(ROOT, "README.md"), "utf8");
		const startMarker = `<sub><a href="${CANONICAL_AGENT_JOURNAL_URL}">`;
		const start = content.indexOf(startMarker);
		const end = content.indexOf("</sub>", start);
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		const secondaryNote = content.slice(start, end + "</sub>".length);
		const anchor = journalAnchor(secondaryNote);
		expect(anchor).toContain('src="docs/agent-journal.svg"');
		expect(anchor).toContain("Agent journal");
	});

	for (const [locale, path, linkLabel, iconPath] of productSites) {
		it(`keeps the stable, marked journal anchor in the ${locale} product site`, () => {
			const content = readFileSync(join(ROOT, path), "utf8");
			const anchor = journalAnchor(content, 'class="footer__agent-link"');
			expect(anchor).toContain(`src="${iconPath}"`);
			expect(anchor).toContain('class="agent-journal-icon"');
			expect(anchor).toContain(linkLabel);
		});
	}

	it("ships the shared agent mark with the product site", () => {
		const icon = readFileSync(join(ROOT, "docs/agent-journal.svg"), "utf8");
		expect(icon).toContain('viewBox="0 0 24 24"');
		expect(icon).toContain('stroke="#18b77a"');
	});

	it.each([
		["en", "Behind the scenes: read the agents’ journal"],
		["fr", "En coulisses : lire le journal des agents"],
	] as const)("adds the journal to the %s built-in help", (locale, label) => {
		const html = createOnboardingDocument(locale).pages[0]?.html ?? "";
		const anchor = journalAnchor(html, 'data-id="help-agent-journal"');
		expect(anchor).toContain('data-id="agent-journal-icon"');
		expect(anchor).toContain(label);
	});
});

function journalAnchor(content: string, marker = ""): string {
	const anchors = content.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
	const anchor = anchors.find(
		(candidate) =>
			candidate.includes(`href="${CANONICAL_AGENT_JOURNAL_URL}"`) &&
			candidate.includes(marker),
	);
	expect(anchor).toBeDefined();
	return anchor ?? "";
}
