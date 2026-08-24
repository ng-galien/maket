import type {
	DesktopConfigurationAction,
	DesktopConfigurationPlan,
	DesktopOnboardingActionResult,
} from "@maket/shared";
import {
	AlertCircle,
	Check,
	CircleDashed,
	ExternalLink,
	LoaderCircle,
	Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
	applyDesktopOnboarding,
	useDesktopConfiguration,
	verifyDesktopOnboarding,
} from "../desktopConfiguration";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";

interface OnboardingAction {
	id: DesktopConfigurationAction;
	label: string;
	detail: string;
	required: boolean;
	disabled: boolean;
}

interface OnboardingViewState {
	applying: boolean;
	awaitingClaude: boolean;
	error: string | null;
}

// This root composes the configuration store, async actions, and dedicated view components.
// code-moniker: ignore[smell-feature-envy-local]
export function DesktopOnboarding() {
	const t = useT();
	const configuration = useDesktopConfiguration();
	const actions = onboardingActions(configuration.plan, t);
	const actionSignature = actions
		.map((action) => `${action.id}:${action.disabled}`)
		.join("|");
	const [selected, setSelected] = useState<Set<DesktopConfigurationAction>>(
		new Set(),
	);
	const [results, setResults] = useState<DesktopOnboardingActionResult[]>([]);
	const [verificationMessage, setVerificationMessage] = useState<string | null>(
		null,
	);

	useEffect(() => {
		setSelected(
			new Set(
				actions.filter((action) => !action.disabled).map((action) => action.id),
			),
		);
	}, [actionSignature]);

	const applying =
		configuration.status === "applying" || configuration.status === "loading";
	const awaitingClaude =
		configuration.plan?.awaitingClaudeDesktop === true ||
		results.some((result) => result.status === "confirmation-required");

	const apply = async () => {
		setResults([]);
		setVerificationMessage(null);
		try {
			const result = await applyDesktopOnboarding({
				actions: actions
					.filter((action) => selected.has(action.id))
					.map((action) => action.id),
			});
			setResults(result.results);
		} catch {}
	};

	const verify = async () => {
		setVerificationMessage(null);
		try {
			const plan = await verifyDesktopOnboarding();
			if (plan.onboardingRequired) {
				setVerificationMessage(t("desktop_onboarding_verification_pending"));
			}
		} catch {}
	};

	return (
		<OnboardingView
			actions={actions}
			selected={selected}
			results={results}
			state={{
				applying,
				awaitingClaude,
				error: configuration.error ?? verificationMessage,
			}}
			onToggle={(action, checked) =>
				setSelected((current) => updateSelection(current, action, checked))
			}
			onApply={() => void apply()}
			onVerify={() => void verify()}
		/>
	);
}

function OnboardingView({
	actions,
	selected,
	results,
	state,
	onToggle,
	onApply,
	onVerify,
}: {
	actions: OnboardingAction[];
	selected: Set<DesktopConfigurationAction>;
	results: DesktopOnboardingActionResult[];
	state: OnboardingViewState;
	onToggle: (action: DesktopConfigurationAction, checked: boolean) => void;
	onApply: () => void;
	onVerify: () => void;
}) {
	return (
		<main
			data-desktop-onboarding
			className="h-full overflow-y-auto bg-app text-text-1"
		>
			<div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-8 py-12 sm:px-12 sm:py-16">
				<OnboardingHeader />
				<OnboardingActionList
					actions={actions}
					selected={selected}
					results={results}
					onToggle={onToggle}
				/>
				<OnboardingError message={state.error} />
				<OnboardingFooter state={state} onApply={onApply} onVerify={onVerify} />
			</div>
		</main>
	);
}

function OnboardingHeader() {
	const t = useT();
	return (
		<header className="border-b border-border pb-8">
			<img src="./favicon.svg" alt="" className="mb-7 h-11 w-11" />
			<p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">
				Maket App
			</p>
			<h1 className="mt-2 text-3xl font-semibold tracking-tight">
				{t("desktop_onboarding_title")}
			</h1>
			<p className="mt-3 max-w-xl text-sm leading-6 text-text-2">
				{t("desktop_onboarding_description")}
			</p>
		</header>
	);
}

function OnboardingActionList({
	actions,
	selected,
	results,
	onToggle,
}: {
	actions: OnboardingAction[];
	selected: Set<DesktopConfigurationAction>;
	results: DesktopOnboardingActionResult[];
	onToggle: (action: DesktopConfigurationAction, checked: boolean) => void;
}) {
	const t = useT();
	return (
		<section aria-labelledby="desktop-onboarding-actions" className="py-3">
			<h2 id="desktop-onboarding-actions" className="sr-only">
				{t("desktop_onboarding_actions")}
			</h2>
			{actions.length === 0 ? (
				<p className="border-b border-border py-6 text-sm text-text-2">
					{t("desktop_onboarding_no_action")}
				</p>
			) : (
				<ul>
					{actions.map((action) => (
						<OnboardingActionRow
							key={action.id}
							action={action}
							checked={selected.has(action.id)}
							result={results.find((result) => result.action === action.id)}
							onChange={(checked) => onToggle(action.id, checked)}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

function OnboardingError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p role="alert" className="mt-3 flex gap-2 text-sm text-danger">
			<AlertCircle className="mt-0.5 shrink-0" size={16} />
			<span>{message}</span>
		</p>
	);
}

function OnboardingFooter({
	state,
	onApply,
	onVerify,
}: {
	state: OnboardingViewState;
	onApply: () => void;
	onVerify: () => void;
}) {
	const t = useT();
	return (
		<footer className="mt-auto flex flex-wrap items-center gap-4 border-t border-border pt-7">
			<button
				type="button"
				disabled={state.applying}
				onClick={state.awaitingClaude ? onVerify : onApply}
				className="inline-flex h-10 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-semibold text-accent-contrast disabled:opacity-60"
			>
				{state.applying ? (
					<LoaderCircle size={16} className="animate-spin" />
				) : state.awaitingClaude ? (
					<Check size={16} />
				) : null}
				{state.awaitingClaude
					? t("desktop_onboarding_verify")
					: state.applying
						? t("desktop_onboarding_applying")
						: t("desktop_onboarding_apply")}
			</button>
			<button
				type="button"
				onClick={() => useStore.getState().toggleSettings()}
				className="inline-flex h-10 items-center gap-2 px-1 text-sm font-semibold text-text-2 hover:text-text-1"
			>
				<Settings size={15} />
				{t("desktop_onboarding_open_settings")}
				<ExternalLink size={13} />
			</button>
		</footer>
	);
}

function updateSelection(
	current: Set<DesktopConfigurationAction>,
	action: DesktopConfigurationAction,
	checked: boolean,
): Set<DesktopConfigurationAction> {
	const next = new Set(current);
	if (checked) next.add(action);
	else next.delete(action);
	return next;
}

function OnboardingActionRow({
	action,
	checked,
	result,
	onChange,
}: {
	action: OnboardingAction;
	checked: boolean;
	result?: DesktopOnboardingActionResult;
	onChange: (checked: boolean) => void;
}) {
	const t = useT();
	return (
		<li className="border-b border-border">
			<label
				className={`flex min-h-20 items-center gap-4 py-4 ${action.disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
			>
				<input
					type="checkbox"
					checked={checked}
					disabled={action.disabled || action.required}
					onChange={(event) => onChange(event.target.checked)}
					className="h-4 w-4 shrink-0 accent-[var(--accent)]"
				/>
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-semibold text-text-1">
						{action.label}
					</span>
					<span className="mt-1 block text-xs leading-5 text-text-2">
						{action.detail}
					</span>
				</span>
				<ActionResult
					result={result}
					fallback={
						action.disabled ? t("desktop_onboarding_manual") : undefined
					}
				/>
			</label>
		</li>
	);
}

function ActionResult({
	result,
	fallback,
}: {
	result?: DesktopOnboardingActionResult;
	fallback?: string;
}) {
	const t = useT();
	if (!result) {
		return fallback ? (
			<span className="shrink-0 text-xs font-medium text-text-3">
				{fallback}
			</span>
		) : null;
	}
	if (result.status === "failed") {
		return (
			<span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-danger">
				<AlertCircle size={14} />
				{t("desktop_onboarding_failed")}
			</span>
		);
	}
	if (result.status === "confirmation-required") {
		return (
			<span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-text-2">
				<CircleDashed size={14} />
				{t("desktop_onboarding_confirmation")}
			</span>
		);
	}
	return (
		<span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-accent">
			<Check size={14} />
			{t("desktop_onboarding_applied")}
		</span>
	);
}

// Translation calls are intentionally localized in the action-model adapter.
// code-moniker: ignore[smell-feature-envy-local]
function onboardingActions(
	plan: DesktopConfigurationPlan | null,
	t: ReturnType<typeof useT>,
): OnboardingAction[] {
	if (!plan) return [];
	const actions: OnboardingAction[] = [];
	if (plan.runtime.status === "action-required") {
		actions.push({
			id: "runtime",
			label: t("desktop_onboarding_runtime"),
			detail: t("desktop_onboarding_runtime_detail"),
			required: true,
			disabled: false,
		});
	}
	for (const finding of plan.findings) {
		if (!finding.detected || finding.status === "valid") continue;
		actions.push({
			id: finding.client,
			label: t("desktop_onboarding_agent", {
				client: agentDisplayName(finding.client),
			}),
			detail: t(
				finding.status === "conflicting"
					? "desktop_onboarding_agent_conflict"
					: "desktop_onboarding_agent_detail",
			),
			required: false,
			disabled: finding.status === "conflicting",
		});
	}
	for (const client of plan.manualClients) {
		if (!client.detected || client.status === "valid") continue;
		actions.push({
			id: "claude-desktop",
			label: t("desktop_onboarding_agent", { client: client.name }),
			detail: t("desktop_onboarding_claude_desktop_detail"),
			required: false,
			disabled: false,
		});
	}
	return actions;
}

function agentDisplayName(client: "claude" | "codex" | "gemini"): string {
	if (client === "claude") return "Claude Code";
	if (client === "codex") return "Codex";
	return "Gemini";
}
