import { describe, expect, it } from "vitest";
import { createMaketLearnTool, learnPack } from "./learn.js";

describe("maket_learn", () => {
	it("declares the learn tool", () => {
		expect(learnPack.declaresTools).toEqual(["maket_learn"]);
	});

	it("returns agent-oriented overview with follow-up calls", async () => {
		const result = await createMaketLearnTool().handler({}, {} as never);
		const body =
			result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(body).toContain("Maket operating model");
		expect(body).toContain("maket_learn action=topics");
		expect(body).toContain("built-in Help document");
		expect(body).toContain("## Start every session");
		expect(body).toContain("## Tool map");
		expect(body).toContain("1. Read the Learn topics");
	});

	it("lists topics and reads one topic", async () => {
		const tool = createMaketLearnTool();
		const topics = await tool.handler({ action: "topics" }, {} as never);
		const html = await tool.handler(
			{ action: "topic", topic: "html" },
			{} as never,
		);
		const topicBody =
			topics.content[0]?.type === "text" ? topics.content[0].text : "";
		const htmlBody =
			html.content[0]?.type === "text" ? html.content[0].text : "";
		expect(topicBody).toContain("# Maket Learn topics");
		expect(topicBody).toContain("`html` — HTML composition");
		expect(htmlBody).toContain("data-id");
		expect(htmlBody).toContain("data-collection-marker");
		expect(htmlBody).toContain('data-maket-layout="ignore"');
		expect(htmlBody).toContain("maket_html action=patch");
		expect(htmlBody).toContain("Do not place it in `action=set`");
		expect(htmlBody).toContain("only operation in the patch request");
		expect(htmlBody).toContain("no child elements or text");
		expect(htmlBody).toContain("`data-maket-bind` elements");
		expect(htmlBody).toContain("## Authored structure");
		expect(htmlBody).toContain("```text");
	});

	it("renders every topic as structured Markdown for both audiences", async () => {
		const tool = createMaketLearnTool();
		for (const audience of ["agent", "human"] as const) {
			for (const topic of [
				"overview",
				"workflow",
				"tools",
				"html",
				"chartes",
				"diagrams",
				"collections",
				"state",
				"review",
				"install",
				"gemini",
			] as const) {
				const result = await tool.handler(
					{ action: "topic", topic, audience },
					{} as never,
				);
				const body =
					result.content[0]?.type === "text" ? result.content[0].text : "";
				expect(body).toMatch(/^# [^\n]+\n\n[^\n]/);
				expect(body).toMatch(/\n\n## [^\n]+\n\n/);
				expect(body).not.toMatch(/\n#{1,2} [^\n]+\n(?!\n)/);
				const fences = body.match(/```/g)?.length ?? 0;
				expect(fences % 2).toBe(0);
			}
		}
	});

	it("documents hierarchical category paths without inventing folders", async () => {
		const result = await createMaketLearnTool().handler(
			{ action: "topic", topic: "workflow" },
			{} as never,
		);
		const body =
			result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(body).toContain("clients/acme/proposals");
		expect(body).toContain("`maket_doc list` renders the derived hierarchy");
		expect(body).toContain("no persistent folders");
	});

	it("maps every public tool and its cross-tool safety boundaries", async () => {
		const result = await createMaketLearnTool().handler(
			{ action: "topic", topic: "tools" },
			{} as never,
		);
		const body =
			result.content[0]?.type === "text" ? result.content[0].text : "";

		for (const tool of [
			"maket_learn",
			"maket_workspace",
			"maket_doc",
			"maket_page",
			"maket_canvas",
			"maket_html",
			"maket_charte",
			"maket_mermaid",
			"maket_collection",
			"maket_state",
			"maket_image",
			"maket_preview",
			"maket_pdf",
			"maket_gmail",
		]) {
			expect(body).toContain(`| \`${tool}\` |`);
		}
		expect(body).toContain("Gmail is draft-only");
		expect(body).toContain("`context_token`");
		expect(body).toContain("neither replaces the other");
	});

	it("documents both supported charte-token paths for diagrams", async () => {
		const tool = createMaketLearnTool();
		const topics = await tool.handler({ action: "topics" }, {} as never);
		const result = await tool.handler(
			{ action: "topic", topic: "diagrams" },
			{} as never,
		);
		const topicsBody =
			topics.content[0]?.type === "text" ? topics.content[0].text : "";
		const body =
			result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(topicsBody).toContain("`diagrams` — Diagram styling");
		expect(body).toContain("## Path 1 — reusable diagram tokens");
		expect(body).toContain("## Durable diagram contract");
		expect(body).toContain("`.maket` export/import preserves");
		expect(body).toContain("Source-level `classDef`");
		expect(body).toContain('"diagram":{"bg"');
		expect(body).toContain(
			'"tokenRefs":{"bg":"color.paper","accent":"color.primary"',
		);
		expect(body).toContain("2. Document-charte tokens");
		expect(body).toContain("4. Explicit `tokenRefs`");
		expect(body).toContain("`color.background` → `color.bg`");
		expect(body).toContain('string `"true"` or `"false"`');
	});

	it("teaches an executable and recoverable living-document workflow", async () => {
		const result = await createMaketLearnTool().handler(
			{ action: "topic", topic: "state" },
			{} as never,
		);
		const body =
			result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(body).toContain("maket_state action=init");
		expect(body).toContain("does not use `expected_revision`");
		expect(body).toContain("{{#state.items}}");
		expect(body).toContain('data-id="title"');
		expect(body).toContain('data-maket-bind="state.status"');
		expect(body).toContain('type="button"');
		expect(body).toContain("no multiple");
		expect(body).toContain("data-maket-path");
		expect(body).toContain("$ref");
		expect(body).toContain("Call `maket_state action=get`");
		expect(body).toContain("Model/Template mode");
		expect(body).toContain("PDF");
		expect(body).toContain(
			"Portable .maket bundles carry the current schema and data snapshot",
		);
	});
});
