export interface NativePrintWindow {
  loadURL(url: string): Promise<void>;
  isDestroyed(): boolean;
  destroy(): void;
  webContents: {
    executeJavaScript(code: string): Promise<{ width: number; height: number }>;
    print(
      options: {
        silent: false;
        printBackground: true;
        landscape: boolean;
        pageSize: { width: number; height: number };
        margins: { marginType: "none" };
      },
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
    const { width, height } = await printWindow.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
      const page = document.querySelector("maket-render-page");
      if (!page) throw new Error("The document has no printable page");
      return { width: parseFloat(page.style.width), height: parseFloat(page.style.height) };
    })()`);
    if (![width, height].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("The document has an invalid print size");
    }
    await new Promise<void>((resolve, reject) => {
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
          if (success || failureReason === "Print job canceled") {
            resolve();
            return;
          }
          reject(new Error(failureReason || "The document could not be printed"));
        },
      );
    });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}
