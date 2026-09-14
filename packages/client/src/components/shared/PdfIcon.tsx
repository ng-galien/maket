export function PdfIcon({
	size = 20,
	strokeWidth = 1.8,
}: {
	size?: number;
	strokeWidth?: number;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
		>
			<path
				d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinejoin="round"
			/>
			<path
				d="M14 2v6h6"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinejoin="round"
			/>
			<rect x="1" y="11" width="22" height="10" rx="2" fill="currentColor" />
			<text
				x="12"
				y="18.4"
				textAnchor="middle"
				fontFamily="Arial, sans-serif"
				fontSize="8"
				fontWeight="700"
				fill="var(--color-panel)"
			>
				PDF
			</text>
		</svg>
	);
}
