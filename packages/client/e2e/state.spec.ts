import { expect, openWorkspace, test } from "./workspace-test";

test.describe("Living document state", () => {
	test("persists initially absent optional JSON Forms values", async ({
		mcp,
		page,
	}) => {
		const docName = "Optional form journey";
		await openWorkspace(page);
		await mcp.call("maket_doc", {
			action: "new",
			doc: docName,
			format: "A4",
			orientation: "portrait",
		});
		await mcp.call("maket_state", {
			action: "init",
			doc: docName,
			schema: {
				type: "object",
				properties: {
					title: { type: "string", title: "Title" },
					enabled: { type: "boolean", title: "Enabled" },
					count: { type: "number", title: "Count" },
					phase: { type: "string", title: "Phase", enum: ["draft", "ready"] },
				},
			},
			data: {},
		});
		await mcp.call("maket_page", {
			action: "set_form",
			doc: docName,
			page: 1,
			json_forms: {},
		});
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});
		await page
			.getByRole("button", {
				name: /Open document state|Ouvrir l’état du document/i,
			})
			.click();
		const form = page.locator(`[data-doc="${docName}"] .maket-json-forms`);
		const data = async () =>
			(
				await mcp.callJson<{ current: { data: Record<string, unknown> } }>(
					"maket_state",
					{ action: "get", doc: docName },
				)
			).current.data;
		const title = form.locator('[data-maket-path="/title"]');
		await title.fill("New title");
		await title.press("Enter");
		await expect.poll(data).toEqual({ title: "New title" });
		await form.locator('[data-maket-path="/enabled"]').check();
		await expect.poll(data).toEqual({ title: "New title", enabled: true });
		const count = form.locator('[data-maket-path="/count"]');
		await count.fill("3");
		await count.press("Tab");
		await expect
			.poll(data)
			.toEqual({ title: "New title", enabled: true, count: 3 });
		await form.locator('[data-maket-path="/phase"]').click();
		await page
			.getByRole("listbox")
			.getByRole("option", { name: "ready", exact: true })
			.click();
		await expect
			.poll(data)
			.toEqual({ title: "New title", enabled: true, count: 3, phase: "ready" });
	});

	test("applies charte styling to a JSON Forms page", async ({ mcp, page }) => {
		const docName = "Styled JSON form";
		const charteName = "Form style";
		await mcp.call("maket_charte", {
			action: "set",
			name: charteName,
			description: "JSON Forms end to end style",
			tokens: {
				color: {
					text: "#123456",
					bg: "#fef3c7",
					surface: "#fff7ed",
					line: "#334155",
					primary: "#be123c",
					muted: "#64748b",
				},
				font: { body: "monospace" },
			},
			voice: { personality: ["clear"] },
			rules: {},
		});
		await mcp.call("maket_doc", {
			action: "new",
			doc: docName,
			format: "A4",
			orientation: "portrait",
			charte: charteName,
		});
		await mcp.call("maket_state", {
			action: "init",
			doc: docName,
			schema: {
				type: "object",
				properties: {
					title: { type: "string", title: "Title" },
					enabled: { type: "boolean", title: "Enabled" },
				},
				required: ["title", "enabled"],
			},
			data: { title: "Styled value", enabled: true },
		});
		await mcp.call("maket_page", {
			action: "set_form",
			doc: docName,
			page: 1,
			json_forms: {
				uischema: {
					type: "Group",
					label: "Styled group",
					elements: [
						{ type: "Control", scope: "#/properties/title" },
						{ type: "Control", scope: "#/properties/enabled" },
					],
				},
			},
		});

		await openWorkspace(page);
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});

		const document = page.locator(`[data-doc="${docName}"]`);
		const form = document.locator(".maket-json-forms");
		const group = form.locator(".maket-json-forms__group");
		const title = form.locator('[data-maket-path="/title"]');
		const enabled = form.locator('[data-maket-path="/enabled"]');
		await expect(title).toHaveValue("Styled value");
		await expect(enabled).toBeChecked();

		expect(
			await form.evaluate((node) => {
				const style = getComputedStyle(node);
				return {
					color: style.color,
					background: style.backgroundColor,
					font: style.fontFamily,
				};
			}),
		).toEqual({
			color: "rgb(18, 52, 86)",
			background: "rgb(254, 243, 199)",
			font: "monospace",
		});
		expect(
			await group.evaluate((node) => getComputedStyle(node).borderColor),
		).toBe("rgb(51, 65, 85)");
		expect(
			await title.evaluate((node) => getComputedStyle(node).backgroundColor),
		).toBe("rgb(255, 247, 237)");
		expect(
			await enabled.evaluate((node) => getComputedStyle(node).accentColor),
		).toBe("rgb(190, 18, 60)");
		await title.focus();
		expect(
			await title.evaluate((node) => getComputedStyle(node).outlineColor),
		).toBe("rgb(190, 18, 60)");
	});

	test("keeps MCP revisions, live controls and bundle import in sync", async ({
		mcp,
		page,
	}) => {
		const docName = "Agent launch checklist";
		const bundleName = "agent-launch-checklist.maket";
		await openWorkspace(page);
		await mcp.call("maket_doc", {
			action: "new",
			doc: docName,
			format: "A4",
			orientation: "portrait",
		});
		await mcp.call("maket_html", {
			action: "set",
			doc: docName,
			page: 1,
			html: [
				'<main data-id="checklist" style="width:210mm;height:297mm;padding:20mm">',
				'<h1 data-id="title">{{ state.title }}</h1>',
				'<label data-id="done-label">',
				'<input data-id="done-input" aria-label="Approved" type="checkbox" data-maket-bind="state.done">',
				"Approved</label>",
				'<label data-id="owner-label">Owner',
				'<input data-id="owner-input" aria-label="Owner" type="text" data-maket-bind="state.owner">',
				"</label>",
				"</main>",
			].join(""),
		});
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});
		await mcp.call("maket_state", {
			action: "init",
			doc: docName,
			schema: {
				type: "object",
				properties: {
					title: { type: "string" },
					done: { type: "boolean" },
					owner: { type: "string" },
				},
				required: ["title", "done", "owner"],
			},
			data: {
				title: "Launch checklist",
				done: false,
				owner: "Camille",
			},
		});

		const document = page.locator(`[data-doc="${docName}"]`);
		const approved = document.getByRole("checkbox", { name: "Approved" });
		const owner = document.getByRole("textbox", { name: "Owner" });
		await expect(
			document.getByRole("heading", { name: "Launch checklist" }),
		).toBeVisible();
		await expect(approved).not.toBeChecked();
		await expect(owner).toHaveValue("Camille");
		await page
			.getByRole("button", {
				name: /Open document state|Ouvrir l’état du document/i,
			})
			.click();
		await expect(
			page.getByRole("button", { name: /^(Live)$/i }),
		).toHaveAttribute("aria-pressed", "true");

		await mcp.call("maket_state", {
			action: "patch",
			doc: docName,
			expected_revision: 1,
			patch: [
				{ op: "replace", path: "/title", value: "Launch approved" },
				{ op: "replace", path: "/done", value: true },
			],
		});
		await expect(document.getByText("Launch approved")).toBeVisible();
		await expect(approved).toBeChecked();

		await owner.fill("Nora");
		await owner.press("Enter");
		await expect(owner).toHaveValue("Nora");
		await expect
			.poll(async () => {
				const state = await mcp.callJson<{
					current: { revision: number; data: Record<string, unknown> };
				}>("maket_state", { action: "get", doc: docName });
				return state.current;
			})
			.toMatchObject({ revision: 3, data: { owner: "Nora" } });

		const history = await mcp.callText("maket_state", {
			action: "history",
			doc: docName,
		});
		expect(history).toContain("revision 3");
		expect(history).toContain("revision 1");
		await mcp.call("maket_state", {
			action: "restore",
			doc: docName,
			revision: 1,
			expected_revision: 3,
		});
		await expect(
			document.getByRole("heading", { name: "Launch checklist" }),
		).toBeVisible();
		await expect(approved).not.toBeChecked();
		await expect(owner).toHaveValue("Camille");

		await mcp.call("maket_doc", {
			action: "export",
			docs: [docName],
			output: bundleName,
		});
		await mcp.call("maket_doc", {
			action: "new",
			doc: "Keep state import workspace alive",
			format: "A4",
			orientation: "portrait",
		});
		await mcp.call("maket_doc", { action: "delete", doc: docName });
		await expect(document).toHaveCount(0);
		await mcp.call("maket_doc", {
			action: "import",
			input: bundleName,
		});
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});

		const imported = page.locator(`[data-doc="${docName}"]`);
		await expect(
			imported.getByRole("heading", { name: "Launch checklist" }),
		).toBeVisible();
		await expect(imported.getByRole("textbox", { name: "Owner" })).toHaveValue(
			"Camille",
		);
		const importedState = await mcp.callJson<{
			current: { revision: number; data: Record<string, unknown> };
		}>("maket_state", { action: "get", doc: docName });
		expect(importedState.current).toMatchObject({
			revision: 1,
			data: { title: "Launch checklist", done: false, owner: "Camille" },
		});
		const importedHistory = await mcp.callText("maket_state", {
			action: "history",
			doc: docName,
		});
		expect(importedHistory.match(/revision /g)).toHaveLength(1);
	});
});
