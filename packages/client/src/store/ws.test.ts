import { ACTIVITY_KEYS } from "@maket/shared";
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n/useT";
import { useStore } from "./useStore";
import {
	type StatePatchCommand,
	sendStateValuePatch,
	setStatePatchTransport,
	translateBubble,
} from "./ws";

describe("translateBubble", () => {
	afterEach(() => setLang("fr"));

	it("renders English bubbles when the language is set to en", () => {
		setLang("en");
		expect(translateBubble("bubble_maket_doc_new", { name: "hero" })).toBe(
			"New document: hero",
		);
	});

	it("interpolates {param} placeholders", () => {
		setLang("en");
		expect(
			translateBubble("bubble_maket_image_import", { name: "hero.jpg" }),
		).toBe("Image imported: hero.jpg");
	});

	it("uses the fr dictionary when the language is fr", () => {
		setLang("fr");
		expect(
			translateBubble("bubble_maket_image_import", { name: "hero.jpg" }),
		).toBe("Image importée : hero.jpg");
	});

	it("provides non-empty English and French text for every visible activity", () => {
		for (const lang of ["en", "fr"] as const) {
			setLang(lang);
			for (const key of ACTIVITY_KEYS) {
				expect(translateBubble(key).trim(), `${lang}:${key}`).not.toBe("");
			}
		}
	});
});

describe("sendStateValuePatch through a state patch transport", () => {
	afterEach(() => setStatePatchTransport(null));

	it("hands the Maket form command to the transport and keeps it pending until settled", () => {
		const sent: StatePatchCommand[] = [];
		setStatePatchTransport((command) => sent.push(command));
		useStore.setState({
			documentStates: {
				Survey: {
					schema: { type: "object" },
					data: { done: false },
					revision: 3,
					templates: {},
				} as never,
			},
			statePatchPending: {},
			statePatchRequests: {},
			statePatchErrors: {},
		});

		const requestId = sendStateValuePatch("Survey", "/done", 3, true);

		expect(requestId).toEqual(expect.any(String));
		expect(sent).toEqual([
			{
				type: "state_patch",
				requestId,
				docName: "Survey",
				expectedRevision: 3,
				operation: { op: "replace", path: "/done", value: true },
			},
		]);
		expect(Object.values(useStore.getState().statePatchPending)).toEqual([
			requestId,
		]);
		useStore.getState().settleStatePatch(requestId as string);
		expect(useStore.getState().statePatchPending).toEqual({});
	});
});
