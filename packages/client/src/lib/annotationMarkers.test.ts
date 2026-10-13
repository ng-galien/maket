import { generateStructuredWorkspaceTemplates } from "@maket/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingMessage } from "../store/useStore";
import {
	elementBox,
	pendingAnnotationTargets,
	pendingMessageCount,
	renderedElementBox,
} from "./annotationMarkers";

function rect(x: number, y: number, width: number, height: number): DOMRect {
	return {
		x,
		y,
		width,
		height,
		left: x,
		top: y,
		right: x + width,
		bottom: y + height,
		toJSON: () => ({}),
	} as DOMRect;
}

function note(
	id: string,
	elementId: string | undefined,
	extra: Partial<PendingMessage> = {},
): PendingMessage {
	return {
		id,
		type: "note",
		docName: "Électricité",
		pageIndex: 0,
		...(elementId ? { elementId } : {}),
		text: id,
		ts: 0,
		...extra,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("pendingAnnotationTargets", () => {
	it("returns one target per anchored element of the page", () => {
		const targets = pendingAnnotationTargets(
			[
				note("title", "detail-title"),
				note("devis", "field-devis"),
				note("devis-delete", "field-devis", { type: "delete" }),
				note("page", undefined),
				note("other-doc", "field-devis", { docName: "Plomberie" }),
				note("other-page", "field-devis", { pageIndex: 1 }),
				note("drop", "field-devis", { type: "drop-image" }),
			],
			"Électricité",
			0,
		);
		expect(targets).toEqual([
			{ elementId: "detail-title", note: true, deletion: false },
			{ elementId: "field-devis", note: true, deletion: true },
		]);
	});

	it("places an anchored message without a page index on the first page", () => {
		const message = note("devis", "field-devis");
		delete message.pageIndex;
		expect(pendingAnnotationTargets([message], "Électricité", 0)).toHaveLength(
			1,
		);
		expect(pendingAnnotationTargets([message], "Électricité", 1)).toEqual([]);
	});
});

describe("pendingMessageCount", () => {
	it("counts every pending message of the document", () => {
		expect(
			pendingMessageCount(
				[
					note("title", "detail-title"),
					note("page", undefined),
					note("other", "x", { docName: "Plomberie" }),
				],
				"Électricité",
			),
		).toBe(2);
	});
});

describe("elementBox", () => {
	it("measures each generated detail row from its label and value", () => {
		const { detailHtml } = generateStructuredWorkspaceTemplates("Travaux", {
			type: "object",
			properties: {
				titre: { type: "string" },
				devis: { type: "string" },
				artisans: { type: "array", items: { type: "string" } },
			},
		});
		expect(detailHtml).toContain(".maket-detail dl>div{display:contents}");
		document.body.innerHTML = detailHtml;
		const row = document.querySelector<HTMLElement>('[data-id="field-devis"]');
		expect(row?.querySelector("dt")?.textContent).toBe("Devis");
		if (!row) throw new Error("Row missing.");
		vi.spyOn(row, "getBoundingClientRect").mockReturnValue(rect(0, 0, 0, 0));
		vi.spyOn(
			row.querySelector("dt") as HTMLElement,
			"getBoundingClientRect",
		).mockReturnValue(rect(20, 40, 50, 10));
		vi.spyOn(
			row.querySelector("dd") as HTMLElement,
			"getBoundingClientRect",
		).mockReturnValue(rect(80, 38, 100, 14));

		expect(elementBox(row)).toMatchObject({
			left: 20,
			top: 38,
			right: 180,
			bottom: 52,
			width: 160,
			height: 14,
		});
		expect(
			document.querySelector('[data-id="field-artisans"] dd span'),
		).not.toBeNull();
	});

	it("measures text placed directly in an element without a box", () => {
		document.body.innerHTML = '<div data-id="row">Plain text</div>';
		const row = document.querySelector("[data-id=row]") as HTMLElement;
		vi.spyOn(row, "getBoundingClientRect").mockReturnValue(rect(0, 0, 0, 0));
		const range = {
			selectNodeContents: vi.fn(),
			getBoundingClientRect: () => rect(5, 6, 30, 8),
		};
		vi.spyOn(document, "createRange").mockReturnValue(
			range as unknown as Range,
		);
		expect(elementBox(row)).toMatchObject({ left: 5, top: 6, width: 30 });
	});

	it("keeps the own box of an element that has one, inline included", () => {
		document.body.innerHTML =
			'<p>Before <span data-id="inline"><b>bold</b></span></p>';
		const inline = document.querySelector("[data-id=inline]") as HTMLElement;
		vi.spyOn(inline, "getBoundingClientRect").mockReturnValue(
			rect(12, 4, 26, 9),
		);
		expect(elementBox(inline)).toMatchObject({ left: 12, width: 26 });
	});

	it("falls back to the element's own box when nothing inside has one", () => {
		document.body.innerHTML = '<div data-id="empty"></div>';
		const empty = document.querySelector("[data-id=empty]") as HTMLElement;
		expect(elementBox(empty)).toMatchObject({ width: 0, height: 0 });
	});

	it("takes the box of the visible child of a flat block", () => {
		document.body.innerHTML =
			'<div data-id="wrapper"><img data-id="photo" style="position:absolute"></div>';
		const wrapper = document.querySelector("[data-id=wrapper]") as HTMLElement;
		vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(
			rect(0, 20, 200, 0),
		);
		vi.spyOn(
			document.querySelector("[data-id=photo]") as HTMLElement,
			"getBoundingClientRect",
		).mockReturnValue(rect(40, 20, 50, 30));
		expect(elementBox(wrapper)).toMatchObject({
			left: 40,
			top: 20,
			width: 50,
			height: 30,
		});
	});
});

describe("renderedElementBox", () => {
	it("is null for an element that is not rendered", () => {
		document.body.innerHTML =
			'<span data-id="hidden" style="display:none">B</span><div data-id="blank" style="display:contents">  </div>';
		expect(
			renderedElementBox(document.querySelector("[data-id=hidden]") as Element),
		).toBeNull();
		expect(
			renderedElementBox(document.querySelector("[data-id=blank]") as Element),
		).toBeNull();
	});

	it("keeps the own box of a rendered element without area", () => {
		document.body.innerHTML = '<img data-id="empty-image">';
		const image = document.querySelector(
			"[data-id=empty-image]",
		) as HTMLElement;
		vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
			rect(50, 20, 0, 0),
		);
		vi.spyOn(image, "getClientRects").mockReturnValue([
			rect(50, 20, 0, 0),
		] as unknown as DOMRectList);
		expect(renderedElementBox(image)).toMatchObject({ left: 50, top: 20 });
	});

	it("takes the box of a zero-size image inside an element without a box", () => {
		document.body.innerHTML =
			'<div data-id="row" style="display:contents"><img data-id="empty-image"></div>';
		const image = document.querySelector(
			"[data-id=empty-image]",
		) as HTMLElement;
		vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
			rect(50, 20, 0, 0),
		);
		vi.spyOn(image, "getClientRects").mockReturnValue([
			rect(50, 20, 0, 0),
		] as unknown as DOMRectList);
		expect(
			renderedElementBox(document.querySelector("[data-id=row]") as Element),
		).toMatchObject({ left: 50, top: 20, width: 0, height: 0 });
	});
});
