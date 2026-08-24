import { describe, expect, it } from "vitest";
import { isTrustedIpcSender, isTrustedRendererUrl, shouldOpenInExternalBrowser } from "./renderer-security.js";

const trusted = {
  runtimeReady: true,
  runtimeUrl: "http://127.0.0.1:24843/",
  setupUrl: "file:///Applications/Maket/resources/public/index.html",
};

describe("desktop renderer URL boundary", () => {
  it("accepts only the embedded runtime origin and the exact setup document", () => {
    expect(isTrustedRendererUrl("http://127.0.0.1:24843/documents", trusted)).toBe(true);
    expect(isTrustedRendererUrl(`${trusted.setupUrl}?step=runtime#setup`, trusted)).toBe(true);
    expect(isTrustedRendererUrl("file:///Applications/Maket/resources/public/other.html", trusted)).toBe(false);
  });

  it("rejects prefix-confusion URLs that only look like the runtime", () => {
    expect(isTrustedRendererUrl("http://127.0.0.1:24843@evil.example/", trusted)).toBe(false);
    expect(isTrustedRendererUrl("http://127.0.0.1:24843.evil.example/", trusted)).toBe(false);
    expect(isTrustedRendererUrl("http://127.0.0.1:24844/", trusted)).toBe(false);
  });

  it("does not trust the runtime origin before the embedded runtime is ready", () => {
    expect(
      isTrustedRendererUrl(trusted.runtimeUrl, {
        ...trusted,
        runtimeReady: false,
      }),
    ).toBe(false);
  });

  it("limits IPC to the trusted window main frame", () => {
    const windowContents = {};
    const mainFrame = {};
    const candidate = {
      ...trusted,
      sender: windowContents,
      expectedSender: windowContents,
      senderFrame: mainFrame,
      mainFrame,
      senderFrameUrl: trusted.runtimeUrl,
    };
    expect(isTrustedIpcSender(candidate)).toBe(true);
    expect(isTrustedIpcSender({ ...candidate, sender: {} })).toBe(false);
    expect(isTrustedIpcSender({ ...candidate, senderFrame: {} })).toBe(false);
    expect(isTrustedIpcSender({ ...candidate, senderFrameUrl: "https://evil.example/" })).toBe(false);
  });

  it("opens HTTPS and the exact runtime origin externally, but not lookalikes", () => {
    expect(shouldOpenInExternalBrowser("https://maket.example/help", trusted.runtimeUrl)).toBe(true);
    expect(shouldOpenInExternalBrowser("http://127.0.0.1:24843/preview", trusted.runtimeUrl)).toBe(true);
    expect(shouldOpenInExternalBrowser("http://127.0.0.1:24843@evil.example/", trusted.runtimeUrl)).toBe(false);
    expect(shouldOpenInExternalBrowser("javascript:alert(1)", trusted.runtimeUrl)).toBe(false);
  });
});
