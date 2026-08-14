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
	"document:renamed": { oldName: string; docName: string };
	"document:focused": { docName: string };
	"workspace:fit-view": Record<string, never>;
	"document:deleted": { docName: string };
	"canvas:changed": { docName: string };
	"element:updated": { docName: string; id: string };
	"assets:changed": Record<string, never>;
	"meta:updated": { docName: string };
	"charte:updated": { name: string; css: string };
	"charte:removed": { name: string };
	"collection:saved": { name: string };
	"collection:deleted": { name: string };
	"document-state:changed": {
		docName: string;
		revision: number;
		paths: string[];
		schemaChanged?: boolean;
		attached?: boolean;
	};
	/** A page↔collection preview cursor moved; listeners re-broadcast the
	 * full snapshot (`collectionCursors.snapshot()`). */
	"collection-cursor:changed": Record<string, never>;
	"messages:acked": { ids: string[] };
	"annotations:changed": Record<string, never>;
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
