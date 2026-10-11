import { expect, openWorkspace, test } from "./workspace-test";

test("replaces embedded questions, retains answers and reopens a portable document", async ({
	mcp,
	page,
}) => {
	const doc = "Embedded refinement";
	await openWorkspace(page);
	await mcp.call("maket_doc", {
		action: "new",
		doc,
		format: "A4",
		orientation: "portrait",
	});
	await mcp.call("maket_state", {
		action: "init",
		doc,
		schema: {
			type: "object",
			properties: {
				subject: { type: "string" },
				answers: { type: "array", items: { type: "string" } },
				audience: { type: "string", enum: ["Developers", "Managers"] },
				note: { type: "string" },
				confirmed: { type: "boolean" },
			},
		},
		data: {
			subject: "Portfolio",
			answers: [],
			audience: "Developers",
			note: "",
			confirmed: false,
		},
	});
	const html =
		'<main data-id="main"><h1 data-id="title">{{ state.subject }}</h1><ol data-id="history">{{#state.answers}}<li>{{ . }}</li>{{/state.answers}}</ol><section data-id="question"><!--maket-json-form--></section></main>';
	await mcp.call("maket_html", { action: "set", doc, page: 1, html });
	const setForm = (property: string, options = {}) =>
		mcp.call("maket_page", {
			action: "set_form",
			doc,
			page: 1,
			json_forms: {
				uischema: {
					type: "Control",
					scope: `#/properties/${property}`,
					options,
				},
			},
		});
	await setForm("audience", { format: "radio" });
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	await page
		.getByRole("button", {
			name: /Open document state|Ouvrir l’état du document/i,
		})
		.click();
	const canvas = page.locator(`[data-doc="${doc}"]`);
	const current = () =>
		mcp.callJson<{
			current: { revision: number; data: Record<string, unknown> };
		}>("maket_state", { action: "get", doc });
	await canvas.getByRole("radio", { name: "Managers", exact: true }).check();
	await expect
		.poll(async () => (await current()).current.data.audience)
		.toBe("Managers");
	await mcp.call("maket_state", {
		action: "patch",
		doc,
		expected_revision: (await current()).current.revision,
		patch: [{ op: "replace", path: "/answers", value: ["Managers"] }],
	});
	await setForm("note", { multi: true });
	await expect(canvas.getByRole("radio")).toHaveCount(0);
	await expect(canvas.getByRole("listitem")).toHaveText("Managers");
	await canvas.getByRole("textbox").fill("Show useful outcomes");
	await canvas.getByRole("textbox").press("Tab");
	await expect
		.poll(async () => (await current()).current.data.note)
		.toBe("Show useful outcomes");
	await mcp.call("maket_state", {
		action: "patch",
		doc,
		expected_revision: (await current()).current.revision,
		patch: [
			{
				op: "replace",
				path: "/answers",
				value: ["Managers", "Show useful outcomes"],
			},
		],
	});
	await setForm("confirmed");
	await expect(canvas.getByRole("listitem")).toHaveText([
		"Managers",
		"Show useful outcomes",
	]);
	await canvas.getByRole("checkbox").check();
	await expect
		.poll(async () => (await current()).current.data.confirmed)
		.toBe(true);
	await mcp.callError("maket_page", {
		action: "set_form",
		doc,
		page: 1,
		json_forms: {
			uischema: { type: "Control", scope: "#/properties/missing" },
		},
	});
	await expect(canvas.getByRole("checkbox")).toBeChecked();
	const bundle = "embedded-form-roundtrip.maket";
	await mcp.call("maket_doc", {
		action: "export",
		docs: [doc],
		output: bundle,
	});
	await mcp.call("maket_doc", {
		action: "new",
		doc: "Keep workspace",
		format: "A4",
		orientation: "portrait",
	});
	await mcp.call("maket_doc", { action: "delete", doc });
	await mcp.call("maket_doc", { action: "import", input: bundle });
	await mcp.call("maket_workspace", { action: "focus", doc, page: 1 });
	await page.reload();
	await expect(
		canvas.getByRole("heading", { name: "Portfolio" }),
	).toBeVisible();
	await expect(canvas.getByRole("listitem")).toHaveText([
		"Managers",
		"Show useful outcomes",
	]);
	await expect(canvas.getByRole("checkbox")).toBeChecked();
});
