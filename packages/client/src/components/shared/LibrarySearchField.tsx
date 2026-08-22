import { Search, X } from "lucide-react";
import { forwardRef } from "react";
import { useT } from "../../i18n/useT";

type AdvancedInputProps = Omit<
	React.InputHTMLAttributes<HTMLInputElement>,
	"className" | "onChange" | "placeholder" | "value"
>;

interface LibrarySearchFieldProps {
	value: string;
	placeholder: string;
	onChange: React.ChangeEventHandler<HTMLInputElement>;
	onClear: () => void;
	inputProps?: AdvancedInputProps;
}

/** Shared visual and interaction base for every library search surface. */
export const LibrarySearchField = forwardRef<
	HTMLInputElement,
	LibrarySearchFieldProps
>(function LibrarySearchField(
	{ value, placeholder, onChange, onClear, inputProps },
	ref,
) {
	const t = useT();
	return (
		<div data-library-search className="relative min-w-0 flex-1">
			<Search
				size={14}
				aria-hidden
				className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3"
			/>
			<input
				{...inputProps}
				ref={ref}
				value={value}
				onChange={onChange}
				placeholder={placeholder}
				aria-label={inputProps?.["aria-label"] ?? placeholder}
				className="h-8 w-full min-w-0 rounded-md bg-input pl-8 pr-8 text-sm text-text-1 outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20"
			/>
			{value && (
				<button
					type="button"
					onMouseDown={(event) => event.preventDefault()}
					onClick={onClear}
					aria-label={t("clear_search")}
					className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-black/[0.06] hover:text-text-1"
				>
					<X size={12} />
				</button>
			)}
		</div>
	);
});
