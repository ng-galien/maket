import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { morphHtml } from "./morph-html";

function container(html: string): HTMLDivElement {
	const element = document.createElement("div");
	element.innerHTML = html;
	return element;
}

describe("morphHtml", () => {
	it("preserves ordinary attributes, including colon names, over successive updates", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.dictionary(
						fc.constantFrom("title", "lang", "data:label", "xml:lang", "xmlns"),
						fc.string({ maxLength: 24 }),
					),
					{ minLength: 1, maxLength: 6 },
				),
				(updates) => {
					const root = container('<p data-id="stable">Text</p>');
					const element = root.firstElementChild;
					for (const attributes of updates) {
						const next = document.createElement("p");
						next.dataset.id = "stable";
						next.textContent = "Text";
						for (const [name, value] of Object.entries(attributes))
							next.setAttribute(name, value);
						// Parsing the target independently is the DOM contract, not an
						// expectation about the morph implementation.
						const target = container(next.outerHTML);
						morphHtml(root, next.outerHTML);
						expect(root.firstElementChild).toBe(element);
						expect(root.isEqualNode(target)).toBe(true);
					}
				},
			),
			{ numRuns: 200 },
		);
	});

	it("retains SVG attributes in their real namespaces across updates", () => {
		fc.assert(
			fc.property(
				fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
				(ids) => {
					const root = container('<svg><use data-id="icon"/></svg>');
					const icon = root.querySelector("use");
					for (const id of ids) {
						morphHtml(
							root,
							`<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use data-id="icon" xlink:href="#${id}"/></svg>`,
						);
						expect(root.querySelector("use")).toBe(icon);
						expect(
							icon?.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
						).toBe(`#${id}`);
						expect(
							root
								.querySelector("svg")
								?.getAttributeNS("http://www.w3.org/2000/xmlns/", "xlink"),
						).toBe("http://www.w3.org/1999/xlink");
					}
					morphHtml(root, '<svg><use data-id="icon"/></svg>');
					expect(
						icon?.hasAttributeNS("http://www.w3.org/1999/xlink", "href"),
					).toBe(false);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("reorders keyed elements without recreating them and drops removed ones", () => {
		const root = container(
			'<ul><li data-id="a">A</li><li data-id="b">B</li><li data-id="c">C</li></ul>',
		);
		const [a, b] = [...root.querySelectorAll("li")];
		morphHtml(
			root,
			'<ul><li data-id="b" class="x">B2</li><li data-id="a">A</li></ul>',
		);
		const items = [...root.querySelectorAll("li")];
		expect(items).toEqual([b, a]);
		expect(b?.className).toBe("x");
		expect(b?.textContent).toBe("B2");
		expect(root.innerHTML).toBe(
			'<ul><li data-id="b" class="x">B2</li><li data-id="a">A</li></ul>',
		);
	});

	it("replaces an element whose tag changes and keeps SVG namespaces", () => {
		const root = container("<p>old</p>");
		morphHtml(root, '<svg viewBox="0 0 10 10"><circle r="2"/></svg>');
		const circle = root.querySelector("circle");
		expect(root.querySelector("p")).toBeNull();
		expect(circle?.namespaceURI).toBe("http://www.w3.org/2000/svg");
		morphHtml(root, '<svg viewBox="0 0 10 10"><circle r="4"/></svg>');
		expect(root.querySelector("circle")).toBe(circle);
		expect(circle?.getAttribute("r")).toBe("4");
	});

	it("keeps the value of a focused text input while syncing others", () => {
		const root = container(
			'<input data-id="focused" value="a"><input data-id="idle" value="a">',
		);
		document.body.append(root);
		const [focused, idle] = [...root.querySelectorAll("input")];
		focused?.focus();
		if (focused) focused.value = "typing";
		if (idle) idle.value = "stale";
		morphHtml(
			root,
			'<input data-id="focused" value="b"><input data-id="idle" value="b">',
		);
		expect(focused?.value).toBe("typing");
		expect(idle?.value).toBe("b");
		root.remove();
	});
});
