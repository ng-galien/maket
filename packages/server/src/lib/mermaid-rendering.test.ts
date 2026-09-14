import { describe, expect, it } from "vitest";
import type { Charte } from "../types.js";
import {
	buildMermaidRenderOptions,
	normalizeMermaidSource,
	validateMermaidDensitySupport,
	validateMermaidSourcePolicy,
} from "./mermaid-rendering.js";

const charte: Charte = {
	name: "brand",
	tokens: {
		color: {
			background: "#ffffff",
			text: "rgb(17, 24, 39)",
			primary: "#7c3aed",
			paper: "#fffdf5",
		},
		font: { body: "Source Sans 3" },
		spacing: { airy: "72px" },
		diagram: {
			border: "oklch(65% 0.1 250)",
			nodeSpacing: "36px",
			transparent: "true",
		},
	},
};

describe("buildMermaidRenderOptions", () => {
	it("returns renderer defaults when no charte or override applies", () => {
		expect(buildMermaidRenderOptions({}, {}, null)).toBeUndefined();
	});

	it("resolves documented charte fallbacks without guessing arbitrary tokens", () => {
		expect(buildMermaidRenderOptions({}, {}, charte)).toEqual({
			bg: "#ffffff",
			fg: "rgb(17, 24, 39)",
			accent: "#7c3aed",
			border: "oklch(65% 0.1 250)",
			font: "Source Sans 3",
			nodeSpacing: 36,
			transparent: true,
		});

		const arbitraryOnly: Charte = {
			name: "arbitrary",
			tokens: { color: { first: "#ff0000" } },
		};
		expect(buildMermaidRenderOptions({}, {}, arbitraryOnly)).toBeUndefined();
	});

	it("applies profile, explicit token, then direct-value precedence", () => {
		expect(
			buildMermaidRenderOptions(
				{
					theme: "profile",
					tokenRefs: { bg: "color.paper", layerSpacing: "spacing.airy" },
					bg: "hsl(220 80% 50%)",
					font: "Inter, sans-serif",
					padding: 24,
					transparent: false,
				},
				{ profile: { bg: "#000000", fg: "#eeeeee" } },
				charte,
			),
		).toMatchObject({
			bg: "hsl(220 80% 50%)",
			fg: "#eeeeee",
			layerSpacing: 72,
			font: "Inter",
			padding: 24,
			transparent: false,
		});
	});

	it.each([
		[
			"detached token",
			() =>
				buildMermaidRenderOptions(
					{ tokenRefs: { bg: "color.paper" } },
					{},
					null,
				),
		],
		[
			"invalid reference",
			() =>
				buildMermaidRenderOptions(
					{ tokenRefs: { bg: "color paper" } },
					{},
					charte,
				),
		],
		[
			"missing token",
			() =>
				buildMermaidRenderOptions(
					{ tokenRefs: { bg: "color.missing" } },
					{},
					charte,
				),
		],
		[
			"active colour",
			() =>
				buildMermaidRenderOptions(
					{ bg: "red; background:url(https://example.test)" },
					{},
					null,
				),
		],
		[
			"raw charte CSS variable",
			() =>
				buildMermaidRenderOptions(
					{ bg: "var(--charte-color-primary)" },
					{},
					null,
				),
		],
		[
			"active font",
			() =>
				buildMermaidRenderOptions(
					{ font: "Inter';}</style><script>" },
					{},
					null,
				),
		],
		[
			"invalid density token",
			() => {
				const invalid = {
					...charte,
					tokens: { diagram: { padding: "20mm" } },
				};
				return buildMermaidRenderOptions(
					{ tokenRefs: { padding: "diagram.padding" } },
					{},
					invalid,
				);
			},
		],
		[
			"invalid boolean token",
			() => {
				const invalid = {
					...charte,
					tokens: { diagram: { transparent: "yes" } },
				};
				return buildMermaidRenderOptions(
					{ tokenRefs: { transparent: "diagram.transparent" } },
					{},
					invalid,
				);
			},
		],
	])("rejects %s values", (_name, action) => {
		expect(action).toThrow();
	});

	it("keeps automatic fallback compatible with general charte values", () => {
		const compatible: Charte = {
			name: "legacy",
			tokens: {
				color: { primary: "rebeccapurple", background: "url(evil)" },
				font: { body: '"Source Sans 3", sans-serif' },
			},
		};
		expect(buildMermaidRenderOptions({}, {}, compatible)).toEqual({
			accent: "rebeccapurple",
			font: "Source Sans 3",
		});
	});

	it("continues to the next automatic fallback after an incompatible legacy token", () => {
		const compatible: Charte = {
			name: "legacy",
			tokens: {
				diagram: { bg: "url(evil)" },
				color: { background: "#ffffff" },
			},
		};
		expect(buildMermaidRenderOptions({}, {}, compatible)).toEqual({
			bg: "#ffffff",
		});
	});
});

describe("Mermaid public-policy validation", () => {
	it("rejects source-level styling directives", () => {
		expect(() =>
			validateMermaidSourcePolicy("graph TD; A-->B; classDef risky fill:#f00"),
		).toThrow(/styling directives/);
	});

	it("allows density only where the renderer consumes it", () => {
		expect(() =>
			validateMermaidDensitySupport("graph TD\n  A-->B", { nodeSpacing: 32 }),
		).not.toThrow();
		expect(() =>
			validateMermaidDensitySupport("sequenceDiagram\n  A->>B: Hi", {
				nodeSpacing: 32,
			}),
		).toThrow(/flowchart and state/);
		expect(() =>
			validateMermaidDensitySupport("sequenceDiagram\n  A->>B: Hi", {
				tokenRefs: { nodeSpacing: "diagram.nodeSpacing" },
			}),
		).toThrow(/flowchart and state/);
	});
});

describe("normalizeMermaidSource", () => {
	it("separates compact flowchart edges without changing their meaning", () => {
		expect(normalizeMermaidSource("graph TD\n  A-->B-->C")).toBe(
			"graph TD\n  A -->B -->C",
		);
		expect(normalizeMermaidSource("flowchart LR; foo-bar-.->baz")).toBe(
			"flowchart LR; foo-bar -.->baz",
		);
	});

	it("does not rewrite arrow-like text inside labels, quotes, or comments", () => {
		expect(
			normalizeMermaidSource(
				'graph TD\n  A[keep-->label]-->B\n  C["quoted-->label"]-->D\n  %% E-->F',
			),
		).toBe(
			'graph TD\n  A[keep-->label] -->B\n  C["quoted-->label"] -->D\n  %% E-->F',
		);
	});

	it("leaves non-flowchart Mermaid sources untouched", () => {
		const sequence = "sequenceDiagram\n  Alice->>Bob: Hello";
		expect(normalizeMermaidSource(sequence)).toBe(sequence);
	});
});
