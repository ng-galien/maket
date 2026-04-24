/**
 * gmail pack — maket_gmail (compound).
 *
 * Compound dispatch: connect, search, read, fetch_attachment, draft.
 *
 * Deps: `documents` (email doc lookup), `store` (attachment docs, charte,
 * asset rows), `gmailClient` (OAuth + API), `pdfService` (render PDF
 * attachments), `config` (ASSETS_DIR for inlining images, DATA_DIR for the
 * non-image attachments drop, PORT for OAuth redirect URI), `assets`
 * (filesystem helpers when importing image attachments into the library),
 * `bus` (asset-changed broadcast when an image lands in the library).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler, ToolResult } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import { parseCharteVars } from "../lib/charte-css.js";
import { type AssetsService, IMAGE_EXTS } from "../services/assets.js";
import type { Bus } from "../services/bus.js";
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
	bus: Bus;
}

type GmailPayload = any;

const ActionSchema = z.enum([
	"connect",
	"search",
	"read",
	"draft",
	"fetch_attachment",
]);

// Gmail caps user attachments at 25 MB; we leave headroom for protocol
// overhead and uncommon >25 MB attachments delivered via drive.google.com
// CIDs. 35 MB is the ceiling we refuse to decode into memory.
const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;

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
	attachmentId: z
		.string()
		.optional()
		.describe(
			"For fetch_attachment: Gmail attachment id from a previous action=read call.",
		),
	filename: z
		.string()
		.optional()
		.describe(
			"For fetch_attachment: override the saved filename. Defaults to the name reported by Gmail.",
		),
	overwrite: z
		.boolean()
		.optional()
		.describe(
			"For fetch_attachment: replace an existing file (asset or non-image drop) when set. Default false.",
		),
	category: z
		.string()
		.optional()
		.describe(
			"For fetch_attachment (image branch only): category tag saved with the asset row. Default email-attachment.",
		),
	quality: z
		.enum(["screen", "print", "hd"])
		.optional()
		.describe(
			"For draft: PDF quality preset for attachments. Default screen (smaller).",
		),
	with_read: z
		.boolean()
		.optional()
		.describe(
			"For connect: also request read access (inbox search + message read). Default false — Maket only creates drafts.",
		),
});

const DESCRIPTION = [
	"When to use: connect Gmail, search/read mail, download an attachment, or create a draft from a Maket document. All actions except connect require an active OAuth session — call connect first.",
	"",
	"  connect          — restore the refresh token if present, otherwise open the browser for OAuth consent. Pass with_read=true to also request inbox access (drafts are always granted).",
	"  search           — list subject/from/date for messages matching a Gmail query. Capped at 50. Requires with_read=true at connect time.",
	"  read             — fetch one message by id: headers, body (3000-char truncated), attachments listing. Requires with_read=true at connect time.",
	"  fetch_attachment — download one attachment (id + attachmentId from a prior read). Images land in the Maket asset library (validated, optimized, thumbnailed, metadata row). Other files (PDF, zip, docx, …) drop into <DATA_DIR>/attachments/ untouched. Requires with_read=true at connect time.",
	"  draft            — compose a Gmail draft from a document page. Charte tokens resolve to literals, assets inline as base64, listed docs attach as PDFs. Maket never sends — the user reviews and sends from Gmail.",
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
					return runConnect(args, deps);
				case "search":
					return runSearch(args, deps);
				case "read":
					return runRead(args, deps);
				case "fetch_attachment":
					return runFetchAttachment(args, deps);
				case "draft":
					return runDraft(args, deps);
			}
		},
	};
}

type Args = z.infer<typeof MaketGmailSchema>;

/**
 * Fire-and-forget browser launch for the OAuth consent URL. On Windows the
 * launcher is a `cmd.exe` builtin (`start`) — spawn it through `cmd /c` with
 * an empty title arg (`""`) so URLs containing `&` or spaces are parsed as
 * the target, not as the window title. Errors are swallowed: the server's
 * auth-code loop still runs, and the user can paste the URL manually if the
 * browser can't open.
 */
function openBrowser(url: string): void {
	try {
		const child =
			platform() === "win32"
				? spawn("cmd", ["/c", "start", "", url], {
						detached: true,
						stdio: "ignore",
					})
				: spawn(platform() === "darwin" ? "open" : "xdg-open", [url], {
						detached: true,
						stdio: "ignore",
					});
		child.on("error", () => {
			/* headless host or missing helper — handled by the manual paste fallback */
		});
		child.unref();
	} catch {
		/* noop — see comment above */
	}
}

async function runConnect(args: Args, deps: GmailDeps): Promise<ToolResult> {
	const { gmailClient, config } = deps;
	const withRead = args.with_read === true;
	try {
		const restored = await gmailClient.tryRestore();
		if (restored) {
			const grants = gmailClient.grants();
			const gmail = await gmailClient.getGmail();
			const profile = await gmail.users.getProfile({ userId: "me" });
			// If the caller asked for read but the existing grant doesn't cover it,
			// fall through to a fresh OAuth round so the user can consent to it.
			if (!withRead || grants.read) {
				const features = grants.read ? "draft + read" : "draft only";
				return text(
					`Gmail already connected: ${profile.data.emailAddress} (${features})`,
				);
			}
		}
		const redirectUri = `http://localhost:${config.PORT}/auth/google/callback`;
		const authUrl = await gmailClient.getAuthUrl(redirectUri, { withRead });

		// Best-effort — if we can't launch a browser (headless box, missing
		// xdg-open, Windows `start` quirks), the user can still copy the URL
		// from the OAuth flow; don't let a launch failure abort connect.
		openBrowser(authUrl);

		await gmailClient.startAuth();
		const grants = gmailClient.grants();
		const gmail = await gmailClient.getGmail();
		const profile = await gmail.users.getProfile({ userId: "me" });
		const features = grants.read ? "draft + read" : "draft only";
		return text(`Gmail connected: ${profile.data.emailAddress} (${features})`);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		const missingCreds = /credentials not found/i.test(message);
		if (missingCreds) {
			const setupUrl = `http://localhost:${config.PORT}/setup/gmail`;
			return text(
				`Gmail credentials not configured. Open ${setupUrl} to paste the OAuth Desktop JSON from Google Cloud Console, then retry maket_gmail connect.`,
				{
					isError: true,
					next: [`open ${setupUrl}`, "maket_gmail action=connect"],
				},
			);
		}
		return text(`Gmail connection failed: ${message}`, true);
	}
}

function requireRead(deps: GmailDeps): ToolResult | null {
	if (deps.gmailClient.grants().read) return null;
	return text(
		"Gmail is connected in draft-only mode — reading is not authorized. Ask the user whether to enable inbox reading; if yes, call maket_gmail action=connect with_read=true.",
		{
			isError: true,
			next: ["maket_gmail action=connect with_read=true"],
		},
	);
}

async function runSearch(args: Args, deps: GmailDeps): Promise<ToolResult> {
	const { gmailClient } = deps;
	if (!args.query) return text("query is required for action=search", true);
	if (!gmailClient.isConnected())
		return text("Gmail not connected — call maket_gmail connect first", true);
	const readGate = requireRead(deps);
	if (readGate) return readGate;
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
	const readGate = requireRead(deps);
	if (readGate) return readGate;
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
			lines.push(
				`  ${a.filename} (${a.mimeType}, ${formatSize(a.size)}) id:${a.id}`,
			);
		}
	}
	const maxBody = 3000;
	const truncated = body.length > maxBody;
	lines.push("", "body:", truncated ? body.slice(0, maxBody) : body);
	if (truncated) lines.push(`... (${body.length - maxBody} chars remaining)`);
	return text(lines.join("\n"));
}

function findAttachmentMeta(
	payload: GmailPayload,
	attachmentId: string,
): { filename: string; mimeType: string } | null {
	if (
		payload.filename &&
		payload.filename.length > 0 &&
		payload.body?.attachmentId === attachmentId
	) {
		return {
			filename: payload.filename,
			mimeType: payload.mimeType || "application/octet-stream",
		};
	}
	if (payload.parts) {
		for (const part of payload.parts) {
			const hit = findAttachmentMeta(part, attachmentId);
			if (hit) return hit;
		}
	}
	return null;
}

// Empty result signals an invalid name. Control chars are stripped by
// code-point iteration to keep biome's noControlCharactersInRegex happy.
function sanitizeFilename(raw: string): string {
	const base = raw.replace(/[\\/]/g, "_").replace(/^\.+/, "");
	let out = "";
	for (const ch of base) {
		const code = ch.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) continue;
		if (/[<>:"|?*]/.test(ch)) {
			out += "_";
			continue;
		}
		out += ch;
	}
	return out.trim();
}

function formatSize(bytes: number): string {
	return bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(0)}KB`;
}

async function runFetchAttachment(
	args: Args,
	deps: GmailDeps,
): Promise<ToolResult> {
	const { gmailClient, assets, store, bus, config } = deps;
	if (!args.id) return text("id is required for action=fetch_attachment", true);
	if (!args.attachmentId)
		return text(
			"attachmentId is required for action=fetch_attachment — run action=read on the message first to list attachment ids",
			true,
		);
	if (!gmailClient.isConnected())
		return text("Gmail not connected — call maket_gmail connect first", true);
	const readGate = requireRead(deps);
	if (readGate) return readGate;

	const gmail = await gmailClient.getGmail();

	let resolvedFilename = args.filename;
	let mimeType = "application/octet-stream";
	if (!resolvedFilename) {
		const detail = await gmail.users.messages.get({
			userId: "me",
			id: args.id,
			format: "full",
		});
		const meta = findAttachmentMeta(detail.data.payload, args.attachmentId);
		if (!meta) {
			return text(
				`Attachment id "${args.attachmentId}" not found on message "${args.id}"`,
				true,
			);
		}
		resolvedFilename = meta.filename;
		mimeType = meta.mimeType;
	}

	const safeName = sanitizeFilename(resolvedFilename);
	if (!safeName)
		return text(
			"Gmail returned an empty attachment filename and none was provided",
			true,
		);

	const res = await gmail.users.messages.attachments.get({
		userId: "me",
		messageId: args.id,
		id: args.attachmentId,
	});
	const b64 = res.data?.data;
	if (typeof b64 !== "string")
		return text("Gmail returned no attachment data", true);
	const tooLarge = (n: number) =>
		text(
			`Attachment too large (${n} bytes) — limit is ${MAX_ATTACHMENT_BYTES} bytes`,
			true,
		);
	const declaredSize = typeof res.data.size === "number" ? res.data.size : 0;
	// Declared size check rejects before we pay the decode cost; the second
	// check after decode defends against a dishonest `size` field.
	if (declaredSize > MAX_ATTACHMENT_BYTES) return tooLarge(declaredSize);
	const buffer = Buffer.from(b64, "base64url");
	if (buffer.length > MAX_ATTACHMENT_BYTES) return tooLarge(buffer.length);

	const ext = extname(safeName).toLowerCase();
	const isImage = IMAGE_EXTS.has(ext);
	if (isImage) {
		return importImageAttachment({
			buffer,
			filename: safeName,
			mimeType,
			overwrite: args.overwrite === true,
			category: args.category || "email-attachment",
			assets,
			store,
			bus,
		});
	}
	return dropNonImageAttachment({
		buffer,
		filename: safeName,
		mimeType,
		overwrite: args.overwrite === true,
		dataDir: config.DATA_DIR,
	});
}

// On validation failure, remove() is required so a rejected image doesn't
// linger in the library between agent turns.
async function importImageAttachment(inputs: {
	buffer: Buffer;
	filename: string;
	mimeType: string;
	overwrite: boolean;
	category: string;
	assets: AssetsService;
	store: Store;
	bus: Bus;
}): Promise<ToolResult> {
	const {
		buffer,
		filename,
		mimeType,
		overwrite,
		category,
		assets,
		store,
		bus,
	} = inputs;
	try {
		await assets.importBuffer(buffer, filename, overwrite);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return text(`Image import failed: ${msg}`, true);
	}

	const validation = assets.validateImageFile(filename);
	if (!validation.valid) {
		assets.remove(filename);
		return text(
			`Image import rejected: ${validation.reason}. File discarded.`,
			true,
		);
	}

	const optimized = await assets.optimize(filename);
	const dims = optimized || assets.getDimensions(filename);
	store.saveAsset({
		filename,
		category,
		width: dims?.w,
		height: dims?.h,
	});
	bus.emit("assets:changed", {});

	const dimInfo = dims ? ` (${dims.w}×${dims.h})` : "";
	const sizeInfo = formatSize(buffer.length);
	return text(
		`Imported ${filename}${dimInfo} (${mimeType}, ${sizeInfo}) into the Maket asset library.`,
		{
			next: [
				`maket_image action=view filename="${filename}"`,
				`maket_image action=meta filename="${filename}" context_token=<from view> title=... tags=[...]`,
			],
		},
	);
}

function dropNonImageAttachment(inputs: {
	buffer: Buffer;
	filename: string;
	mimeType: string;
	overwrite: boolean;
	dataDir: string;
}): ToolResult {
	const { buffer, filename, mimeType, overwrite, dataDir } = inputs;
	const attDir = join(dataDir, "attachments");
	const destAbs = resolve(join(attDir, filename));
	if (!destAbs.startsWith(resolve(attDir) + sep))
		return text(`Invalid filename: ${filename}`, true);
	if (existsSync(destAbs) && !overwrite)
		return text(
			`Attachment already saved at ${destAbs}. Pass overwrite=true to replace.`,
			true,
		);
	mkdirSync(attDir, { recursive: true });
	writeFileSync(destAbs, buffer);
	return text(
		`Saved ${filename} (${mimeType}, ${formatSize(buffer.length)}) to ${destAbs}`,
	);
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
	// Gmail's draft deep link uses the underlying message id, not the draft id.
	// Falling back to the Drafts folder if the message id is missing keeps the
	// link useful even when the API response shape drifts.
	const messageId = draft.data.message?.id || "";
	const draftUrl = messageId
		? `https://mail.google.com/mail/u/0/#drafts/${messageId}`
		: "https://mail.google.com/mail/u/0/#drafts";

	if (doc.meta) {
		doc.meta.emailDraftId = draftId;
		doc.meta.emailDraftUrl = draftUrl;
		doc.meta.emailDraftRole = "body";
		doc.meta.emailTo = to;
		doc.meta.emailSubject = subject;
		documents.persist(doc.name);
	}

	// Mirror the draft URL onto each attached doc so it surfaces alongside every
	// artefact that ended up in the email, not just the body.
	for (const name of attachmentNames) {
		const attDoc = documents.resolveOrLoad(name);
		if (!attDoc?.meta) continue;
		attDoc.meta.emailDraftId = draftId;
		attDoc.meta.emailDraftUrl = draftUrl;
		attDoc.meta.emailDraftRole = "attachment";
		documents.persist(attDoc.name);
	}

	const attInfo =
		pdfAttachments.length > 0
			? ` with ${pdfAttachments.length} PDF attachment(s)`
			: "";
	return text(
		`Draft created${attInfo}: ${draftId}\nTo: ${to}\nSubject: ${subject}\n\nReview & send in Gmail: ${draftUrl}`,
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
		"bus",
	],
	declaresTools: ["maket_gmail"],
	register(container) {
		container.register({
			maketGmailTool: asFunction(createMaketGmailTool).singleton(),
		});
	},
};
