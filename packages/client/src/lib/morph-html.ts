/**
 * Update a container's children to match new HTML while keeping every element
 * that still corresponds to the same tag (and the same `data-id` or `id`) in
 * place. Changed attributes are applied to the existing element, so author
 * CSS transitions on geometry or opacity run when a re-render changes them.
 */
export function morphHtml(container: Element, html: string): void {
	const template = container.ownerDocument.createElement("template");
	template.innerHTML = html;
	morphChildren(container, template.content);
}

function morphChildren(current: ParentNode, next: ParentNode): void {
	const targets = [...next.childNodes];
	for (const [index, target] of targets.entries()) {
		const existing = current.childNodes[index] ?? null;
		if (existing && sameNode(existing, target)) {
			morphNode(existing, target);
			continue;
		}
		const keyed = findKeyedSibling(current, index, target);
		if (keyed) {
			current.insertBefore(keyed, existing);
			morphNode(keyed, target);
			continue;
		}
		current.insertBefore(target, existing);
	}
	while (current.childNodes.length > targets.length) {
		current.lastChild?.remove();
	}
}

function morphNode(current: ChildNode, next: ChildNode): void {
	if (current.nodeType !== Node.ELEMENT_NODE) {
		if (current.nodeValue !== next.nodeValue) {
			current.nodeValue = next.nodeValue;
		}
		return;
	}
	const element = current as Element;
	const target = next as Element;
	syncAttributes(element, target);
	if (element.localName === "template") {
		(element as HTMLTemplateElement).innerHTML = (
			target as HTMLTemplateElement
		).innerHTML;
		return;
	}
	morphChildren(element, target);
	syncControlState(element, target);
}

function syncAttributes(element: Element, target: Element): void {
	for (const attribute of [...element.attributes]) {
		if (!target.hasAttributeNS(attribute.namespaceURI, attribute.localName)) {
			element.removeAttributeNS(attribute.namespaceURI, attribute.localName);
		}
	}
	for (const attribute of [...target.attributes]) {
		if (
			element.getAttributeNS(attribute.namespaceURI, attribute.localName) !==
			attribute.value
		) {
			element.setAttributeNS(
				attribute.namespaceURI,
				attribute.name,
				attribute.value,
			);
		}
	}
}

/** Form control properties do not follow their attributes once touched. */
function syncControlState(element: Element, target: Element): void {
	const focused = element.ownerDocument.activeElement === element;
	if (element instanceof HTMLInputElement) {
		if (element.type === "checkbox" || element.type === "radio") {
			element.checked = target.hasAttribute("checked");
		} else if (!focused) {
			element.value = target.getAttribute("value") ?? "";
		}
		return;
	}
	if (element instanceof HTMLOptionElement) {
		element.selected = target.hasAttribute("selected");
		return;
	}
	if (element instanceof HTMLTextAreaElement && !focused) {
		element.value = target.textContent ?? "";
	}
}

function sameNode(current: ChildNode, next: ChildNode): boolean {
	if (current.nodeType !== next.nodeType) return false;
	if (current.nodeType !== Node.ELEMENT_NODE) return true;
	const element = current as Element;
	const target = next as Element;
	return (
		element.localName === target.localName &&
		element.namespaceURI === target.namespaceURI &&
		nodeKey(element) === nodeKey(target)
	);
}

function nodeKey(element: Element): string | null {
	return element.getAttribute("data-id") ?? element.getAttribute("id");
}

function findKeyedSibling(
	parent: ParentNode,
	from: number,
	target: ChildNode,
): ChildNode | null {
	if (target.nodeType !== Node.ELEMENT_NODE) return null;
	const key = nodeKey(target as Element);
	if (key === null) return null;
	for (let index = from + 1; index < parent.childNodes.length; index += 1) {
		const candidate = parent.childNodes[index];
		if (candidate && sameNode(candidate, target)) return candidate;
	}
	return null;
}
