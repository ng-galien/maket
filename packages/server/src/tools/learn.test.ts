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
		expect(topicBody).toContain("html: HTML composition");
		expect(htmlBody).toContain("data-id");
		expect(htmlBody).toContain("data-collection-marker");
	});

	it("teaches an executable and recoverable living-document workflow", async () => {
		const result = await createMaketLearnTool().handler(
			{ action: "topic", topic: "state" },
			{} as never,
		);
		const body =
			result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(body).toContain("maket_state action=init");
		expect(body).toContain("does not use expected_revision");
		expect(body).toContain("{{#state.items}}");
		expect(body).toContain('data-id="title"');
		expect(body).toContain('data-maket-bind="state.status"');
		expect(body).toContain('type="button"');
		expect(body).toContain("no multiple");
		expect(body).toContain("data-maket-path");
		expect(body).toContain("$ref");
		expect(body).toContain("call maket_state action=get");
		expect(body).toContain("Model/Template mode");
		expect(body).toContain("PDF");
		expect(body).toContain(
			".maket bundle export does not yet support state-backed documents",
		);
	});
});
