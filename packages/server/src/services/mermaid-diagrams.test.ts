import { describe, expect, it } from "vitest";
import {
	createMermaidDiagramSpec,
	mermaidSpecAttribute,
	renderMermaidDiagram,
} from "../lib/mermaid-document.js";
import { createDocument } from "../types.js";
import { createDocuments } from "./documents.js";
import { createMermaidDiagrams } from "./mermaid-diagrams.js";
import { createSQLiteStore } from "./store.js";

describe("MermaidDiagrams", () => {
	it("refreshes and persists every diagram attached to an updated charte", () => {
		const store = createSQLiteStore(":memory:");
		store.saveCharte({
			name: "brand",
			tokens: { font: { body: "Inter" } },
		});
		const spec = createMermaidDiagramSpec("graph TD\n  A-->B", {});
		const oldCharte = store.loadCharte("brand");
		if (!oldCharte) throw new Error("Missing test charte");
		const doc = createDocument({
			name: "doc",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			meta: { charte: "brand" },
			pages: [
				{
					elements: [],
					html: `<div data-id="diagram" ${mermaidSpecAttribute(spec)}>${renderMermaidDiagram(spec, oldCharte)}</div>`,
				},
			],
		});
		store.saveDoc(doc);
		const documents = createDocuments({ store });
		documents.loadAll();
		store.saveCharte({
			name: "brand",
			tokens: { font: { body: "Fraunces" } },
		});

		const result = createMermaidDiagrams({ documents }).refreshCharte("brand");

		expect(result).toEqual({ docNames: ["doc"], errors: [] });
		expect(store.loadOne("doc")?.pages[0]?.html).toContain("Fraunces");
		store.close();
	});

	it("rerenders one document when its attached charte changes or is detached", () => {
		const store = createSQLiteStore(":memory:");
		store.saveCharte({
			name: "brand",
			tokens: { font: { body: "Fraunces" } },
		});
		const spec = createMermaidDiagramSpec("graph TD\n  A-->B", {});
		const doc = createDocument({
			name: "doc",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [
				{
					elements: [],
					html: `<div data-id="diagram" ${mermaidSpecAttribute(spec)}>${renderMermaidDiagram(spec, null)}</div>`,
				},
			],
		});
		store.saveDoc(doc);
		const documents = createDocuments({ store });
		documents.loadAll();
		const diagrams = createMermaidDiagrams({ documents });

		const loaded = documents.resolve("doc");
		if (!loaded) throw new Error("Missing test document");
		loaded.meta.charte = "brand";
		expect(diagrams.refreshDocument("doc").docNames).toEqual(["doc"]);
		expect(store.loadOne("doc")?.pages[0]?.html).toContain("Fraunces");

		loaded.meta.charte = undefined;
		expect(diagrams.refreshDocument("doc").docNames).toEqual(["doc"]);
		expect(store.loadOne("doc")?.pages[0]?.html).not.toContain("Fraunces");
		store.close();
	});
});
