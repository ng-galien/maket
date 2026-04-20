import { createConnection } from "node:net";

export function probeServer(
	port: number,
	host = "127.0.0.1",
	timeoutMs = 500,
): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host });
		let settled = false;
		const done = (ok: boolean) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(ok);
		};
		const t = setTimeout(() => done(false), timeoutMs);
		socket.once("connect", () => {
			clearTimeout(t);
			done(true);
		});
		socket.once("error", () => {
			clearTimeout(t);
			done(false);
		});
	});
}

export async function waitForServer(
	port: number,
	host = "127.0.0.1",
	totalTimeoutMs = 10_000,
	intervalMs = 150,
): Promise<boolean> {
	const deadline = Date.now() + totalTimeoutMs;
	while (Date.now() < deadline) {
		if (await probeServer(port, host, 400)) return true;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}
