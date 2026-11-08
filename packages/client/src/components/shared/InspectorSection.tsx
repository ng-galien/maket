import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export function InspectorSection({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<details className="group/inspector">
			<summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-sm font-medium text-text-2 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
				<span>{label}</span>
				<ChevronDown
					size={14}
					strokeWidth={1.65}
					aria-hidden="true"
					className="shrink-0 -rotate-90 transition-transform group-open/inspector:rotate-0 motion-reduce:transition-none"
				/>
			</summary>
			<div className="pt-2">{children}</div>
		</details>
	);
}
