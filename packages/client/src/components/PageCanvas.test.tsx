import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import * as ws from "../store/ws";
import { isTextEditable, PageCanvas, parseCSSVars } from "./PageCanvas";

// Silence PageCanvas's verbose console.log during tests.
beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
		setTimeout(() => cb(0), 0);
		return 1;
	});
});

afterEach(() => {
	cleanup();
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	useStore.setState({
		pending: [],
		editingElementId: null,
		selectedIds: [],
		showPopover: false,
	});
});

describe("PageCanvas toolbar interactions", () => {
	it("selects an element and shows the toolbar", async () => {
		render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">Editable</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		const target = document.querySelector('[data-id="a"]') as HTMLElement;
		await act(async () => {
			fireEvent.click(target);
		});
		expect(useStore.getState().selectedIds).toEqual(["a"]);
		expect(document.querySelector(".element-toolbar")).not.toBeNull();
		expect(target.classList.contains("selected")).toBe(true);
	});

	it("marks placeholders on collection-bound pages", () => {
		const doc = makeDoc('<p data-id="a">{{ client_name }}</p>');
		doc.pages[0].collection = { name: "clients" };

		render(<PageCanvas doc={doc} pageIndex={0} charteCss="" focused={true} />);

		const marker = document.querySelector("[data-collection-placeholder]");
		expect(marker?.getAttribute("data-collection-placeholder")).toBe(
			"client_name",
		);
		expect(marker?.getAttribute("data-collection-bound")).toBe("true");
	});

	it("shows comment-only toolbar for non-editable elements", async () => {
		render(
			<PageCanvas
				doc={makeDoc('<img data-id="hero" src="/assets/photo.jpg" />')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(
				document.querySelector('[data-id="hero"]') as HTMLElement,
			);
		});

		expect(document.querySelector(".tb-comment")).not.toBeNull();
		expect(document.querySelector(".tb-edit")).toBeNull();
	});

	it("dismisses the toolbar when clicking outside the canvas", async () => {
		render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">Editable</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(document.querySelector('[data-id="a"]') as HTMLElement);
		});
		expect(document.querySelector(".element-toolbar")).not.toBeNull();

		await act(async () => {
			fireEvent.click(document.body);
		});
		expect(document.querySelector(".element-toolbar")).toBeNull();
	});

	it("comment action opens the popover state for the selected element", async () => {
		render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">Editable</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(document.querySelector('[data-id="a"]') as HTMLElement);
		});
		await act(async () => {
			fireEvent.click(document.querySelector(".tb-comment") as HTMLElement);
		});

		expect(useStore.getState().showPopover).toBe(true);
		expect(useStore.getState().selectedIds).toEqual(["a"]);
	});
});

function makeDoc(html: string, marginUniform?: number): Document {
	return {
		id: "id-alpha",
		name: "alpha",
		category: "flyer",
		canvas: {
			w: 210,
			h: 297,
			background: "#fff",
			...(marginUniform != null
				? {
						margins: {
							top: marginUniform,
							right: marginUniform,
							bottom: marginUniform,
							left: marginUniform,
						},
					}
				: {}),
		},
		pages: [{ id: `${name}-page-1`, name: "p1", elements: [], html }],
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

	it("renders a margin guide only when canvas.margins is set", () => {
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
	it("starts inline editing from the toolbar for editable elements", async () => {
		render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">original</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(document.querySelector('[data-id="a"]') as HTMLElement);
		});
		await act(async () => {
			fireEvent.click(document.querySelector(".tb-edit") as HTMLElement);
		});
		await act(async () => {
			vi.runAllTimers();
		});

		expect(useStore.getState().editingElementId).toBe("a");
		expect(
			document.querySelector(".page-canvas")?.classList.contains("is-editing"),
		).toBe(true);
	});

	it("Escape cancels editing and restores the original html", async () => {
		const { container } = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">original</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(container.querySelector('[data-id="a"]') as HTMLElement);
		});
		await act(async () => {
			fireEvent.click(document.querySelector(".tb-edit") as HTMLElement);
		});
		await act(async () => {
			vi.runAllTimers();
		});
		const target = container.querySelector('[data-id="a"]') as HTMLElement;
		target.innerHTML = "<strong>mutated</strong>";

		await act(async () => {
			fireEvent.keyDown(target, { key: "Escape" });
		});

		expect(target.innerHTML).toBe("original");
		expect(useStore.getState().editingElementId).toBeNull();
	});

	it("blur with unchanged html exits edit mode without sending a patch", async () => {
		const sendTextEdit = vi.spyOn(ws, "sendTextEdit");
		const { container } = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">original</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(container.querySelector('[data-id="a"]') as HTMLElement);
		});
		await act(async () => {
			fireEvent.click(document.querySelector(".tb-edit") as HTMLElement);
		});
		await act(async () => {
			vi.runAllTimers();
		});
		const target = container.querySelector('[data-id="a"]') as HTMLElement;

		await act(async () => {
			fireEvent.blur(target);
		});

		expect(sendTextEdit).not.toHaveBeenCalled();
		expect(useStore.getState().editingElementId).toBeNull();
	});

	it("blur with changed html sends a text edit for the current doc/page/id", async () => {
		const sendTextEdit = vi
			.spyOn(ws, "sendTextEdit")
			.mockImplementation(() => {});
		const { container } = render(
			<PageCanvas
				doc={makeDoc('<p data-id="a">original</p>')}
				pageIndex={0}
				charteCss=""
				focused={true}
			/>,
		);

		await act(async () => {
			fireEvent.click(container.querySelector('[data-id="a"]') as HTMLElement);
		});
		await act(async () => {
			fireEvent.click(document.querySelector(".tb-edit") as HTMLElement);
		});
		await act(async () => {
			vi.runAllTimers();
		});
		const target = container.querySelector('[data-id="a"]') as HTMLElement;
		target.innerHTML = "<em>changed</em>";

		await act(async () => {
			fireEvent.blur(target);
		});

		expect(sendTextEdit).toHaveBeenCalledWith(
			"alpha",
			0,
			"a",
			"<em>changed</em>",
		);
		expect(useStore.getState().editingElementId).toBe("a");
	});

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
