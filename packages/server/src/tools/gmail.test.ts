import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAssetsService } from "../services/assets.js";
import type { Config } from "../services/config.js";
import { createDocuments } from "../services/documents.js";
import type { GmailClient } from "../services/gmail-client.js";
import type { PdfService } from "../services/pdf.js";
import { createSQLiteStore } from "../services/store.js";
import { DocumentModel } from "../types.js";
import { createMaketGmailTool, gmailPack } from "./gmail.js";

// biome-ignore lint/suspicious/noExplicitAny: ToolExtra is opaque for tests
const NO_EXTRA = {} as any;

type GmailApiMock = {
	users: {
		getProfile: ReturnType<typeof vi.fn>;
		messages: {
			list: ReturnType<typeof vi.fn>;
			get: ReturnType<typeof vi.fn>;
		};
		drafts: {
			create: ReturnType<typeof vi.fn>;
		};
	};
};

function fakeGmailClient(
	opts: { connected?: boolean; api?: GmailApiMock } = {},
): GmailClient & { api: GmailApiMock } {
	const api: GmailApiMock = opts.api ?? {
		users: {
			getProfile: vi.fn(async () => ({
				data: { emailAddress: "me@example.com" },
			})),
			messages: {
				list: vi.fn(async () => ({ data: { messages: [] } })),
				get: vi.fn(async () => ({ data: { payload: { headers: [] } } })),
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
		api,
	} as GmailClient & { api: GmailApiMock };
}

function fixture(gmailOpts: { connected?: boolean; api?: GmailApiMock } = {}) {
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
	const config = { ASSETS_DIR: tmp } as unknown as Config;
	const assets = createAssetsService({ assetsDir: tmp });
	return {
		store,
		documents,
		gmailClient,
		pdfService,
		config,
		assets,
		cleanup: () => {
			store.close();
			rmSync(tmp, { recursive: true, force: true });
		},
	};
}

function makeEmailDoc(name: string, html = `<div data-id="body">hi</div>`) {
	return new DocumentModel({
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
		// biome-ignore lint/suspicious/noExplicitAny: content shape
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
		// biome-ignore lint/suspicious/noExplicitAny: content shape
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
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		const txt = (res.content[0] as any).text as string;
		expect(txt).toMatch(/Hello m1/);
		expect(txt).toMatch(/Hello m2/);
		expect(txt).toMatch(/senderm1@example\.com/);
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
				},
				drafts: { create: vi.fn() },
			},
		};
		const { cleanup, ...deps } = fixture({ connected: true, api });
		const tool = createMaketGmailTool(deps);
		const res = await tool.handler({ action: "read", id: "MID" }, NO_EXTRA);
		// biome-ignore lint/suspicious/noExplicitAny: content shape
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
		const d = new DocumentModel({
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
		// biome-ignore lint/suspicious/noExplicitAny: content shape
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
		// biome-ignore lint/suspicious/noExplicitAny: content shape
		expect((res.content[0] as any).text).toMatch(/DRAFT_123/);
		expect(gmailClient.api.users.drafts.create).toHaveBeenCalled();
		expect(documents.resolve("mail")?.meta.emailDraftId).toBe("DRAFT_123");
		cleanup();
	});

	it("renders PDF attachments through pdfService and includes them in the MIME message", async () => {
		const { store, documents, gmailClient, pdfService, cleanup, ...deps } =
			fixture({ connected: true });
		store.saveDoc(makeEmailDoc("mail"));
		const attachmentDoc = new DocumentModel({
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
