import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import { parseHTML } from "linkedom";
import type { Charte } from "../types.js";
import {
	buildMermaidRenderOptions,
	MERMAID_DENSITY_ROLES,
	type MermaidRenderingInput,
	normalizeMermaidSource,
	supportsMermaidDensity,
	validateMermaidDensitySupport,
	validateMermaidSourcePolicy,
} from "./mermaid-rendering.js";

const SPEC_ATTRIBUTE = "data-maket-mermaid";
const SPEC_VERSION = 1;

export interface MermaidDiagramSpec {
	version: typeof SPEC_VERSION;
	source: string;
	options: MermaidRenderingInput;
}

export interface MermaidRefreshResult {
	html: string;
	refreshed: number;
	errors: string[];
}

export function createMermaidDiagramSpec(
	source: string,
	options: MermaidRenderingInput,
): MermaidDiagramSpec {
	return { version: SPEC_VERSION, source, options };
}

export function encodeMermaidDiagramSpec(spec: MermaidDiagramSpec): string {
	return Buffer.from(JSON.stringify(spec), "utf8").toString("base64url");
}

export function decodeMermaidDiagramSpec(
	encoded: string,
): MermaidDiagramSpec | null {
	try {
		const candidate = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf8"),
		) as Partial<MermaidDiagramSpec>;
		if (
			candidate.version !== SPEC_VERSION ||
			typeof candidate.source !== "string" ||
			!candidate.options ||
			typeof candidate.options !== "object" ||
			Array.isArray(candidate.options)
		) {
			return null;
		}
		return candidate as MermaidDiagramSpec;
	} catch {
		return null;
	}
}

export function renderMermaidDiagram(
	spec: MermaidDiagramSpec,
	charte: Charte | null,
): string {
	validateMermaidSourcePolicy(spec.source);
	validateMermaidDensitySupport(spec.source, spec.options);
	const options = buildMermaidRenderOptions(
		spec.options,
		THEMES as unknown as Record<string, Record<string, string>>,
		charte,
	);
	if (options && !supportsMermaidDensity(spec.source)) {
		for (const role of MERMAID_DENSITY_ROLES) delete options[role];
	}
	return normalizeMermaidSvg(
		renderMermaidSVG(normalizeMermaidSource(spec.source), options),
	);
}

export function mermaidSpecAttribute(spec: MermaidDiagramSpec): string {
	return `${SPEC_ATTRIBUTE}="${encodeMermaidDiagramSpec(spec)}"`;
}

export function refreshMermaidHtml(
	html: string,
	charte: Charte | null,
): MermaidRefreshResult {
	if (!html.includes(SPEC_ATTRIBUTE)) return { html, refreshed: 0, errors: [] };
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const errors: string[] = [];
	let refreshed = 0;
	for (const wrapper of document.body.querySelectorAll(`[${SPEC_ATTRIBUTE}]`)) {
		const encoded = wrapper.getAttribute(SPEC_ATTRIBUTE) ?? "";
		const spec = decodeMermaidDiagramSpec(encoded);
		if (!spec) {
			errors.push("Invalid persisted Mermaid diagram specification.");
			continue;
		}
		try {
			wrapper.innerHTML = renderMermaidDiagram(spec, charte);
			refreshed++;
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}
	return { html: document.body.innerHTML, refreshed, errors };
}

function normalizeMermaidSvg(svg: string): string {
	return svg
		.replace(/<svg([^>]*)\swidth="[^"]*"/, '<svg$1 width="100%"')
		.replace(/<svg([^>]*)\sheight="[^"]*"/, '<svg$1 height="100%"');
}
