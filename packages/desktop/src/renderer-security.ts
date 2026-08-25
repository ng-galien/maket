export interface TrustedRendererUrls {
  runtimeReady: boolean;
  runtimeUrl: string;
  setupUrl: string;
}

export interface TrustedIpcSender extends TrustedRendererUrls {
  sender: unknown;
  expectedSender: unknown;
  senderFrame: unknown;
  mainFrame: unknown;
  senderFrameUrl: string;
}

export function isTrustedRendererUrl(candidate: string, trusted: TrustedRendererUrls): boolean {
  const candidateUrl = parseUrl(candidate);
  if (!candidateUrl) return false;

  if (trusted.runtimeReady) {
    const runtimeUrl = parseUrl(trusted.runtimeUrl);
    if (runtimeUrl && candidateUrl.origin === runtimeUrl.origin) return true;
  }

  const setupUrl = parseUrl(trusted.setupUrl);
  return Boolean(
    setupUrl &&
      candidateUrl.protocol === "file:" &&
      setupUrl.protocol === "file:" &&
      candidateUrl.host === setupUrl.host &&
      candidateUrl.pathname === setupUrl.pathname,
  );
}

export function isTrustedIpcSender(candidate: TrustedIpcSender): boolean {
  return Boolean(
    candidate.expectedSender &&
      candidate.sender === candidate.expectedSender &&
      candidate.senderFrame &&
      candidate.senderFrame === candidate.mainFrame &&
      isTrustedRendererUrl(candidate.senderFrameUrl, candidate),
  );
}

export function shouldOpenInExternalBrowser(candidate: string, runtimeUrl: string | null): boolean {
  const candidateUrl = parseUrl(candidate);
  if (!candidateUrl) return false;
  if (candidateUrl.protocol === "https:") return true;

  const parsedRuntimeUrl = runtimeUrl ? parseUrl(runtimeUrl) : null;
  return Boolean(parsedRuntimeUrl && candidateUrl.origin === parsedRuntimeUrl.origin);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
