/**
 * /demo.html — an honest replay of a recorded Maket session, rendered by the
 * real Board/PageCanvas stack in readOnly mode. A visible playback bar makes
 * the format explicit; the real interactivity is browsing the board and
 * downloading the resulting bundle.
 */

import { ChevronLeft, ChevronRight, Download, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Board } from "../components/Board";
import { useStore } from "../store/useStore";
import { fitToView } from "../store/zoomBridge";
import { hydrateViewerWorkspace } from "../viewer/hydrate";
import { downloadWorkspaceBundle } from "./export";
import {
	type DemoScenario,
	type DemoWorkspace,
	productCatalogScenario,
} from "./scenario";

const STEP_MS = 3800;
const EMPTY: DemoWorkspace = { documents: [], chartes: [], collections: [] };

function lastWorkspaceAt(
	scenario: DemoScenario,
	stepIndex: number,
): DemoWorkspace {
	for (let i = stepIndex; i >= 0; i--) {
		const workspace = scenario.steps[i]?.workspace;
		if (workspace) return workspace;
	}
	return EMPTY;
}

function applyStep(scenario: DemoScenario, stepIndex: number): void {
	const step = scenario.steps[stepIndex];
	if (!step) return;
	const workspace = lastWorkspaceAt(scenario, stepIndex);
	hydrateViewerWorkspace({
		version: 2,
		documents: workspace.documents,
		chartes: workspace.chartes,
		collections: workspace.collections,
		assetUrls: new Map(),
	});
	const docName = workspace.documents[0]?.name;
	if (step.notes && docName) {
		useStore.setState({
			pending: step.notes.map((note, i) => ({
				id: `demo-note-${i}`,
				type: "note" as const,
				elementId: note.elementId,
				text: note.text,
				docName,
				ts: Date.now(),
			})),
		});
	}
	if (step.collectionMode) {
		for (const collection of workspace.collections) {
			useStore
				.getState()
				.setCollectionPreviewMode(collection.name, step.collectionMode);
		}
	}
	requestAnimationFrame(() => requestAnimationFrame(() => fitToView()));
}

export default function DemoApp() {
	const scenario = productCatalogScenario;
	const [stepIndex, setStepIndex] = useState(0);
	const [playing, setPlaying] = useState(true);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const darkMode = useStore((s) => s.darkMode);
	const step = scenario.steps[stepIndex];
	const isLast = stepIndex === scenario.steps.length - 1;

	useEffect(() => {
		document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
	}, [darkMode]);

	useEffect(() => {
		applyStep(scenario, stepIndex);
	}, [scenario, stepIndex]);

	useEffect(() => {
		if (!playing) return;
		timerRef.current = setInterval(() => {
			setStepIndex((i) => {
				if (i >= scenario.steps.length - 1) {
					setPlaying(false);
					return i;
				}
				return i + 1;
			});
		}, STEP_MS);
		return () => {
			if (timerRef.current) clearInterval(timerRef.current);
		};
	}, [playing, scenario.steps.length]);

	const goTo = useCallback((i: number) => {
		setPlaying(false);
		setStepIndex(i);
	}, []);

	const download = useCallback(() => {
		downloadWorkspaceBundle(
			lastWorkspaceAt(scenario, scenario.steps.length - 1),
			scenario.downloadName,
		);
	}, [scenario]);

	return (
		<div className="relative h-full w-full">
			<Board locked={false} />

			{/* Caption bar */}
			<div className="fixed top-4 left-1/2 z-50 w-[min(640px,92vw)] -translate-x-1/2">
				<div className="rounded-2xl border border-border bg-panel px-5 py-3 shadow-lg">
					<div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-text-3">
						<span
							className={`inline-block h-2 w-2 rounded-full ${
								step?.actor === "user"
									? "bg-accent"
									: step?.actor === "agent"
										? "bg-warning"
										: "bg-text-3"
							}`}
						/>
						{step?.actor === "user"
							? "You"
							: step?.actor === "agent"
								? "Your agent"
								: "Maket"}
						<span className="ml-auto normal-case tracking-normal font-medium">
							Replayed session · step {stepIndex + 1}/{scenario.steps.length}
						</span>
					</div>
					<div data-testid="demo-caption" className="mt-1 text-sm text-text-1">
						{step?.caption}
					</div>
				</div>
			</div>

			{/* Playback bar */}
			<div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-panel px-4 py-2 shadow-lg">
				<span className="mr-1 text-sm font-bold text-text-1">Maket demo</span>
				<button
					type="button"
					title="Previous step"
					aria-label="Previous step"
					disabled={stepIndex === 0}
					onClick={() => goTo(Math.max(0, stepIndex - 1))}
					className="flex h-7 w-7 items-center justify-center rounded-full text-text-2 hover:bg-border/50 disabled:opacity-35"
				>
					<ChevronLeft size={15} />
				</button>
				<button
					type="button"
					title={playing ? "Pause" : "Play"}
					aria-label={playing ? "Pause" : "Play"}
					onClick={() => setPlaying((p) => !p)}
					className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white"
				>
					{playing ? <Pause size={14} /> : <Play size={14} />}
				</button>
				<button
					type="button"
					title="Next step"
					aria-label="Next step"
					disabled={isLast}
					onClick={() =>
						goTo(Math.min(scenario.steps.length - 1, stepIndex + 1))
					}
					className="flex h-7 w-7 items-center justify-center rounded-full text-text-2 hover:bg-border/50 disabled:opacity-35"
				>
					<ChevronRight size={15} />
				</button>
				<div className="mx-1 flex items-center gap-1.5">
					{scenario.steps.map((s, i) => (
						<button
							key={s.id}
							type="button"
							aria-label={`Step ${i + 1}`}
							onClick={() => goTo(i)}
							className={`h-1.5 rounded-full transition-all ${
								i === stepIndex ? "w-5 bg-accent" : "w-1.5 bg-border"
							}`}
						/>
					))}
				</div>
				<button
					type="button"
					onClick={download}
					className="ml-1 flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white"
				>
					<Download size={13} />
					<span>.maket</span>
				</button>
			</div>
		</div>
	);
}
