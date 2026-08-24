export interface NativePrintWindow {
  loadURL(url: string): Promise<void>;
  isDestroyed(): boolean;
  destroy(): void;
  webContents: {
    print(
      options: { silent: false; printBackground: true },
      callback: (success: boolean, failureReason: string) => void,
    ): void;
  };
}

export function desktopPrintUrl(baseUrl: string, documentName: string): string {
  const url = new URL("/print", baseUrl);
  url.searchParams.set("name", documentName);
  url.searchParams.set("auto_print", "false");
  return url.toString();
}

export async function printWithNativeDialog(
  baseUrl: string,
  documentName: string,
  createWindow: () => NativePrintWindow,
): Promise<void> {
  const printWindow = createWindow();
  try {
    await printWindow.loadURL(desktopPrintUrl(baseUrl, documentName));
    await new Promise<void>((resolve, reject) => {
      printWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
        if (success || failureReason === "Print job canceled") {
          resolve();
          return;
        }
        reject(new Error(failureReason || "The document could not be printed"));
      });
    });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}
