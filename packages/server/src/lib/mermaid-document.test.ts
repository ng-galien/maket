import { describe, expect, it } from "vitest";
import type { Charte } from "../types.js";
import {
	createMermaidDiagramSpec,
	decodeMermaidDiagramSpec,
	encodeMermaidDiagramSpec,
	mermaidSpecAttribute,
	refreshMermaidHtml,
	renderMermaidDiagram,
} from "./mermaid-document.js";

function charte(font: string, spacing = "32px"): Charte {
	return {
		name: "brand",
		tokens: {
			color: { background: "#ffffff", text: "#111827" },
			font: { body: font },
			diagram: { nodeSpacing: spacing },
		},
	};
}

describe("persistent Mermaid diagram specifications", () => {
	it("round-trips source and semantic options through a safe HTML attribute", () => {
		const spec = createMermaidDiagramSpec("graph TD\n  A-->B", {
			tokenRefs: { accent: "color.signal" },
			transparent: true,
		});
		const encoded = encodeMermaidDiagramSpec(spec);
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeMermaidDiagramSpec(encoded)).toEqual(spec);
		expect(mermaidSpecAttribute(spec)).toContain(encoded);
	});

	it("rerenders a persisted diagram after its charte changes", () => {
		const spec = createMermaidDiagramSpec("graph TD\n  A-->B", {});
		const originalSvg = renderMermaidDiagram(spec, charte("Inter", "24px"));
		const html = `<div data-id="diagram" ${mermaidSpecAttribute(spec)}>${originalSvg}</div>`;

		const refreshed = refreshMermaidHtml(html, charte("Fraunces", "80px"));

		expect(refreshed.refreshed).toBe(1);
		expect(refreshed.errors).toEqual([]);
		expect(refreshed.html).toContain("Fraunces");
		expect(refreshed.html).not.toContain("family=Inter");
		expect(refreshed.html).toContain(encodeMermaidDiagramSpec(spec));
		expect(refreshed.html).not.toBe(html);
	});

	it("ignores automatic charte density for diagram families that do not support it", () => {
		const spec = createMermaidDiagramSpec(
			"sequenceDiagram\n  Alice->>Bob: Hello",
			{},
		);
		expect(() => renderMermaidDiagram(spec, charte("Inter"))).not.toThrow();
	});

	it("keeps the last SVG when a persisted explicit token becomes invalid", () => {
		const spec = createMermaidDiagramSpec("graph TD\n  A-->B", {
			tokenRefs: { accent: "color.signal" },
		});
		const valid: Charte = {
			name: "brand",
			tokens: { color: { signal: "#ff0000" } },
		};
		const html = `<div data-id="diagram" ${mermaidSpecAttribute(spec)}>${renderMermaidDiagram(spec, valid)}</div>`;
		const refreshed = refreshMermaidHtml(html, {
			name: "brand",
			tokens: {},
		});

		expect(refreshed.refreshed).toBe(0);
		expect(refreshed.errors[0]).toMatch(/color\.signal/);
		expect(refreshed.html).toContain("<svg");
		expect(refreshed.html).toContain("#ff0000");
		expect(refreshed.html).not.toContain("var(--charte-");

		const detached = refreshMermaidHtml(html, null);
		expect(detached.refreshed).toBe(0);
		expect(detached.errors[0]).toMatch(/require a charte/);
		expect(detached.html).toContain("#ff0000");
		expect(detached.html).not.toContain("var(--charte-");
	});
});
