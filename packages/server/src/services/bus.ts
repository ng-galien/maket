/**
 * bus — typed event emitter for decoupling mutations from side effects.
 *
 * Consumed via DI: plugins receive `bus` as a destructured dependency.
 * The legacy `../bus.ts` module re-exports a default instance for backward
 * compatibility during the Awilix migration (Phase 2). Handlers are migrated
 * to container-injected `bus` in Phase 3.
 */

import { EventEmitter } from "node:events";

export interface BusEvents {
	"document:created": { docName: string };
	"document:saved": { docName: string };
	"document:loaded": { docName: string };
	"document:focused": { docName: string };
	"document:deleted": { docName: string };
	"canvas:changed": { docName: string };
	"element:added": { docName: string; id: string };
	"element:updated": { docName: string; id: string; measureId?: string };
	"element:deleted": { docName: string; id: string };
	"element:reordered": { docName: string; id: string; action: string };
	"elements:cleared": { docName: string };
	"assets:changed": Record<string, never>;
	"meta:updated": { docName: string };
	"charte:updated": { name: string; css: string };
	"messages:acked": { ids: string[] };
	toast: { text: string; level?: string; duration?: number };
}

export interface Bus {
	emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void;
	on<K extends keyof BusEvents>(
		event: K,
		fn: (payload: BusEvents[K]) => void,
	): void;
	off<K extends keyof BusEvents>(
		event: K,
		fn: (payload: BusEvents[K]) => void,
	): void;
}

class BusImpl implements Bus {
	private ee = new EventEmitter();

	emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
		this.ee.emit(event, payload);
	}

	on<K extends keyof BusEvents>(
		event: K,
		fn: (payload: BusEvents[K]) => void,
	): void {
		this.ee.on(event, fn as (...args: unknown[]) => void);
	}

	off<K extends keyof BusEvents>(
		event: K,
		fn: (payload: BusEvents[K]) => void,
	): void {
		this.ee.off(event, fn as (...args: unknown[]) => void);
	}
}

/** Factory — produces a fresh bus instance. Register with `asFunction(createBus).singleton()`. */
export function createBus(): Bus {
	return new BusImpl();
}
