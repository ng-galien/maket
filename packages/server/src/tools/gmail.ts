/**
 * gmail pack — maket_gmail (compound).
 *
 * Compound dispatch: connect, search, read, draft.
 *
 * Deps: `documents` (email doc lookup), `store` (attachment docs, charte),
 * `gmailClient` (OAuth + API), `pdfService` (render PDF attachments),
 * `config` (ASSETS_DIR for inlining images, PORT for OAuth redirect URI).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler, ToolResult } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import { parseCharteVars } from "../lib/charte-css.js";
import type { AssetsService } from "../services/assets.js";
import type { Config } from "../services/config.js";
import type { Documents } from "../services/documents.js";
import type { GmailClient } from "../services/gmail-client.js";
import type { PdfService } from "../services/pdf.js";
import type { Store } from "../services/store.js";
import { text } from "./_helpers.js";

export interface GmailDeps {
	documents: Documents;
	store: Store;
	gmailClient: GmailClient;
	pdfService: PdfService;
	config: Config;
	assets: AssetsService;
}

// biome-ignore lint/suspicious/noExplicitAny: googleapis payload shapes are loose
type GmailPayload = any;

const ActionSchema = z.enum(["connect", "search", "read", "draft"]);

const MaketGmailSchema = z.object({
	action: ActionSchema.describe(
		"Operation to run. See the tool description for the action table.",
	),
	query: z
		.string()
		.optional()
		.describe(
			"For search: Gmail query (same syntax as the UI: from:, subject:, after:, etc.).",
		),
	maxResults: z.coerce
		.number()
		.optional()
		.describe("For search: cap on results. Default 10, max 50."),
	id: z
		.string()
		.optional()
		.describe("For read: Gmail message id (from search results)."),
	doc: z
		.string()
		.optional()
		.describe("For draft: Maket document to use as the email body."),
	page: z.coerce
		.number()
		.optional()
		.describe("For draft: 1-based page number within the document."),
	to: z
		.string()
		.optional()
		.describe(
			"For draft: recipient. Falls back to doc.meta.emailTo when omitted.",
		),
	cc: z
		.string()
		.optional()
		.describe("For draft: cc. Falls back to doc.meta.emailCc."),
	bcc: z
		.string()
		.optional()
		.describe("For draft: bcc. Falls back to doc.meta.emailBcc."),
	subject: z
		.string()
		.optional()
		.describe("For draft: subject. Falls back to doc.meta.emailSubject."),
	attachments: z
		.array(z.string())
		.optional()
		.describe(
			"For draft: names of other Maket docs to attach as PDFs. Falls back to doc.meta.emailAttachments.",
		),
	quality: z
		.enum(["screen", "print", "hd"])
		.optional()
		.describe(
			"For draft: PDF quality preset for attachments. Default screen (smaller).",
		),
});

const DESCRIPTION = [
	"When to use: connect Gmail, search/read mail, or create a draft from a Maket document. All actions except connect require an active OAuth session — call connect first.",
	"",
	"  connect — restore the refresh token if present, otherwise open the browser for OAuth consent.",
	"  search  — list subject/from/date for messages matching a Gmail query. Capped at 50.",
	"  read    — fetch one message by id: headers, body (3000-char truncated), attachments listing.",
	"  draft   — compose a Gmail draft from a document page. Charte tokens resolve to literals, assets inline as base64, listed docs attach as PDFs. The draft is opened in Gmail for review — we never send automatically.",
].join("\n");

export function createMaketGmailTool(deps: GmailDeps): ToolHandler {
	return {
		metadata: {
			name: "maket_gmail",
			description: DESCRIPTION,
			schema: MaketGmailSchema,
		},
		handler: async (rawArgs) => {
			const args = MaketGmailSchema.parse(rawArgs);
			switch (args.action) {
				case "connect":
					return runConnect(deps);
				case "search":
					return runSearch(args, deps);
				case "read":
					return runRead(args, deps);
				case "draft":
					return runDraft(args, deps);
			}
		},
	};
}

type Args = z.infer<typeof MaketGmailSchema>;

async function runConnect(deps: GmailDeps): Promise<ToolResult> {
	const { gmailClient, config } = deps;
	try {
		const restored = await gmailClient.tryRestore();
		if (restored) {
			const gmail = await gmailClient.getGmail();
			const profile = await gmail.users.getProfile({ userId: "me" });
			return text(`Gmail already connected: ${profile.data.emailAddress}`);
		}
		const redirectUri = `http://localhost:${config.PORT}/auth/google/callback`;
		const authUrl = await gmailClient.getAuthUrl(redirectUri);

		const { execFile } = await import("node:child_process");
		const { platform } = await import("node:os");
		const cmd =
			platform() === "darwin"
				? "open"
				: platform() === "win32"
					? "start"
					: "xdg-open";
		execFile(cmd, [authUrl]);

		await gmailClient.startAuth();
		const gmail = await gmailClient.getGmail();
		const profile = await gmail.users.getProfile({ userId: "me" });
		return text(`Gmail connected: ${profile.data.emailAddress}`);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return text(`Gmail connection failed: ${message}`, true);
	}
}

async function runSearch(args: Args, deps: GmailDeps): Promise<ToolResult> {
	const { gmailClient } = deps;
	if (!args.query) return text("query is required for action=search", true);
	if (!gmailClient.isConnected())
		return text("Gmail not connected — call maket_gmail connect first", true);
	const maxResults = Math.min(args.maxResults || 10, 50);
	const gmail = await gmailClient.getGmail();
	const listRes = await gmail.users.messages.list({
		userId: "me",
		q: args.query,
		maxResults,
	});
	const messages = listRes.data.messages || [];
	if (messages.length === 0)
		return text(`No messages found for: ${args.query}`);

	const lines: string[] = [`Results for: ${args.query}`, ""];
	for (const msg of messages) {
		if (!msg.id) continue;
		const detail = await gmail.users.messages.get({
			userId: "me",
			id: msg.id,
			format: "metadata",
			metadataHeaders: ["From", "Subject", "Date"],
		});
		const headers = detail.data.payload?.headers || [];
		const from =
			headers.find((h: GmailPayload) => h.name === "From")?.value || "";
		const subject =
			headers.find((h: GmailPayload) => h.name === "Subject")?.value || "";
		const date =
			headers.find((h: GmailPayload) => h.name === "Date")?.value || "";
		const hasAttach = (detail.data.payload?.parts || []).some(
			(p: GmailPayload) => p.filename && p.filename.length > 0,
		);
		lines.push(`[${msg.id}] ${subject}`);
		lines.push(`  from: ${from}  date: ${date}${hasAttach ? "  📎" : ""}`);
		lines.push("");
	}
	return text(lines.join("\n"));
}

function extractBody(payload: GmailPayload): string {
	if (payload.body?.data && payload.mimeType === "text/plain") {
		return Buffer.from(payload.body.data, "base64url").toString("utf-8");
	}
	if (payload.parts) {
		for (const part of payload.parts) {
			const body = extractBody(part);
			if (body) return body;
		}
	}
	if (payload.body?.data && payload.mimeType === "text/html") {
		return Buffer.from(payload.body.data, "base64url")
			.toString("utf-8")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}
	return "";
}

function collectAttachments(
	payload: GmailPayload,
): { id: string; filename: string; mimeType: string; size: number }[] {
	const attachments: {
		id: string;
		filename: string;
		mimeType: string;
		size: number;
	}[] = [];
	if (
		payload.filename &&
		payload.filename.length > 0 &&
		payload.body?.attachmentId
	) {
		attachments.push({
			id: payload.body.attachmentId,
			filename: payload.filename,
			mimeType: payload.mimeType || "application/octet-stream",
			size: payload.body.size || 0,
		});
	}
	if (payload.parts) {
		for (const part of payload.parts)
			attachments.push(...collectAttachments(part));
	}
	return attachments;
}

async function runRead(args: Args, deps: GmailDeps): Promise<ToolResult> {
	const { gmailClient } = deps;
	if (!args.id) return text("id is required for action=read", true);
	if (!gmailClient.isConnected())
		return text("Gmail not connected — call maket_gmail connect first", true);
	const gmail = await gmailClient.getGmail();
	const detail = await gmail.users.messages.get({
		userId: "me",
		id: args.id,
		format: "full",
	});
	const payload = detail.data.payload;
	const headers = payload?.headers || [];
	const from =
		headers.find((h: GmailPayload) => h.name === "From")?.value || "";
	const to = headers.find((h: GmailPayload) => h.name === "To")?.value || "";
	const subject =
		headers.find((h: GmailPayload) => h.name === "Subject")?.value || "";
	const date =
		headers.find((h: GmailPayload) => h.name === "Date")?.value || "";

	const body = extractBody(payload);
	const attachments = collectAttachments(payload);

	const lines: string[] = [
		`from: ${from}`,
		`to: ${to}`,
		`subject: ${subject}`,
		`date: ${date}`,
	];
	if (attachments.length > 0) {
		lines.push("", `attachments (${attachments.length}):`);
		for (const a of attachments) {
			const size =
				a.size < 1024 ? `${a.size}B` : `${(a.size / 1024).toFixed(0)}KB`;
			lines.push(`  ${a.filename} (${a.mimeType}, ${size}) id:${a.id}`);
		}
	}
	const maxBody = 3000;
	const truncated = body.length > maxBody;
	lines.push("", "body:", truncated ? body.slice(0, maxBody) : body);
	if (truncated) lines.push(`... (${body.length - maxBody} chars remaining)`);
	return text(lines.join("\n"));
}

function resolveCharteVars(html: string, charteCss: string): string {
	const vars = parseCharteVars(charteCss);
	let result = html;
	for (const [name, value] of vars) {
		result = result.replaceAll(`var(${name})`, value);
		const fallbackRegex = new RegExp(
			`var\\(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,[^)]*\\)`,
			"g",
		);
		result = result.replace(fallbackRegex, value);
	}
	return result;
}

function inlineAssetImages(
	html: string,
	assetsDir: string,
	mime: (path: string) => string,
): string {
	return html.replace(/\/assets\/([^"')\s]+)/g, (_match, filename: string) => {
		const absPath = join(assetsDir, filename);
		if (!existsSync(absPath)) return `/assets/${filename}`;
		const b64 = readFileSync(absPath).toString("base64");
		return `data:${mime(absPath)};base64,${b64}`;
	});
}

function normalizeEmailHtml(
	html: string,
	charteCss: string,
	assetsDir: string,
	mime: (path: string) => string,
): string {
	let result = resolveCharteVars(html, charteCss);
	result = inlineAssetImages(result, assetsDir, mime);
	return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;">
<table width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="background:#ffffff;">
<tr><td>${result}</td></tr>
</table>
</body>
</html>`;
}

function buildMimeMessage(
	from: string,
	to: string,
	subject: string,
	htmlBody: string,
	cc?: string,
	bcc?: string,
	attachments?: { filename: string; buffer: Buffer }[],
): string {
	const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	const headers = [
		`From: ${from}`,
		`To: ${to}`,
		`Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
		"MIME-Version: 1.0",
	];
	if (cc) headers.push(`Cc: ${cc}`);
	if (bcc) headers.push(`Bcc: ${bcc}`);

	if (!attachments?.length) {
		headers.push('Content-Type: text/html; charset="UTF-8"');
		headers.push("Content-Transfer-Encoding: base64");
		return `${headers.join("\r\n")}\r\n\r\n${Buffer.from(htmlBody).toString("base64")}`;
	}

	headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
	const parts: string[] = [
		`--${boundary}`,
		'Content-Type: text/html; charset="UTF-8"',
		"Content-Transfer-Encoding: base64",
		"",
		Buffer.from(htmlBody).toString("base64"),
	];
	for (const att of attachments) {
		parts.push(
			`--${boundary}`,
			`Content-Type: application/pdf; name="${att.filename}"`,
			"Content-Transfer-Encoding: base64",
			`Content-Disposition: attachment; filename="${att.filename}"`,
			"",
			att.buffer.toString("base64"),
		);
	}
	parts.push(`--${boundary}--`);
	return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
}

async function runDraft(args: Args, deps: GmailDeps): Promise<ToolResult> {
	const { documents, store, gmailClient, pdfService, config, assets } = deps;
	if (!args.doc) return text("doc is required for action=draft", true);
	if (args.page == null) return text("page is required for action=draft", true);
	if (!gmailClient.isConnected())
		return text("Gmail not connected — call maket_gmail connect first", true);

	const doc = documents.resolveOrLoad(args.doc);
	if (!doc) return text(`Document "${args.doc}" not found`, true);

	const to = args.to || doc.meta?.emailTo;
	const subject = args.subject || doc.meta?.emailSubject;
	if (!to)
		return text(
			"Missing recipient — provide 'to' argument or set emailTo in doc meta",
			true,
		);
	if (!subject)
		return text(
			"Missing subject — provide 'subject' argument or set emailSubject in doc meta",
			true,
		);
	const cc = args.cc || doc.meta?.emailCc;
	const bcc = args.bcc || doc.meta?.emailBcc;

	const pageIdx = args.page - 1;
	const page = doc.pages[pageIdx];
	if (!page)
		return text(
			`Page ${args.page} not found (${doc.pages.length} pages)`,
			true,
		);
	if (!page.html)
		return text(
			"No HTML content on this page — compose with maket_html set first",
			true,
		);

	const gmail = await gmailClient.getGmail();
	const profile = await gmail.users.getProfile({ userId: "me" });
	const from = profile.data.emailAddress || "";

	const charteCss = documents.charteCss(doc);
	const htmlBody = normalizeEmailHtml(
		page.html,
		charteCss,
		config.ASSETS_DIR,
		(p) => assets.mimeFromExt(p),
	);

	const attachmentNames = args.attachments || doc.meta?.emailAttachments || [];
	const pdfAttachments: { filename: string; buffer: Buffer }[] = [];
	if (attachmentNames.length > 0) {
		const quality = args.quality || "screen";
		const results = await Promise.all(
			attachmentNames.map(async (name) => {
				const attDoc = store.loadOne(name) || store.loadById(name);
				if (!attDoc)
					throw new Error(`Attachment document not found: "${name}"`);
				const { buffer } = await pdfService.render(attDoc, quality);
				return {
					filename: `${attDoc.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`,
					buffer,
				};
			}),
		);
		pdfAttachments.push(...results);
	}

	const mimeMessage = buildMimeMessage(
		from,
		to,
		subject,
		htmlBody,
		cc,
		bcc,
		pdfAttachments,
	);
	const raw = Buffer.from(mimeMessage).toString("base64url");
	const draft = await gmail.users.drafts.create({
		userId: "me",
		requestBody: { message: { raw } },
	});
	const draftId = draft.data.id || "";

	if (doc.meta) {
		doc.meta.emailDraftId = draftId;
		doc.meta.emailTo = to;
		doc.meta.emailSubject = subject;
		documents.persist(doc.name);
	}

	const attInfo =
		pdfAttachments.length > 0
			? ` with ${pdfAttachments.length} PDF attachment(s)`
			: "";
	return text(
		`Draft created${attInfo}: ${draftId}\nTo: ${to}\nSubject: ${subject}\n\nOpen Gmail to review and send.`,
	);
}

export const gmailPack: ToolPack = {
	id: "gmail",
	name: "Gmail",
	requires: [
		"documents",
		"store",
		"gmailClient",
		"pdfService",
		"config",
		"assets",
	],
	declaresTools: ["maket_gmail"],
	register(container) {
		container.register({
			maketGmailTool: asFunction(createMaketGmailTool).singleton(),
		});
	},
};
