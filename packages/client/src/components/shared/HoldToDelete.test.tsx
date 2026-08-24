import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoldToDelete } from "./HoldToDelete";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("HoldToDelete", () => {
	it("confirms only after the hold duration", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		HTMLElement.prototype.setPointerCapture = vi.fn();
		const onConfirm = vi.fn();
		render(
			<HoldToDelete
				label="Hold to delete"
				onConfirm={onConfirm}
				onCancel={vi.fn()}
			/>,
		);

		const hold = screen.getByRole("button", { name: "Hold to delete" });
		fireEvent.pointerDown(hold, { pointerId: 1 });
		frames.shift()?.(0);
		frames.shift()?.(700);

		expect(onConfirm).toHaveBeenCalledOnce();
		fireEvent.pointerUp(hold);
	});
});
