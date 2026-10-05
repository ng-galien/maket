import { once } from "node:events";
import { createServer, request } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { createDocument, expect, test } from "./workspace-test";

const BASE_PATH = "/mobile/apps/maket";
test.use({ gatewayBasePath: BASE_PATH });

test("reads a linked document through the prefixed HTTP and WebSocket gateway", async ({
	baseURL,
	mcp,
	page,
}) => {
	if (!baseURL) throw new Error("Missing isolated Maket URL");
	await mcp.call("maket_image", {
		action: "import",
		path: path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			"fixtures",
			"agent-bundle-logo.svg",
		),
		filename: "gateway-logo.svg",
	});
	await createDocument(mcp, "Gateway document", {
		html: '<main data-id="page"><h1 data-id="title">Gateway reading content</h1><img data-id="logo" alt="Gateway logo" src="/assets/gateway-logo.svg" /></main>',
	});
	const link = JSON.parse(
		await mcp.callText("maket_doc", {
			action: "link",
			doc: "Gateway document",
		}),
	) as { documentId: string; path: string };
	expect(link.path).toMatch(/^\/mobile\/apps\/maket\/documents\/[^/]+\/read$/);

	const upstream = new URL(baseURL);
	const wsServer = new WebSocketServer({ noServer: true });
	let websocketUpgraded = false;
	const seenPaths: string[] = [];
	const gateway = createServer((incoming, response) => {
		const path = incoming.url ?? "";
		seenPaths.push(path);
		if (!path.startsWith(`${BASE_PATH}/`)) {
			response.writeHead(404).end();
			return;
		}
		const headers = { ...incoming.headers, host: upstream.host };
		if (headers.origin) headers.origin = upstream.origin;
		const forwarded = request(
			new URL(path.slice(BASE_PATH.length), upstream),
			{ method: incoming.method, headers },
			(fromMaket) => {
				response.writeHead(fromMaket.statusCode ?? 502, fromMaket.headers);
				fromMaket.pipe(response);
			},
		);
		forwarded.on("error", () => response.writeHead(502).end());
		incoming.pipe(forwarded);
	});
	gateway.on("upgrade", (incoming, socket, head) => {
		const path = incoming.url ?? "";
		if (path !== `${BASE_PATH}/ws?viewer=1`) {
			socket.destroy();
			return;
		}
		websocketUpgraded = true;
		wsServer.handleUpgrade(incoming, socket, head, (browserSocket) => {
			const maketSocket = new WebSocket(`ws://${upstream.host}/ws?viewer=1`, {
				origin: upstream.origin,
			});
			const pending: string[] = [];
			maketSocket.on("open", () => {
				for (const data of pending) maketSocket.send(data);
			});
			browserSocket.on("message", (data) => {
				if (maketSocket.readyState === WebSocket.OPEN)
					maketSocket.send(data.toString());
				else pending.push(data.toString());
			});
			maketSocket.on("message", (data) => {
				if (browserSocket.readyState === WebSocket.OPEN)
					browserSocket.send(data.toString());
			});
			maketSocket.on("close", () => browserSocket.close());
			browserSocket.on("close", () => maketSocket.close());
		});
	});
	gateway.listen(0, "127.0.0.1");
	await once(gateway, "listening");
	const address = gateway.address();
	if (!address || typeof address === "string")
		throw new Error("Missing gateway port");
	const gatewayOrigin = `http://127.0.0.1:${address.port}`;
	const failedResponses: string[] = [];
	page.on("response", (response) => {
		if (response.status() >= 400)
			failedResponses.push(`${response.status()} ${response.url()}`);
	});
	try {
		await page.goto(`${gatewayOrigin}${link.path}`);
		await expect(
			page.locator(`[data-linked-document="${link.documentId}"]`),
		).toBeVisible();
		await expect(page.getByText("Gateway reading content")).toBeVisible();
		await expect
			.poll(() =>
				page
					.getByRole("img", { name: "Gateway logo" })
					.evaluate((image: HTMLImageElement) => image.naturalWidth),
			)
			.toBeGreaterThan(0);
		await mcp.call("maket_html", {
			action: "set",
			doc: "Gateway document",
			page: 1,
			html: '<main data-id="page"><h1 data-id="title">Updated through gateway</h1><img data-id="logo" alt="Gateway logo" src="/assets/gateway-logo.svg" /></main>',
		});
		await expect(page.getByText("Updated through gateway")).toBeVisible();
		expect(websocketUpgraded).toBe(true);
		expect(
			seenPaths.some((path) => path.startsWith(`${BASE_PATH}/assets/`)),
		).toBe(true);
		expect(failedResponses).toEqual([]);
	} finally {
		await page.close();
		wsServer.close();
		gateway.close();
	}
});
