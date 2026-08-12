import { expect, openWorkspace, test } from "./workspace-test";

test.describe("Living document state", () => {
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
