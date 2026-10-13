export interface NativePrintOptions {
  silent: false;
  printBackground: true;
  landscape: boolean;
  pageSize: { width: number; height: number };
  margins: { marginType: "none" };
}

export interface NativePrintPdfOptions {
  printBackground: true;
  landscape: false;
  pageSize: { width: number; height: number };
  margins: { top: 0; bottom: 0; left: 0; right: 0 };
}

export interface NativePrintWindow {
  loadURL(url: string): Promise<void>;
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
  once(event: "show", listener: () => void): unknown;
  getParentWindow(): unknown;
  destroy(): void;
  webContents: {
    executeJavaScript(code: string): Promise<{ width: number; height: number }>;
    print(options: NativePrintOptions, callback: (success: boolean, failureReason: string) => void): void;
    printToPDF(options: NativePrintPdfOptions): Promise<Uint8Array>;
  };
}

export interface NativePrintHost {
  platform: NodeJS.Platform;
  createWindow(): NativePrintWindow;
  /** Reason the Linux print dialog cannot be used on this machine, or null when it can. */
  unusableDialogReason(): string | null;
  markDialogPending(): void;
  clearDialogPending(): void;
  /** Writes the PDF, hands it to the system opener and returns its path. */
  openPdf(documentName: string, data: Uint8Array): Promise<string>;
  defer(task: () => void): void;
  log(message: string): void;
}

export type NativePrintOutcome =
  | { status: "printed" }
  | { status: "canceled" }
  | { status: "pdf-fallback"; path: string; reason: string }
  | { status: "failed"; message: string };

const CANCELED = "Print job canceled";
export const SHOW_TIMEOUT_MS = 5000;

export function desktopPrintUrl(baseUrl: string, documentName: string): string {
  const url = new URL("/print", baseUrl);
  url.searchParams.set("name", documentName);
  url.searchParams.set("auto_print", "false");
  return url.toString();
}

export async function printWithNativeDialog(
  baseUrl: string,
  documentName: string,
  host: NativePrintHost,
): Promise<NativePrintOutcome> {
  let printWindow: NativePrintWindow | null = null;
  let dialogPending = false;
  try {
    printWindow = host.createWindow();
    if (!printWindow.getParentWindow()) {
      return { status: "failed", message: "The print window has no parent window" };
    }
    await printWindow.loadURL(desktopPrintUrl(baseUrl, documentName));
    const size = await measurePrintablePage(printWindow);
    if (host.platform !== "linux") return await printThroughDialog(printWindow, size, host);

    const unusable = host.unusableDialogReason();
    if (unusable) return await printThroughPdf(printWindow, documentName, size, host, unusable);
    const showFailure = await showBeforePrint(printWindow, host);
    if (showFailure) return showFailure;
    host.markDialogPending();
    dialogPending = true;
    const outcome = await printThroughDialog(printWindow, size, host);
    if (outcome.status !== "failed") return outcome;
    return await printThroughPdf(printWindow, documentName, size, host, outcome.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    host.log(`print failed: ${message}`);
    return { status: "failed", message };
  } finally {
    const target = printWindow;
    if (target) {
      const clearAfterDestroy = dialogPending;
      host.defer(() => {
        if (!target.isDestroyed()) target.destroy();
        if (clearAfterDestroy) host.clearDialogPending();
      });
    }
  }
}

async function measurePrintablePage(printWindow: NativePrintWindow): Promise<{ width: number; height: number }> {
  const { width, height } = await printWindow.webContents.executeJavaScript(`(async () => {
      await window.maketAutoPagesReady;
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
      const page = document.querySelector("maket-render-page");
      if (!page) throw new Error("The document has no printable page");
      return { width: parseFloat(page.style.width), height: page.dataset.maketAutoHeight === "true" ? Math.max(page.offsetHeight, page.scrollHeight) * 25.4 / 96 : parseFloat(page.style.height) };
    })()`);
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("The document has an invalid print size");
  }
  return { width, height };
}

async function showBeforePrint(
  printWindow: NativePrintWindow,
  host: NativePrintHost,
): Promise<NativePrintOutcome | null> {
  if (printWindow.isVisible()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const shown = new Promise<boolean>((resolve) => {
    printWindow.once("show", () => resolve(true));
    timer = setTimeout(() => resolve(false), SHOW_TIMEOUT_MS);
  });
  printWindow.show();
  const didShow = await shown;
  clearTimeout(timer);
  if (didShow) return null;
  if (!printWindow.isDestroyed()) printWindow.destroy();
  const message = `The print window was not shown within ${SHOW_TIMEOUT_MS} ms`;
  host.log(`print failed: ${message}`);
  return { status: "failed", message };
}

function printThroughDialog(
  printWindow: NativePrintWindow,
  { width, height }: { width: number; height: number },
  host: NativePrintHost,
): Promise<NativePrintOutcome> {
  return new Promise<NativePrintOutcome>((resolve) => {
    try {
      printWindow.webContents.print(
        {
          silent: false,
          printBackground: true,
          landscape: width > height,
          pageSize: {
            width: Math.round(Math.min(width, height) * 1000),
            height: Math.round(Math.max(width, height) * 1000),
          },
          margins: { marginType: "none" },
        },
        (success, failureReason) => {
          if (success) resolve({ status: "printed" });
          else if (failureReason === CANCELED) resolve({ status: "canceled" });
          else {
            const message = failureReason || "The document could not be printed";
            host.log(`print dialog failed: ${message}`);
            resolve({ status: "failed", message });
          }
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      host.log(`print dialog failed: ${message}`);
      resolve({ status: "failed", message });
    }
  });
}

async function printThroughPdf(
  printWindow: NativePrintWindow,
  documentName: string,
  { width, height }: { width: number; height: number },
  host: NativePrintHost,
  reason: string,
): Promise<NativePrintOutcome> {
  host.log(`print dialog unusable on Linux (${reason}); opening a PDF instead`);
  const data = await printWindow.webContents.printToPDF({
    printBackground: true,
    landscape: false,
    pageSize: { width: width / 25.4, height: height / 25.4 },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  const path = await host.openPdf(documentName, data);
  return { status: "pdf-fallback", path, reason };
}

export interface PendingDialogMarker {
  app: string;
  electron: string;
}

export function linuxDialogUnusableReason(
  env: NodeJS.ProcessEnv,
  pending: PendingDialogMarker | null,
  current: PendingDialogMarker,
): string | null {
  if (env.MAKET_PRINT_FALLBACK === "pdf") return "MAKET_PRINT_FALLBACK=pdf";
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return "no graphical display";
  if (pending && pending.app === current.app && pending.electron === current.electron) {
    return "the print dialog stopped Maket during the previous attempt";
  }
  return null;
}
