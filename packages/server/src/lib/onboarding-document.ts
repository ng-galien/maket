import { createDocument, type Document } from "../types.js";

export type OnboardingLocale = "en" | "fr";

export const ONBOARDING_DOCUMENT_NAME = "Maket Help";

const COPY: Record<OnboardingLocale, OnboardingCopy> = {
	en: {
		page: "Help",
		kicker: "User help",
		title: "Working with Maket",
		subtitle:
			"A visual document, an assistant, a live preview, and notes directly in the workspace.",
		steps: [
			[
				"Create or open a document",
				"The workspace displays documents as work surfaces. A document can be printed, exported, or enriched with data.",
			],
			[
				"Guide the assistant",
				"Click an element to leave a note. The assistant reads these messages, fixes the document, and marks them as handled.",
			],
			[
				"Structure data",
				"Collections store typed rows. A page bound to a collection can show a template or the rendered value of one row.",
			],
			[
				"Preview and print",
				"The print button follows the current selection mode: template, rendered row, or full collection.",
			],
		],
		workspaceTitle: "The workspace is shared",
		workspaceText:
			"You see the document; the assistant sees the same resources through MCP. Documents, chartes, images, and collections remain Maket's business resources.",
		checklistTitle: "Quick landmarks",
		checklist: [
			"Documents: create, rename, duplicate, lock.",
			"Chartes: keep visual consistency.",
			"Collections: drive variants with data.",
			"Exchanges: send your feedback to the assistant.",
		],
		footer:
			"This built-in document is user help. It is separate from the maket_learn MCP tool, which only orients agents.",
	},
	fr: {
		page: "Aide",
		kicker: "Aide utilisateur",
		title: "Travailler avec Maket",
		subtitle:
			"Un document visuel, un assistant, une preview vivante et des notes directement dans le workspace.",
		steps: [
			[
				"Créer ou ouvrir un document",
				"Le workspace affiche les documents comme des surfaces de travail. Un document peut être imprimé, exporté ou enrichi avec des données.",
			],
			[
				"Guider l'assistant",
				"Cliquez un élément pour laisser une note. L'assistant lit ces messages, corrige le document et les marque comme traités.",
			],
			[
				"Structurer les données",
				"Les collections stockent des lignes typées. Une page liée à une collection peut afficher un template ou le rendu d'une ligne.",
			],
			[
				"Prévisualiser et imprimer",
				"Le bouton d'impression respecte le mode de sélection courant : template, ligne rendue ou collection complète.",
			],
		],
		workspaceTitle: "Le workspace est partagé",
		workspaceText:
			"Vous voyez le document, l'assistant voit les mêmes ressources via MCP. Les documents, les chartes, les images et les collections restent les ressources métier de Maket.",
		checklistTitle: "Repères rapides",
		checklist: [
			"Documents : créer, renommer, dupliquer, verrouiller.",
			"Chartes : garder la cohérence visuelle.",
			"Collections : piloter les variantes par les données.",
			"Échanges : transmettre vos retours à l'assistant.",
		],
		footer:
			"Ce document est une aide utilisateur builtin. Il est séparé de la tool MCP maket_learn, qui sert uniquement à orienter les agents.",
	},
};

interface OnboardingCopy {
	page: string;
	kicker: string;
	title: string;
	subtitle: string;
	steps: [string, string][];
	workspaceTitle: string;
	workspaceText: string;
	checklistTitle: string;
	checklist: string[];
	footer: string;
}

export function onboardingLocale(input: string | undefined): OnboardingLocale {
	return input === "fr" ? "fr" : "en";
}

export function onboardingDocumentName(): string {
	return ONBOARDING_DOCUMENT_NAME;
}

export function createOnboardingDocument(locale: OnboardingLocale): Document {
	const copy = COPY[locale];
	return createDocument({
		name: ONBOARDING_DOCUMENT_NAME,
		category: "help",
		canvas: {
			format: "A4",
			orientation: "landscape",
			w: 297,
			h: 210,
			bg: "#f8fafc",
		},
		meta: { locked: true },
		pages: [{ name: copy.page, elements: [], html: onboardingHtml(copy) }],
	});
}

export function localizeOnboardingDocument(
	doc: Document,
	locale: OnboardingLocale,
): void {
	const copy = COPY[locale];
	doc.category = "help";
	doc.meta.locked = true;
	doc.canvas = {
		format: "A4",
		orientation: "landscape",
		w: 297,
		h: 210,
		bg: "#f8fafc",
	};
	doc.pages = [
		{
			id: doc.pages[0]?.id ?? "help-page",
			name: copy.page,
			elements: [],
			html: onboardingHtml(copy),
		},
	];
	doc.activePage = 0;
}

function onboardingHtml(copy: OnboardingCopy): string {
	const stepBlocks = copy.steps
		.map((step, index) => stepBlock(step, index))
		.join("\n");
	const checklist = copy.checklist
		.map(
			(item, index) =>
				`<p data-id="help-checklist-${index + 1}" style="margin:0;font-size:9.5pt;color:#465264;">${item}</p>`,
		)
		.join("\n");
	return `
<section data-id="help-shell" style="box-sizing:border-box;width:100%;height:100%;padding:18mm 20mm;background:#f8fafc;color:#172033;font-family:Inter,Arial,sans-serif;">
  <header data-id="help-header" style="display:flex;align-items:flex-end;justify-content:space-between;border-bottom:0.7mm solid #172033;padding-bottom:7mm;margin-bottom:10mm;">
    <div data-id="help-title-block">
      <p data-id="help-kicker" style="margin:0 0 3mm;font-size:9pt;text-transform:uppercase;letter-spacing:0;color:#637083;font-weight:700;">${copy.kicker}</p>
      <h1 data-id="help-title" style="margin:0;font-size:31pt;line-height:0.95;font-weight:850;">${copy.title}</h1>
    </div>
    <p data-id="help-subtitle" style="margin:0;max-width:78mm;font-size:11pt;line-height:1.35;color:#465264;">${copy.subtitle}</p>
  </header>
  <main data-id="help-grid" style="display:grid;grid-template-columns:1.05fr 0.95fr;gap:10mm;height:128mm;">
    <section data-id="help-flow" style="display:grid;grid-template-rows:repeat(4,1fr);gap:5mm;">
      ${stepBlocks}
    </section>
    <aside data-id="help-workspace" style="display:flex;flex-direction:column;gap:6mm;">
      <div data-id="help-workspace-panel" style="background:#172033;color:#ffffff;padding:8mm;height:55mm;">
        <h2 data-id="help-workspace-title" style="margin:0 0 4mm;font-size:15pt;">${copy.workspaceTitle}</h2>
        <p data-id="help-workspace-text" style="margin:0;font-size:10pt;line-height:1.45;color:#d8dee8;">${copy.workspaceText}</p>
      </div>
      <div data-id="help-checklist" style="background:#ffffff;padding:7mm;display:grid;gap:3mm;">
        <h2 data-id="help-checklist-title" style="margin:0 0 2mm;font-size:14pt;color:#172033;">${copy.checklistTitle}</h2>
        ${checklist}
      </div>
      <div data-id="help-footer" style="margin-top:auto;border-top:0.4mm solid #cbd5e1;padding-top:4mm;color:#637083;font-size:8.5pt;line-height:1.35;">${copy.footer}</div>
    </aside>
  </main>
</section>`.trim();
}

function stepBlock([title, body]: [string, string], index: number): string {
	const colors = ["#0f766e", "#b45309", "#2563eb", "#7c3aed"];
	const ids = ["create", "guide", "data", "finish"];
	const color = colors[index] ?? colors[0];
	const id = ids[index] ?? `step-${index + 1}`;
	return `<article data-id="help-step-${id}" style="display:grid;grid-template-columns:17mm 1fr;gap:5mm;align-items:start;border-left:1.2mm solid ${color};padding:4mm 0 4mm 5mm;background:#ffffff;">
        <strong data-id="help-step-${id}-number" style="font-size:19pt;color:${color};line-height:1;">${index + 1}</strong>
        <div data-id="help-step-${id}-copy">
          <h2 data-id="help-step-${id}-title" style="margin:0 0 1.5mm;font-size:13pt;">${title}</h2>
          <p data-id="help-step-${id}-text" style="margin:0;font-size:9.5pt;line-height:1.35;color:#465264;">${body}</p>
        </div>
      </article>`;
}
