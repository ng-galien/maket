/**
 * /demo.html — an honest replay of a recorded Maket session, rendered by the
 * real Board/PageCanvas stack in readOnly mode. A visible playback bar makes
 * the format explicit; the real interactivity is browsing the board and
 * downloading the resulting bundle.
 */

import { ChevronLeft, ChevronRight, Download, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Board } from "../components/Board";
import { applyColorScheme } from "../lib/colorScheme";
import { useStore } from "../store/useStore";
import { requestFit } from "../store/zoomBridge";
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
import { livingChecklistScenario } from "./scenario-state";
import { appWireframeScenario } from "./scenario-wireframe";

const SCENARIOS: DemoScenario[] = [
	productCatalogScenario,
	eventPosterScenario,
	appWireframeScenario,
	bistroMenuScenario,
	socialSeriesScenario,
	livingChecklistScenario,
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
		documentStates: workspace.documentStates ?? {},
		assetUrls: new Map(),
	});
	const docName = workspace.documents[0]?.name;
	if (step.notes && docName) {
		useStore.setState({
			pending: step.notes.map((note, i) => ({
				id: `demo-note-${i}`,
				type: "note" as const,
				elementId: note.elementId,
				pageIndex: 0,
				text: note.text,
				docName,
				ts: Date.now(),
			})),
		});
	}
	if (step.collectionMode) {
		seedDemoCursors(workspace, step.collectionMode);
	}
}

/** Offline viewer: no server owns the cursors here, so seed the mirror
 * directly with one cursor per bound page. */
function seedDemoCursors(
	workspace: ReturnType<typeof workspaceAt>,
	mode: NonNullable<DemoScenario["steps"][number]["collectionMode"]>,
): void {
	useStore.getState().setCollectionCursors(
		workspace.documents.flatMap((doc) =>
			doc.pages.flatMap((page, pageIndex) => {
				const collection = workspace.collections.find(
					(item) => item.name === page.collection?.name,
				);
				if (!collection) return [];
				const [first] = [...collection.members].sort(
					(a, b) => a.position - b.position,
				);
				return [
					{
						docName: doc.name,
						pageIndex,
						collection: collection.name,
						mode,
						memberId: first?.id ?? null,
					},
				];
			}),
		),
	);
}

function useDemoPlayback() {
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
		applyColorScheme(darkMode);
	}, [darkMode]);

	useEffect(() => {
		applyStep(scenario, stepIndex);
		const current = scenario.steps[stepIndex];
		const docName = workspaceAt(scenario, stepIndex).documents[0]?.name;
		if (typeof current?.focusPage === "number" && docName) {
			requestFit({ docName, pageIndex: current.focusPage });
		} else {
			requestFit();
		}
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

	return {
		download,
		goTo,
		isLast,
		pickScenario,
		playing,
		scenario,
		setPlaying,
		step,
		stepIndex,
	};
}

function DemoCaption({
	scenario,
	stepIndex,
	onPickScenario,
}: {
	scenario: DemoScenario;
	stepIndex: number;
	onPickScenario: (id: string) => void;
}) {
	const step = scenario.steps[stepIndex];
	return (
		<div className="fixed top-4 left-1/2 z-50 w-[min(640px,92vw)] -translate-x-1/2">
			<div className="rounded-2xl border border-border bg-panel px-5 py-3 shadow-lg">
				<div className="mb-2 flex flex-wrap gap-1.5">
					{SCENARIOS.map((candidate) => (
						<button
							key={candidate.id}
							type="button"
							onClick={() => onPickScenario(candidate.id)}
							className={`rounded-full px-2.5 py-1 text-2xs font-semibold transition-colors ${
								candidate.id === scenario.id
									? "bg-accent text-accent-contrast"
									: "bg-input text-text-2 hover:text-text-1"
							}`}
						>
							{candidate.title}
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
	);
}

function PlaybackBar({
	scenario,
	stepIndex,
	playing,
	isLast,
	onGoTo,
	onTogglePlaying,
	onDownload,
}: {
	scenario: DemoScenario;
	stepIndex: number;
	playing: boolean;
	isLast: boolean;
	onGoTo: (index: number) => void;
	onTogglePlaying: () => void;
	onDownload: () => void;
}) {
	return (
		<div className="fixed right-2 bottom-2 left-2 z-50 flex items-center justify-center gap-2 rounded-full border border-border bg-panel px-3 py-2 shadow-lg sm:right-auto sm:bottom-4 sm:left-1/2 sm:w-auto sm:-translate-x-1/2 sm:px-4">
			<span className="mr-1 hidden text-sm font-bold text-text-1 sm:inline">
				Maket demo
			</span>
			<button
				type="button"
				title="Previous step"
				aria-label="Previous step"
				disabled={stepIndex === 0}
				onClick={() => onGoTo(Math.max(0, stepIndex - 1))}
				className="flex h-7 w-7 items-center justify-center rounded-full text-text-2 hover:bg-border/50 disabled:opacity-35"
			>
				<ChevronLeft size={15} />
			</button>
			<button
				type="button"
				title={playing ? "Pause" : "Play"}
				aria-label={playing ? "Pause" : "Play"}
				onClick={onTogglePlaying}
				className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-contrast"
			>
				{playing ? <Pause size={14} /> : <Play size={14} />}
			</button>
			<button
				type="button"
				title="Next step"
				aria-label="Next step"
				disabled={isLast}
				onClick={() =>
					onGoTo(Math.min(scenario.steps.length - 1, stepIndex + 1))
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
				onChange={(event) => onGoTo(Number(event.target.value))}
				className="mx-1 min-w-20 flex-1 cursor-pointer sm:w-44 sm:flex-none"
				style={{ accentColor: "var(--color-accent)" }}
			/>
			<button
				type="button"
				onClick={onDownload}
				className="ml-1 flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast"
			>
				<Download size={13} />
				<span className="hidden min-[360px]:inline">.maket</span>
			</button>
		</div>
	);
}

export default function DemoApp() {
	const playback = useDemoPlayback();
	return (
		<div className="relative h-full w-full">
			<div className="absolute inset-x-0 top-40 bottom-20 sm:top-32">
				<Board locked={false} />
			</div>
			<DemoCaption
				scenario={playback.scenario}
				stepIndex={playback.stepIndex}
				onPickScenario={playback.pickScenario}
			/>
			<PlaybackBar
				scenario={playback.scenario}
				stepIndex={playback.stepIndex}
				playing={playback.playing}
				isLast={playback.isLast}
				onGoTo={playback.goTo}
				onTogglePlaying={() =>
					playback.setPlaying((currentlyPlaying) => !currentlyPlaying)
				}
				onDownload={playback.download}
			/>
		</div>
	);
}
