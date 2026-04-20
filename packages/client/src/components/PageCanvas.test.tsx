import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { isTextEditable, PageCanvas, parseCSSVars } from "./PageCanvas";

// Silence PageCanvas's verbose console.log during tests.
beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	useStore.setState({
		pending: [],
		editingElementId: null,
		selectedIds: [],
		showPopover: false,
	});
});

function makeDoc(html: string, textMargin?: number): Document {
	return {
		id: "id-alpha",
		name: "alpha",
		category: "flyer",
		canvas: {
			w: 210,
			h: 297,
			background: "#fff",
			...(textMargin != null ? { textMargin } : {}),
		},
		pages: [{ name: "p1", elements: [], html }],
		activePage: 0,
	};
}

describe("parseCSSVars", () => {
	it("extracts CSS custom properties into a map", () => {
		const css = `:root {
			--charte-color-primary: #ff0000;
			--charte-font-heading: 'Inter', sans-serif;
			color: red; /* ignored */
		}`;
		expect(parseCSSVars(css)).toEqual({
			"--charte-color-primary": "#ff0000",
			"--charte-font-heading": "'Inter', sans-serif",
		});
	});

	it("returns {} for empty input", () => {
		expect(parseCSSVars("")).toEqual({});
	});

	it("trims values", () => {
		expect(parseCSSVars("--x:   42px   ;")).toEqual({ "--x": "42px" });
	});
});

describe("isTextEditable", () => {
	function el(html: string): HTMLElement {
		const div = document.createElement("div");
		div.innerHTML = html;
		return div.firstElementChild as HTMLElement;
	}

	it("returns false for non-editable tags", () => {
		expect(isTextEditable(el("<img />"))).toBe(false);
		expect(isTextEditable(el("<svg></svg>"))).toBe(false);
		expect(isTextEditable(el("<iframe></iframe>"))).toBe(false);
	});

	it("returns false when data-noedit is present", () => {
		expect(isTextEditable(el('<div data-noedit="">hi</div>'))).toBe(false);
	});

	it("returns true for leaf elements carrying text", () => {
		expect(isTextEditable(el("<p>hello</p>"))).toBe(true);
	});

	it("returns false for containers whose only children are data-id elements", () => {
		const host = el(
			'<section><div data-id="a">inner</div><div data-id="b">inner</div></section>',
		);
		expect(isTextEditable(host)).toBe(false);
	});

	it("returns true when container mixes data-id children with other markup", () => {
		const host = el(
			'<section><span>mix</span><div data-id="a">inner</div></section>',
		);
		expect(isTextEditable(host)).toBe(true);
	});
});

describe("PageCanvas rendering", () => {
	it("rewrites /assets/* image sources to /assets/preview/*", () => {
		const html = `<img src="/assets/hero.jpg" data-id="h" />`;
		const { container } = render(
			<PageCanvas
				doc={makeDoc(html)}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);
		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe("/assets/preview/hero.jpg");
	});

	it("does not rewrite already-normalized preview/thumb/print paths", () => {
		const html = `
			<img src="/assets/preview/a.jpg" data-id="a" />
			<img src="/assets/thumb/b.jpg" data-id="b" />
			<img src="/assets/print/c.jpg" data-id="c" />
		`;
		const { container } = render(
			<PageCanvas
				doc={makeDoc(html)}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);
		const srcs = [...container.querySelectorAll("img")].map((i) =>
			i.getAttribute("src"),
		);
		expect(srcs).toEqual([
			"/assets/preview/a.jpg",
			"/assets/thumb/b.jpg",
			"/assets/print/c.jpg",
		]);
	});

	it("renders a margin guide only when canvas.textMargin > 0", () => {
		const noMargin = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">x</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);
		expect(noMargin.container.querySelector(".margin-guide")).toBeNull();
		noMargin.unmount();

		const withMargin = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">x</p>', 10)}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);
		expect(withMargin.container.querySelector(".margin-guide")).not.toBeNull();
	});

	it("applies charte CSS variables as inline styles on the page-canvas root", () => {
		const { container } = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">x</p>')}
				pageIndex={0}
				charteCss=":root { --charte-color-primary: #00ff00; }"
				focused={true}
			/>,
		);
		const root = container.querySelector(".page-canvas") as HTMLElement;
		expect(root.style.getPropertyValue("--charte-color-primary")).toBe(
			"#00ff00",
		);
	});
});

describe("PageCanvas pending flags", () => {
	it("adds flagged-delete / has-note classes for matching element ids", async () => {
		const html = `
			<p data-id="a">A</p>
			<p data-id="b">B</p>
			<p data-id="c">C</p>
		`;
		const { container } = render(
			<PageCanvas
				doc={makeDoc(html)}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			useStore.setState({
				pending: [
					{ id: "m1", type: "delete", elementId: "a", ts: 0 },
					{ id: "m2", type: "note", elementId: "b", ts: 0 },
				],
			});
		});

		const a = container.querySelector('[data-id="a"]') as HTMLElement;
		const b = container.querySelector('[data-id="b"]') as HTMLElement;
		const c = container.querySelector('[data-id="c"]') as HTMLElement;
		expect(a.classList.contains("flagged-delete")).toBe(true);
		expect(a.classList.contains("has-note")).toBe(false);
		expect(b.classList.contains("has-note")).toBe(true);
		expect(b.classList.contains("flagged-delete")).toBe(false);
		expect(c.classList.contains("flagged-delete")).toBe(false);
		expect(c.classList.contains("has-note")).toBe(false);
	});

	it("clears flags when the pending entry is removed", async () => {
		const html = `<p data-id="a">A</p>`;
		const { container } = render(
			<PageCanvas
				doc={makeDoc(html)}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);
		const getA = () => container.querySelector('[data-id="a"]') as HTMLElement;

		await act(async () => {
			useStore.setState({
				pending: [{ id: "m1", type: "delete", elementId: "a", ts: 0 }],
			});
		});
		expect(getA().classList.contains("flagged-delete")).toBe(true);

		await act(async () => {
			useStore.setState({ pending: [] });
		});
		expect(getA().classList.contains("flagged-delete")).toBe(false);
	});
});

describe("PageCanvas edit mode", () => {
	it("clears editingElementId when a server broadcast replaces the html", async () => {
		const doc1 = makeDoc('<p data-id="a">original</p>');
		const { rerender } = render(
			<PageCanvas doc={doc1} pageIndex={0} charteCss="" focused={true} />,
		);

		// Enter edit mode (simulating the toolbar flow without the rAF chain).
		await act(async () => {
			useStore.setState({ editingElementId: "a" });
		});
		expect(useStore.getState().editingElementId).toBe("a");

		// Server broadcast arrives with new HTML — the rawHtml-watching effect
		// must tear down edit mode.
		const doc2 = makeDoc('<p data-id="a">from server</p>');
		await act(async () => {
			rerender(
				<PageCanvas doc={doc2} pageIndex={0} charteCss="" focused={true} />,
			);
		});
		expect(useStore.getState().editingElementId).toBeNull();
	});

	it("does not clear editingElementId while rawHtml is unchanged", async () => {
		const doc1 = makeDoc('<p data-id="a">original</p>');
		const { rerender } = render(
			<PageCanvas doc={doc1} pageIndex={0} charteCss="" focused={true} />,
		);

		await act(async () => {
			useStore.setState({ editingElementId: "a" });
		});

		// Re-render with the *same* doc — no broadcast, edit mode must persist.
		await act(async () => {
			rerender(
				<PageCanvas doc={doc1} pageIndex={0} charteCss="" focused={true} />,
			);
		});
		expect(useStore.getState().editingElementId).toBe("a");
	});
});
