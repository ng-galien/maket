import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAssetsService } from "../services/assets.js";
import { createBus } from "../services/bus.js";
import type { Config } from "../services/config.js";
import { createDocuments } from "../services/documents.js";
import type { GmailClient } from "../services/gmail-client.js";
import type { PdfService } from "../services/pdf.js";
import { createSQLiteStore } from "../services/store.js";
import { createDocument } from "../types.js";
import { createMaketGmailTool, gmailPack } from "./gmail.js";

const NO_EXTRA = {} as any;

type GmailApiMock = {
	users: {
		getProfile: ReturnType<typeof vi.fn>;
		messages: {
			list: ReturnType<typeof vi.fn>;
			get: ReturnType<typeof vi.fn>;
			attachments: {
				get: ReturnType<typeof vi.fn>;
			};
		};
		drafts: {
			create: ReturnType<typeof vi.fn>;
		};
	};
};

function fakeGmailClient(
	opts: {
		connected?: boolean;
		api?: GmailApiMock;
		/** When omitted, defaults to whatever `connected` is. */
		read?: boolean;
	} = {},
): GmailClient & { api: GmailApiMock } {
	const api: GmailApiMock = opts.api ?? {
		users: {
			getProfile: vi.fn(async () => ({
				data: { emailAddress: "me@example.com" },
			})),
			messages: {
				list: vi.fn(async () => ({ data: { messages: [] } })),
				get: vi.fn(async () => ({ data: { payload: { headers: [] } } })),
				attachments: {
					get: vi.fn(async () => ({ data: { size: 0, data: "" } })),
				},
			},
			drafts: {
				create: vi.fn(async () => ({ data: { id: "DRAFT_123" } })),
			},
		},
	};
	return {
		isConnected: vi.fn(() => opts.connected ?? false),
		getGmail: vi.fn(async () => api),
		tryRestore: vi.fn(async () => opts.connected ?? false),
		getAuthUrl: vi.fn(async () => "https://auth.example/u"),
		startAuth: vi.fn(async () => undefined),
		handleCallback: vi.fn(async () => "me@example.com"),
		grants: vi.fn(() => ({
			draft: opts.connected ?? false,
			read: opts.read ?? opts.connected ?? false,
		})),
		api,
	} as GmailClient & { api: GmailApiMock };
}

function fixture(
	gmailOpts: { connected?: boolean; api?: GmailApiMock; read?: boolean } = {},
) {
	const tmp = mkdtempSync(join(tmpdir(), "maket-gmail-"));
	const store = createSQLiteStore(":memory:");
	const documents = createDocuments({ store });
	const gmailClient = fakeGmailClient(gmailOpts);
	const pdfService: PdfService = {
		render: vi.fn(async () => ({
			buffer: Buffer.from("%PDF-fake"),
			pageCount: 1,
		})),
	};
	const assetsDir = join(tmp, "assets");
	const dataDir = tmp;
	mkdirSync(assetsDir, { recursive: true });
	const config = {
		ASSETS_DIR: assetsDir,
		DATA_DIR: dataDir,
	} as unknown as Config;
	const assets = createAssetsService({ assetsDir });
	const bus = createBus();
	return {
		store,
		documents,
		gmailClient,
		pdfService,
		config,
		assets,
		bus,
		tmp,
		cleanup: () => {
			store.close();
			rmSync(tmp, { recursive: true, force: true });
		},
	};
}

function makeEmailDoc(name: string, html = `<div data-id="body">hi</div>`) {
	return createDocument({
		name,
		category: "email",
		canvas: {
			format: "A4",
			orientation: "portrait",
			w: 210,
			h: 297,
			bg: "#fff",
		},
		meta: { emailTo: "recipient@example.com", emailSubject: "Test" },
		pages: [{ name: "P1", elements: [], html }],
	});
}

describe("gmailPack — registration", () => {
	it("declares id and deps", () => {
		expect(gmailPack.id).toBe("gmail");
		expect(gmailPack.requires).toEqual(
			expect.arrayContaining([
				"documents",
				"store",
				"gmailClient",
				"pdfService",
				"config",
			]),
		);
	});
});

describe("maket_gmail — action=connect", () => {
	it("returns the restored session without opening a browser", async () => {
		const { cleanup, ...deps } = fixture({ connected: false });
		deps.gmailClient.tryRestore = vi.fn(async () => true);
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler({ action: "connect" }, NO_EXTRA);
		expect(res.isError).toBeUndefined();
		expect((res.content[0] as any).text).toMatch(/already connected/);
		cleanup();
	});
});

describe("maket_gmail — action=search", () => {
	it("errors when not connected", async () => {
		const { cleanup, ...deps } = fixture({ connected: false });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "search", query: "is:unread" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when query is missing", async () => {
		const { cleanup, ...deps } = fixture({ connected: true });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler({ action: "search" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("returns 'No messages found' when the list is empty", async () => {
		const { cleanup, ...deps } = fixture({ connected: true });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "search", query: "nothing" },
			NO_EXTRA,
		);
		expect((res.content[0] as any).text).toMatch(/No messages found/);
		cleanup();
	});

	it("formats list results with subject, from, and date", async () => {
		const api: GmailApiMock = {
			users: {
				getProfile: vi.fn(),
				messages: {
					list: vi.fn(async () => ({
						data: { messages: [{ id: "m1" }, { id: "m2" }] },
					})),
					get: vi.fn(async ({ id }: { id: string }) => ({
						data: {
							payload: {
								headers: [
									{ name: "From", value: `sender${id}@example.com` },
									{ name: "Subject", value: `Hello ${id}` },
									{ name: "Date", value: "Mon, 18 Apr 2026" },
								],
								parts: [],
							},
						},
					})),
					attachments: { get: vi.fn() },
				},
				drafts: { create: vi.fn() },
			},
		};
		const { cleanup, ...deps } = fixture({ connected: true, api });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "search", query: "inbox" },
			NO_EXTRA,
		);
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/Hello m1/);
		expect(txt).toMatch(/Hello m2/);
		expect(txt).toMatch(/senderm1@example\.com/);
		cleanup();
	});
});

describe("maket_gmail — read scope gating", () => {
	it("search returns next: connect with_read=true when read is not granted", async () => {
		const { cleanup, ...deps } = fixture({ connected: true, read: false });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "search", query: "is:unread" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/draft-only mode/);
		expect(txt).toMatch(/maket_gmail action=connect with_read=true/);
		cleanup();
	});

	it("read returns next: connect with_read=true when read is not granted", async () => {
		const { cleanup, ...deps } = fixture({ connected: true, read: false });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler({ action: "read", id: "MID" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/maket_gmail action=connect with_read=true/);
		cleanup();
	});
});

describe("maket_gmail — action=read", () => {
	it("errors when not connected", async () => {
		const { cleanup, ...deps } = fixture({ connected: false });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler({ action: "read", id: "x" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when id is missing", async () => {
		const { cleanup, ...deps } = fixture({ connected: true });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler({ action: "read" }, NO_EXTRA);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("returns from/subject/date and truncates long bodies", async () => {
		const body = "A".repeat(3500);
		const api: GmailApiMock = {
			users: {
				getProfile: vi.fn(),
				messages: {
					list: vi.fn(),
					get: vi.fn(async () => ({
						data: {
							payload: {
								headers: [
									{ name: "From", value: "alice@example.com" },
									{ name: "To", value: "me@example.com" },
									{ name: "Subject", value: "Hello" },
									{ name: "Date", value: "Mon" },
								],
								mimeType: "text/plain",
								body: {
									data: Buffer.from(body).toString("base64url"),
								},
							},
						},
					})),
					attachments: { get: vi.fn() },
				},
				drafts: { create: vi.fn() },
			},
		};
		const { cleanup, ...deps } = fixture({ connected: true, api });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler({ action: "read", id: "MID" }, NO_EXTRA);
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/from: alice@example\.com/);
		expect(txt).toMatch(/subject: Hello/);
		expect(txt).toMatch(/chars remaining/);
		cleanup();
	});
});

describe("maket_gmail — action=draft", () => {
	it("errors when not connected", async () => {
		const { cleanup, ...deps } = fixture({ connected: false });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "draft", doc: "d", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when doc missing", async () => {
		const { cleanup, ...deps } = fixture({ connected: true });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "draft", doc: "ghost", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("errors when recipient is missing (no meta, no arg)", async () => {
		const { store, documents, cleanup, ...deps } = fixture({
			connected: true,
		});
		const d = createDocument({
			name: "bare",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [{ name: "P1", elements: [], html: `<p>hi</p>` }],
		});
		store.saveDoc(d);
		documents.loadAll();
		const tool = createMaketGmailTool({ store, documents, ...deps });
		const res = await tool.handler(
			{ action: "draft", doc: "bare", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/Missing recipient/);
		cleanup();
	});

	it("creates a draft and persists the draftId on the doc", async () => {
		const { store, documents, gmailClient, cleanup, ...deps } = fixture({
			connected: true,
		});
		store.saveDoc(makeEmailDoc("mail"));
		documents.loadAll();

		const tool = createMaketGmailTool({
			store,
			documents,
			gmailClient,
			...deps,
		});
		const res = await tool.handler(
			{ action: "draft", doc: "mail", page: 1 },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect((res.content[0] as any).text).toMatch(/DRAFT_123/);
		expect(gmailClient.api.users.drafts.create).toHaveBeenCalled();
		expect(documents.resolve("mail")?.meta.emailDraftId).toBe("DRAFT_123");
		cleanup();
	});

	it("persists a reviewable Gmail URL and role=body on the email doc", async () => {
		const api: GmailApiMock = {
			users: {
				getProfile: vi.fn(async () => ({
					data: { emailAddress: "me@example.com" },
				})),
				messages: {
					list: vi.fn(),
					get: vi.fn(),
					attachments: { get: vi.fn() },
				},
				drafts: {
					create: vi.fn(async () => ({
						data: { id: "DRAFT_9", message: { id: "MSG_X" } },
					})),
				},
			},
		};
		const { store, documents, gmailClient, cleanup, ...deps } = fixture({
			connected: true,
			api,
		});
		store.saveDoc(makeEmailDoc("mail"));
		documents.loadAll();
		const tool = createMaketGmailTool({
			store,
			documents,
			gmailClient,
			...deps,
		});
		const res = await tool.handler(
			{ action: "draft", doc: "mail", page: 1 },
			NO_EXTRA,
		);
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/mail\.google\.com\/mail\/u\/0\/#drafts\/MSG_X/);
		const meta = documents.resolve("mail")?.meta;
		expect(meta?.emailDraftUrl).toBe(
			"https://mail.google.com/mail/u/0/#drafts/MSG_X",
		);
		expect(meta?.emailDraftRole).toBe("body");
		cleanup();
	});

	it("mirrors the draft URL onto attached docs with role=attachment", async () => {
		const api: GmailApiMock = {
			users: {
				getProfile: vi.fn(async () => ({
					data: { emailAddress: "me@example.com" },
				})),
				messages: {
					list: vi.fn(),
					get: vi.fn(),
					attachments: { get: vi.fn() },
				},
				drafts: {
					create: vi.fn(async () => ({
						data: { id: "DRAFT_42", message: { id: "MSG_42" } },
					})),
				},
			},
		};
		const { store, documents, gmailClient, pdfService, cleanup, ...deps } =
			fixture({ connected: true, api });
		store.saveDoc(makeEmailDoc("mail"));
		store.saveDoc(
			createDocument({
				name: "brochure",
				canvas: {
					format: "A4",
					orientation: "portrait",
					w: 210,
					h: 297,
					bg: "#fff",
				},
				pages: [{ name: "P1", elements: [], html: `<p>att</p>` }],
			}),
		);
		documents.loadAll();
		const tool = createMaketGmailTool({
			store,
			documents,
			gmailClient,
			pdfService,
			...deps,
		});
		await tool.handler(
			{
				action: "draft",
				doc: "mail",
				page: 1,
				attachments: ["brochure"],
			},
			NO_EXTRA,
		);
		const brochureMeta = documents.resolve("brochure")?.meta;
		expect(brochureMeta?.emailDraftUrl).toBe(
			"https://mail.google.com/mail/u/0/#drafts/MSG_42",
		);
		expect(brochureMeta?.emailDraftRole).toBe("attachment");
		cleanup();
	});

	it("renders PDF attachments through pdfService and includes them in the MIME message", async () => {
		const { store, documents, gmailClient, pdfService, cleanup, ...deps } =
			fixture({ connected: true });
		store.saveDoc(makeEmailDoc("mail"));
		const attachmentDoc = createDocument({
			name: "brochure",
			canvas: {
				format: "A4",
				orientation: "portrait",
				w: 210,
				h: 297,
				bg: "#fff",
			},
			pages: [{ name: "P1", elements: [], html: `<p>att</p>` }],
		});
		store.saveDoc(attachmentDoc);
		documents.loadAll();

		const tool = createMaketGmailTool({
			store,
			documents,
			gmailClient,
			pdfService,
			...deps,
		});
		const res = await tool.handler(
			{
				action: "draft",
				doc: "mail",
				page: 1,
				attachments: ["brochure"],
			},
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(pdfService.render).toHaveBeenCalledWith(
			expect.objectContaining({ name: "brochure" }),
			"screen",
		);
		const createArgs = gmailClient.api.users.drafts.create.mock.calls[0]?.[0];
		const mime = Buffer.from(
			createArgs.requestBody.message.raw as string,
			"base64url",
		).toString();
		expect(mime).toMatch(/multipart\/mixed/);
		expect(mime).toMatch(/filename="brochure\.pdf"/);
		cleanup();
	});
});

describe("maket_gmail — action=fetch_attachment", () => {
	// A minimal 1×1 transparent PNG — passes magic-byte validation and Jimp
	// accepts it, so the happy-path test exercises optimize() + saveAsset().
	const TINY_PNG = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
		"base64",
	);

	function makePayload(
		filename: string,
		mimeType: string,
		attachmentId: string,
		size: number,
	) {
		return {
			filename,
			mimeType,
			body: { attachmentId, size },
		};
	}

	function makeApi(
		payload: object | null,
		attachmentData: { size: number; data: string },
	): GmailApiMock {
		return {
			users: {
				getProfile: vi.fn(),
				messages: {
					list: vi.fn(),
					get: vi.fn(async () => ({ data: { payload } })),
					attachments: {
						get: vi.fn(async () => ({ data: attachmentData })),
					},
				},
				drafts: { create: vi.fn() },
			},
		};
	}

	it("errors when not connected", async () => {
		const { cleanup, ...deps } = fixture({ connected: false });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		cleanup();
	});

	it("returns next: connect with_read=true when read is not granted", async () => {
		const { cleanup, ...deps } = fixture({ connected: true, read: false });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(
			/maket_gmail action=connect with_read=true/,
		);
		cleanup();
	});

	it("errors when id or attachmentId is missing", async () => {
		const { cleanup, ...deps } = fixture({ connected: true });
		const tool = createMaketGmailTool(deps);
		const res1 = await tool.handler(
			{ action: "fetch_attachment", attachmentId: "AID" },
			NO_EXTRA,
		);
		expect(res1.isError).toBe(true);
		const res2 = await tool.handler(
			{ action: "fetch_attachment", id: "MID" },
			NO_EXTRA,
		);
		expect(res2.isError).toBe(true);
		expect((res2.content[0] as any).text).toMatch(/attachmentId is required/);
		cleanup();
	});

	it("image branch: writes into ASSETS_DIR, registers an asset row, emits assets:changed", async () => {
		const payload = makePayload(
			"pic.png",
			"image/png",
			"AID-img",
			TINY_PNG.length,
		);
		const api = makeApi(payload, {
			size: TINY_PNG.length,
			data: TINY_PNG.toString("base64url"),
		});
		const { cleanup, bus, store, config, ...deps } = fixture({
			connected: true,
			api,
		});
		const busSpy = vi.fn();
		bus.on("assets:changed", busSpy);
		const tool = createMaketGmailTool({ ...deps, bus, store, config });
		const res = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-img" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		expect(existsSync(join(config.ASSETS_DIR, "pic.png"))).toBe(true);
		// Raw bytes must NOT have leaked into <DATA_DIR>/attachments/ — the image
		// branch owns the file.
		expect(existsSync(join(config.DATA_DIR, "attachments", "pic.png"))).toBe(
			false,
		);
		expect(store.loadAsset("pic.png")).toBeTruthy();
		expect(busSpy).toHaveBeenCalled();
		expect((res.content[0] as any).text).toMatch(/asset library/);
		expect((res.content[0] as any).text).toMatch(/maket_image action=view/);
		cleanup();
	});

	it("image branch: validation failure (wrong magic bytes) discards the file and returns an error", async () => {
		const fake = Buffer.from("notapng");
		const payload = makePayload(
			"bogus.png",
			"image/png",
			"AID-bad",
			fake.length,
		);
		const api = makeApi(payload, {
			size: fake.length,
			data: fake.toString("base64url"),
		});
		const { cleanup, bus, store, config, ...deps } = fixture({
			connected: true,
			api,
		});
		const busSpy = vi.fn();
		bus.on("assets:changed", busSpy);
		const tool = createMaketGmailTool({ ...deps, bus, store, config });
		const res = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-bad" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/rejected/);
		expect(existsSync(join(config.ASSETS_DIR, "bogus.png"))).toBe(false);
		expect(store.loadAsset("bogus.png")).toBeNull();
		expect(busSpy).not.toHaveBeenCalled();
		cleanup();
	});

	it("non-image branch: writes to <DATA_DIR>/attachments, skips the asset library", async () => {
		const pdfBytes = Buffer.from("%PDF-1.4\n%fake\n");
		const payload = makePayload(
			"invoice.pdf",
			"application/pdf",
			"AID-pdf",
			pdfBytes.length,
		);
		const api = makeApi(payload, {
			size: pdfBytes.length,
			data: pdfBytes.toString("base64url"),
		});
		const { cleanup, bus, store, config, ...deps } = fixture({
			connected: true,
			api,
		});
		const busSpy = vi.fn();
		bus.on("assets:changed", busSpy);
		const tool = createMaketGmailTool({ ...deps, bus, store, config });
		const res = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-pdf" },
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const saved = join(config.DATA_DIR, "attachments", "invoice.pdf");
		expect(existsSync(saved)).toBe(true);
		expect(readFileSync(saved).toString()).toBe(pdfBytes.toString());
		expect(store.loadAsset("invoice.pdf")).toBeNull();
		expect(busSpy).not.toHaveBeenCalled();
		expect(existsSync(join(config.ASSETS_DIR, "invoice.pdf"))).toBe(false);
		cleanup();
	});

	it("refuses to overwrite an existing non-image file unless overwrite=true", async () => {
		const bytes = Buffer.from("v1");
		const payload = makePayload(
			"note.txt",
			"text/plain",
			"AID-note",
			bytes.length,
		);
		const api = makeApi(payload, {
			size: bytes.length,
			data: bytes.toString("base64url"),
		});
		const { cleanup, config, ...deps } = fixture({ connected: true, api });
		const tool = createMaketGmailTool({ ...deps, config });
		const first = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-note" },
			NO_EXTRA,
		);
		expect(first.isError).toBeUndefined();
		const second = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-note" },
			NO_EXTRA,
		);
		expect(second.isError).toBe(true);
		expect((second.content[0] as any).text).toMatch(/already saved/);
		const third = await tool.handler(
			{
				action: "fetch_attachment",
				id: "MID",
				attachmentId: "AID-note",
				overwrite: true,
			},
			NO_EXTRA,
		);
		expect(third.isError).toBeUndefined();
		cleanup();
	});

	it("refuses to overwrite an existing image asset unless overwrite=true", async () => {
		const payload = makePayload(
			"pic.png",
			"image/png",
			"AID-img",
			TINY_PNG.length,
		);
		const api = makeApi(payload, {
			size: TINY_PNG.length,
			data: TINY_PNG.toString("base64url"),
		});
		const { cleanup, config, ...deps } = fixture({ connected: true, api });
		const tool = createMaketGmailTool({ ...deps, config });
		const first = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-img" },
			NO_EXTRA,
		);
		expect(first.isError).toBeUndefined();
		const second = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-img" },
			NO_EXTRA,
		);
		expect(second.isError).toBe(true);
		expect((second.content[0] as any).text).toMatch(/already exists/i);
		cleanup();
	});

	it("rejects attachments whose declared size exceeds the 35 MB cap", async () => {
		const payload = makePayload(
			"huge.bin",
			"application/octet-stream",
			"AID-huge",
			99 * 1024 * 1024,
		);
		const api = makeApi(payload, { size: 99 * 1024 * 1024, data: "" });
		const { cleanup, ...deps } = fixture({ connected: true, api });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-huge" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/too large/);
		cleanup();
	});

	it("rejects when Gmail omits or malforms the `size` field", async () => {
		const payload = makePayload(
			"weird.bin",
			"application/octet-stream",
			"AID-weird",
			0,
		);
		const api = makeApi(payload, {
			size: "not-a-number",
			data: "AA==",
		} as unknown as { size: number; data: string });
		const { cleanup, ...deps } = fixture({ connected: true, api });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-weird" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/invalid attachment size/);
		cleanup();
	});

	it("rejects via the base64 length estimate when the payload itself is oversized", async () => {
		// A dishonest declared size + a gigantic base64 payload: the pre-decode
		// estimate must reject before we allocate a huge Buffer.
		const payload = makePayload(
			"bloat.bin",
			"application/octet-stream",
			"AID-bloat",
			10,
		);
		const bigB64 = "A".repeat(60 * 1024 * 1024);
		const api = makeApi(payload, { size: 10, data: bigB64 });
		const { cleanup, ...deps } = fixture({ connected: true, api });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-bloat" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/too large/);
		cleanup();
	});

	it("errors clearly when the attachment id is not present on the message", async () => {
		const api = makeApi({ parts: [] }, { size: 0, data: "" });
		const { cleanup, ...deps } = fixture({ connected: true, api });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler(
			{ action: "fetch_attachment", id: "MID", attachmentId: "AID-missing" },
			NO_EXTRA,
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as any).text).toMatch(/not found/);
		cleanup();
	});

	it("sanitizes filenames so non-image writes stay inside <DATA_DIR>/attachments", async () => {
		const bytes = Buffer.from("x");
		const api = makeApi(null, {
			size: bytes.length,
			data: bytes.toString("base64url"),
		});
		const { cleanup, config, ...deps } = fixture({ connected: true, api });
		const tool = createMaketGmailTool({ ...deps, config });
		const res = await tool.handler(
			{
				action: "fetch_attachment",
				id: "MID",
				attachmentId: "AID-esc",
				filename: "../../etc/passwd",
			},
			NO_EXTRA,
		);
		expect(res.isError).toBeUndefined();
		const txt = (res.content[0] as any).text as string;
		expect(txt).toContain(join(config.DATA_DIR, "attachments"));
		expect(txt).not.toMatch(/\.\.\//);
		cleanup();
	});
});
