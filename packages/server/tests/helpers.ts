import type { AddressInfo } from "node:net";
import type { Express } from "express";

export interface TestApp {
	baseUrl: string;
	close: () => Promise<void>;
}

export async function startTestApp(app: Express): Promise<TestApp> {
	const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
		const s = app.listen(0, () => resolve(s));
	});
	const port = (server.address() as AddressInfo).port;
	return {
		baseUrl: `http://127.0.0.1:${port}`,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((err) => (err ? reject(err) : resolve())),
			),
	};
}
