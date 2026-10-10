import postcss, { type AtRule } from "postcss";
import { stripStyleClose } from "./css-escape.js";

const PAGE_ROOT_SELECTOR =
	/^(?:(?:html|:root)\s+body|html|body|:root)(?=$|[\s>+~.#[:])/i;

/**
 * Confine a style sheet to the elements matching `scope`: every selector is
 * prefixed with it, `html`, `body`, `:root` and `:scope` become the scope
 * element itself, and keyframes stay as written. A sheet that does not parse
 * is dropped rather than applied unscoped.
 */
export function scopeCssToElement(css: string, scope: string): string {
	try {
		const sheet = postcss.parse(css);
		sheet.walkRules((rule) => {
			const parent = rule.parent;
			if (
				parent?.type === "atrule" &&
				/keyframes$/i.test((parent as AtRule).name)
			)
				return;
			rule.selectors = rule.selectors.map((selector) =>
				scopeSelector(selector, scope),
			);
		});
		return stripStyleClose(sheet.toString());
	} catch {
		return "";
	}
}

function scopeSelector(selector: string, scope: string): string {
	const trimmed = selector.trim();
	if (trimmed.includes(":scope")) return trimmed.replaceAll(":scope", scope);
	const rooted = trimmed.replace(PAGE_ROOT_SELECTOR, scope);
	return rooted !== trimmed ? rooted : `${scope} ${trimmed}`;
}
