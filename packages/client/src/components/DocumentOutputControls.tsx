import { Printer } from "lucide-react";
import { exportDocumentPdf, printDocument } from "../documentOutput";
import { useT } from "../i18n/useT";
import { AnchoredMenuItem } from "./shared/AnchoredMenu";
import { PdfIcon } from "./shared/PdfIcon";
import {
	READER_ICON_BUTTON_CLASS,
	WORKSPACE_ICON_BUTTON_CLASS,
} from "./shared/toolbarButtonStyles";

export function DocumentOutputMenuItems({
	docName,
	onAction,
}: {
	docName: string;
	onAction: () => void;
}) {
	const t = useT();
	return (
		<>
			<AnchoredMenuItem
				icon={<Printer size={13} />}
				onClick={() => {
					onAction();
					void printDocument(docName);
				}}
			>
				{t("print")}
			</AnchoredMenuItem>
			<AnchoredMenuItem
				icon={<PdfIcon size={13} strokeWidth={2} />}
				onClick={() => {
					onAction();
					void exportDocumentPdf(docName);
				}}
			>
				{t("export_pdf")}
			</AnchoredMenuItem>
		</>
	);
}

export function DocumentOutputButtons({
	docName,
	surface = "workspace",
}: {
	docName: string;
	surface?: "workspace" | "reader";
}) {
	const t = useT();
	const className =
		surface === "reader"
			? `${READER_ICON_BUTTON_CLASS} flex`
			: WORKSPACE_ICON_BUTTON_CLASS;
	const iconSize = surface === "reader" ? 17 : 19;
	return (
		<>
			<button
				type="button"
				onClick={() => void printDocument(docName)}
				title={t("print")}
				aria-label={t("print")}
				className={className}
			>
				<Printer size={iconSize} strokeWidth={1.8} />
			</button>
			<button
				type="button"
				onClick={() => void exportDocumentPdf(docName)}
				title={t("export_pdf")}
				aria-label={t("export_pdf")}
				className={className}
			>
				<PdfIcon size={iconSize} />
			</button>
		</>
	);
}
