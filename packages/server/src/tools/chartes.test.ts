import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAssetsService } from "../services/assets.js";
import { createBus } from "../services/bus.js";
import { createSQLiteStore } from "../services/store.js";
import { chartesPack, createMaketCharteTool } from "./chartes.js";

function fixture() {
	const tmp = mkdtempSync(join(tmpdir(), "maket-chartes-"));
	const store = createSQLiteStore(":memory:");
	const bus = createBus();
	const assets = createAssetsService({ assetsDir: tmp });
	return {
		store,
		bus,
		assets,
		cleanup: () => {
			store.close();
			rmSync(tmp, { recursive: true, force: true });
		},
	};
}

const NO_EXTRA = {} as any;

describe("chartesPack — registration", () => {
	it("declares id and deps", () => {
		expect(chartesPack.id).toBe("chartes");
		expect(chartesPack.requires).toEqual(
			expect.arrayContaining(["store", "bus", "assets"]),
		);
	});
});

describe("maket_charte — action=list", () => {
	it("returns a friendly message when no chartes are stored", async () => {
		const { store, bus, assets, cleanup } = fixture();
		const tool = createMaketCharteTool({ store, bus, assets });
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		expect((res.content[0] as any).text).toMatch(/No chartes/);
		cleanup();
	});

	it("summarizes stored chartes with a color preview", async () => {
		const { store, bus, assets, cleanup } = fixture();
		store.saveCharte({
			name: "brand",
			description: "Primary",
			tokens: { color: { primary: "#ff0", bg: "#fff" } },
		});
		const tool = createMaketCharteTool({ store, bus, assets });
		const res = await tool.handler({ action: "list" }, NO_EXTRA);
		const text = (res.content[0] as any).text as string;
		expect(text).toMatch(/brand/);
		expect(text).toMatch(/primary:#ff0/);
		cleanup();
	});
});

describe("maket_charte — action=view", () => {
	it("errors when name is missing", async () => {
		const { store, bus, assets, cleanup } = fixture();
		const tool = createMaketCharteTool({ store, bus, assets });
		const res = await tool.handler({ action: "view" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when the charte does not exist", async () => {
		const { store, bus, assets, cleanup } = fixture();
		const tool = createMaketCharteTool({ store, bus, assets });
		const res = await tool.handler({ action: "view", name: "ghost" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("emits all sections (tokens, voice, rules) + context_token", async () => {
		const { store, bus, assets, cleanup } = fixture();
		store.saveCharte({
			name: "full",
			tokens: { color: { primary: "#123" }, spacing: { md: "8px" } },
			voice: { personality: ["crisp"], do: ["be clear"] },
			rules: { titles: "uppercase" },
		});
		const tool = createMaketCharteTool({ store, bus, assets });
		const res = await tool.handler({ action: "view", name: "full" }, NO_EXTRA);
		const text = (res.content[0] as any).text as string;
		expect(text).toMatch(/COLOR/);
		expect(text).toMatch(/SPACING/);
		expect(text).toMatch(/VOICE/);
		expect(text).toMatch(/RULES/);
		expect(text).toMatch(/context_token: [a-f0-9]+/);
		cleanup();
	});
});

describe("maket_charte — action=set", () => {
	it("persists a charte and emits charte:updated with CSS", async () => {
		const { store, bus, assets, cleanup } = fixture();
		const listener = vi.fn();
		bus.on("charte:updated", listener);

		const tool = createMaketCharteTool({ store, bus, assets });
		const res = await tool.handler(
			{
				action: "set",
				name: "primary",
				tokens: { color: { brand: "#112233" } },
			},
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(store.loadCharte("primary")?.tokens.color?.brand).toBe("#112233");
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({ name: "primary" }),
		);
		const css = listener.mock.calls[0]?.[0] as any;
		expect(css.css).toMatch(/--charte-color-brand: #112233/);
		cleanup();
	});

	it("errors when name is missing", async () => {
		const { store, bus, assets, cleanup } = fixture();
		const tool = createMaketCharteTool({ store, bus, assets });
		const res = await tool.handler({ action: "set" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		cleanup();
	});
});

describe("maket_charte — action=delete", () => {
	it("deletes an existing charte and emits charte:updated (empty css)", async () => {
		const { store, bus, assets, cleanup } = fixture();
		store.saveCharte({ name: "gone", tokens: {} });
		const listener = vi.fn();
		bus.on("charte:updated", listener);

		const tool = createMaketCharteTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "delete", name: "gone" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(store.loadCharte("gone")).toBeNull();
		expect(listener).toHaveBeenCalledWith({ name: "gone", css: "" });
		cleanup();
	});

	it("errors when the charte does not exist", async () => {
		const { store, bus, assets, cleanup } = fixture();
		const tool = createMaketCharteTool({ store, bus, assets });
		const res = await tool.handler(
			{ action: "delete", name: "ghost" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});
});
