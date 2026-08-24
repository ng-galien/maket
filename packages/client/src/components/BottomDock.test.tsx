import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomDock, BottomDockResizeHandle } from "./BottomDock";

afterEach(cleanup);

describe("BottomDockResizeHandle", () => {
	it("provides the shared surface and resize boundary", () => {
		render(
			<BottomDock
				data-testid="data-dock"
				height={280}
				resize={{
					height: 280,
					setHeight: vi.fn(),
					storageKey: "test-shared-dock",
					label: "Resize shared dock",
				}}
			>
				<div>Dock content</div>
			</BottomDock>,
		);

		const dock = screen.getByTestId("data-dock");
		expect(dock).toHaveStyle({ height: "280px" });
		expect(dock).toHaveClass("border-t", "bg-panel");
		expect(
			screen.getByRole("separator", { name: "Resize shared dock" }),
		).toBeVisible();
	});

	it("shares the restrained accent feedback used by the library resize", () => {
		const setHeight = vi.fn();
		render(
			<BottomDockResizeHandle
				height={320}
				setHeight={setHeight}
				storageKey="test-dock-height"
				label="Resize data panel"
			/>,
		);
		const resize = screen.getByRole("separator", {
			name: "Resize data panel",
		});
		const guide = resize.querySelector("[data-resize-guide]");
		const grip = resize.querySelector("[data-resize-grip]");

		expect(guide).toHaveClass("opacity-0");
		expect(grip).toHaveClass("h-px", "w-12", "bg-text-3/45");

		fireEvent.pointerDown(resize, { clientY: 500 });
		expect(resize).toHaveAttribute("data-resizing", "true");
		expect(guide).toHaveClass("h-[3px]", "opacity-100", "bg-accent/35");
		expect(grip).toHaveClass("h-[5px]", "w-16", "bg-accent/80");

		fireEvent.pointerMove(window, { clientY: 480 });
		expect(setHeight).toHaveBeenCalledWith(340);

		fireEvent.pointerUp(window);
		expect(resize).not.toHaveAttribute("data-resizing");
		expect(guide).toHaveClass("opacity-0");
	});
});
