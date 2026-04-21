import { ExternalLink } from "lucide-react";
import { useT } from "../../i18n/useT";

export interface DraftPillProps {
	kind: "body" | "attachment";
	url: string;
}

export function DraftPill({ kind, url }: DraftPillProps) {
	const t = useT();
	const labelKey = kind === "body" ? "doc_draft_body" : "doc_draft_attachment";
	const ariaKey =
		kind === "body" ? "doc_draft_body_aria" : "doc_draft_attachment_aria";

	return (
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={t(ariaKey)}
			title={t(ariaKey)}
			onClick={(e) => e.stopPropagation()}
			className="group inline-flex items-center gap-1.5 text-2xs font-medium text-text-2 hover:text-accent transition-colors shrink-0"
		>
			<span
				aria-hidden="true"
				className="inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0"
			/>
			<span className="whitespace-nowrap group-hover:underline underline-offset-2 decoration-accent/60">
				{t(labelKey)}
			</span>
			<ExternalLink
				size={10}
				aria-hidden="true"
				className="text-text-3 group-hover:text-accent shrink-0"
			/>
		</a>
	);
}
