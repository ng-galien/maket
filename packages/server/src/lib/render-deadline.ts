/**
 * Deadlines for headless render steps.
 *
 * `withDeadline` settles with the work, or rejects with a `RenderTimeoutError`
 * naming the step once `timeoutMs` passes. The work keeps running in the
 * background; the caller closes the page that hosts it.
 */

export class RenderTimeoutError extends Error {
	readonly step: string;
	readonly timeoutMs: number;

	constructor(step: string, timeoutMs: number) {
		super(`Render step "${step}" timed out after ${timeoutMs}ms`);
		this.name = "RenderTimeoutError";
		this.step = step;
		this.timeoutMs = timeoutMs;
	}
}

export function withDeadline<T>(
	work: Promise<T>,
	timeoutMs: number,
	step: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new RenderTimeoutError(step, timeoutMs)),
			timeoutMs,
		);
	});
	return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
