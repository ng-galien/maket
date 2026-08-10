import { describe, expect, it } from "vitest";
import { presentationPolicy } from "./presentation-policy";

describe("presentationPolicy", () => {
	it("keeps authoring exclusive to a writable connected canvas", () => {
		expect(
			presentationPolicy({
				surface: "canvas",
				dataSource: "connected",
				access: "writable",
			}),
		).toMatchObject({
			authoring: true,
			stateRepresentation: "canvas",
			stateControls: "persist",
			showGuides: true,
			showDiagnostics: true,
			showPendingMarkers: true,
			showPreviewOutline: true,
		});
	});

	it.each([
		["writable", "persist"],
		["locked", "disabled"],
	] as const)(
		"makes a connected reader passive while resolving state controls for %s access",
		(access, stateControls) => {
			expect(
				presentationPolicy({
					surface: "reader",
					dataSource: "connected",
					access,
				}),
			).toMatchObject({
				authoring: false,
				stateRepresentation: "live",
				stateControls,
				showGuides: false,
				showDiagnostics: false,
				showPendingMarkers: false,
				showPreviewOutline: false,
			});
		},
	);

	it("allows local-only state controls in the static reader", () => {
		expect(
			presentationPolicy({
				surface: "reader",
				dataSource: "static",
				access: "read-only",
			}),
		).toMatchObject({ authoring: false, stateControls: "local" });
	});
});
