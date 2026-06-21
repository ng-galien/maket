/**
 * Read a request body into memory with a hard byte cap.
 *
 * Routes that bypass `express.json()` (multipart uploads, raw `.maket`
 * imports) need their own size guard — without one, a local process can
 * trivially DoS the server by streaming a multi-GB body.
 */

import type { IncomingMessage } from "node:http";

export class BodyTooLargeError extends Error {
	readonly statusCode = 413;
	constructor(maxBytes: number) {
		super(`Request body exceeds ${maxBytes} bytes`);
		this.name = "BodyTooLargeError";
	}
}

export async function readBoundedBody(
	req: IncomingMessage,
	maxBytes: number,
): Promise<Buffer> {
	const declared = Number(req.headers["content-length"] ?? "0");
	if (declared && declared > maxBytes) {
		throw new BodyTooLargeError(maxBytes);
	}

	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		const buf = chunk as Buffer;
		total += buf.byteLength;
		if (total > maxBytes) {
			req.destroy();
			throw new BodyTooLargeError(maxBytes);
		}
		chunks.push(buf);
	}
	return Buffer.concat(chunks);
}
