/**
 * /demo.html — an honest replay of a recorded Maket session, rendered by the
 * real Board/PageCanvas stack in readOnly mode. A visible playback bar makes
 * the format explicit; the real interactivity is browsing the board and
 * downloading the resulting bundle.
 */

import { ChevronLeft, ChevronRight, Download, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Board } from "../components/Board";
import { useStore } from "../store/useStore";
import { fitToDoc, fitToView } from "../store/zoomBridge";
import { hydrateViewerWorkspace } from "../viewer/hydrate";
import { downloadWorkspaceBundle } from "./export";
import {
	type DemoScenario,
	finalWorkspace,
	productCatalogScenario,
	workspaceAt,
} from "./scenario";
import { bistroMenuScenario } from "./scenario-menu";
import { eventPosterScenario } from "./scenario-poster";
import { socialSeriesScenario } from "./scenario-social";
import { appWireframeScenario } from "./scenario-wireframe";

const SCENARIOS: DemoScenario[] = [
	productCatalogScenario,
	eventPosterScenario,
	appWireframeScenario,
	bistroMenuScenario,
	socialSeriesScenario,
];

const STEP_MS = 3800;

function applyStep(scenario: DemoScenario, stepIndex: number): void {
	const step = scenario.steps[stepIndex];
	if (!step) return;
	const workspace = workspaceAt(scenario, stepIndex);
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
}

export default function DemoApp() {
	const [scenarioId, setScenarioId] = useState<string>(() => {
		const requested = new URLSearchParams(location.search).get("scenario");
		return SCENARIOS.some((s) => s.id === requested) && requested
			? requested
			: productCatalogScenario.id;
	});
	const scenario =
		SCENARIOS.find((s) => s.id === scenarioId) ?? productCatalogScenario;
	const [stepIndex, setStepIndex] = useState(0);
	const [playing, setPlaying] = useState(true);
	const darkMode = useStore((s) => s.darkMode);
	const step = scenario.steps[stepIndex];
	const isLast = stepIndex === scenario.steps.length - 1;

	useEffect(() => {
		document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
	}, [darkMode]);

	useEffect(() => {
		applyStep(scenario, stepIndex);
		const current = scenario.steps[stepIndex];
		const docName = workspaceAt(scenario, stepIndex).documents[0]?.name;
		const frame = () => {
			if (typeof current?.focusPage === "number" && docName) {
				fitToDoc(docName, current.focusPage);
			} else {
				fitToView();
			}
		};
		// Fit twice: once after the next paint, and again once React has
		// committed the hydrated content — a single early fit can measure the
		// previous step's board and leave the view mis-framed. Both are
		// cancelled on the next step (or unmount) so a stale fit never stomps
		// a user's pan/zoom.
		let raf2 = 0;
		const raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(frame);
		});
		const settle = setTimeout(frame, 250);
		return () => {
			cancelAnimationFrame(raf1);
			cancelAnimationFrame(raf2);
			clearTimeout(settle);
		};
	}, [scenario, stepIndex]);

	useEffect(() => {
		if (!playing) return;
		const timer = setInterval(() => {
			setStepIndex((i) => {
				if (i >= scenario.steps.length - 1) {
					setPlaying(false);
					return i;
				}
				return i + 1;
			});
		}, STEP_MS);
		return () => clearInterval(timer);
	}, [playing, scenario]);

	const goTo = useCallback((i: number) => {
		setPlaying(false);
		setStepIndex(i);
	}, []);

	const pickScenario = useCallback((id: string) => {
		setScenarioId(id);
		setStepIndex(0);
		setPlaying(true);
	}, []);

	const download = useCallback(() => {
		downloadWorkspaceBundle(finalWorkspace(scenario), scenario.downloadName);
	}, [scenario]);

	return (
		<div className="relative h-full w-full">
			{/* Constrained between the caption and playback bars so fitToView
			    frames documents in the actually visible band. */}
			<div className="absolute inset-x-0 top-32 bottom-20">
				<Board locked={false} />
			</div>

			{/* Caption bar */}
			<div className="fixed top-4 left-1/2 z-50 w-[min(640px,92vw)] -translate-x-1/2">
				<div className="rounded-2xl border border-border bg-panel px-5 py-3 shadow-lg">
					<div className="mb-2 flex gap-1.5">
						{SCENARIOS.map((s) => (
							<button
								key={s.id}
								type="button"
								onClick={() => pickScenario(s.id)}
								className={`rounded-full px-2.5 py-1 text-2xs font-semibold transition-colors ${
									s.id === scenario.id
										? "bg-accent text-white"
										: "bg-input text-text-2 hover:text-text-1"
								}`}
							>
								{s.title}
							</button>
						))}
					</div>
					<div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-text-3">
						<span
							className={`inline-block h-2 w-2 rounded-full ${
								step?.actor === "user"
									? "bg-text-1"
									: step?.actor === "agent"
										? "bg-accent"
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
				<input
					type="range"
					min={0}
					max={scenario.steps.length - 1}
					step={1}
					value={stepIndex}
					aria-label="Timeline"
					onChange={(e) => goTo(Number(e.target.value))}
					className="mx-1 w-44 cursor-pointer"
					style={{ accentColor: "var(--color-accent)" }}
				/>
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
