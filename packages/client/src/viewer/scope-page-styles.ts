/**
 * Keep authored selectors inside their own page, including after live updates.
 * An implicit scope uses the style element's parent. Place styles at the page
 * root in source order so nested styles still cover the whole authored page.
 */
export function scopePageStyles(html: string): string {
	if (!/<style[\s>]/i.test(html)) return html;
	const template = document.createElement("template");
	template.innerHTML = html;
	const styles = template.content.querySelectorAll("style");
	const scopedStyles = document.createDocumentFragment();
	for (const style of styles) {
		style.textContent = `@scope { ${style.textContent ?? ""}\n}`;
		scopedStyles.append(style);
	}
	template.content.prepend(scopedStyles);
	return template.innerHTML;
}
