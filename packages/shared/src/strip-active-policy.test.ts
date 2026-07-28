import { describe, expect, it } from "vitest";
import {
	isForbiddenUrlValue,
	type ScrubbableElement,
	scrubActiveAttributes,
} from "./strip-active-policy.js";

function fakeElement(attrs: Record<string, string>): {
	el: ScrubbableElement;
	removed: string[];
} {
	const removed: string[] = [];
	const el: ScrubbableElement = {
		attributes: Object.entries(attrs).map(([name, value]) => ({
			name,
			value,
		})),
		removeAttribute: (name) => removed.push(name),
	};
	return { el, removed };
}

describe("isForbiddenUrlValue", () => {
	it("blocks executable schemes, case/whitespace-insensitively", () => {
		expect(isForbiddenUrlValue("javascript:alert(1)")).toBe(true);
		expect(isForbiddenUrlValue("  JAVASCRIPT:alert(1)")).toBe(true);
		expect(isForbiddenUrlValue("vbscript:x")).toBe(true);
		expect(isForbiddenUrlValue("data:text/html,<script>")).toBe(true);
		expect(isForbiddenUrlValue("data:image/svg+xml,ok")).toBe(false);
		expect(isForbiddenUrlValue("https://example.com")).toBe(false);
	});
});

describe("scrubActiveAttributes", () => {
	it("removes on* handlers, forbidden URLs and srcdoc, keeps the rest", () => {
		const { el, removed } = fakeElement({
			onclick: "x()",
			ONERROR: "y()",
			href: "javascript:alert(1)",
			src: "https://ok.example/img.png",
			srcdoc: "<script>",
			alt: "fine",
		});
		scrubActiveAttributes(el);
		expect(removed.sort()).toEqual(["ONERROR", "href", "onclick", "srcdoc"]);
	});

	it("leaves non-URL attributes with scheme-like values alone", () => {
		const { el, removed } = fakeElement({
			title: "javascript:not-a-url-attr",
		});
		scrubActiveAttributes(el);
		expect(removed).toEqual([]);
	});
});
