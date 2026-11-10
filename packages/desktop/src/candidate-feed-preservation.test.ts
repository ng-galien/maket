import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preserveCandidateUpdateFeed } from "../../../scripts/preserve-candidate-update-feed.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("candidate feed preservation", () => {
  it("copies the live manifests and referenced packages into a Pages build", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "maket-preserve-feed-"));
    temporaryDirectories.push(outputDir);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/darwin/x64/RELEASES.json")) return macManifest("x64");
      if (url.endsWith("/darwin/arm64/RELEASES.json")) return macManifest("arm64");
      if (url.endsWith("/win32/x64/RELEASES")) return new Response("abc maket-full.nupkg 7\n");
      return new Response("package");
    }) as typeof fetch;

    await preserveCandidateUpdateFeed({ outputDir, fetchImpl });

    await expect(readFile(join(outputDir, "darwin", "arm64", "Maket-arm64.zip"), "utf8")).resolves.toBe("package");
    await expect(readFile(join(outputDir, "win32", "x64", "maket-full.nupkg"), "utf8")).resolves.toBe("package");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("accepts an empty feed but rejects external artifact URLs", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "maket-preserve-feed-"));
    temporaryDirectories.push(outputDir);
    await expect(
      preserveCandidateUpdateFeed({
        outputDir,
        fetchImpl: vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch,
      }),
    ).resolves.toBeUndefined();

    await expect(
      preserveCandidateUpdateFeed({
        outputDir,
        fetchImpl: vi.fn(async (input: string | URL | Request) =>
          String(input).includes("darwin/x64")
            ? macManifest("x64", "https://example.com/update.zip")
            : new Response(null, { status: 404 }),
        ) as typeof fetch,
      }),
    ).rejects.toThrow("unexpected artifact URL");
  });

  it("retries temporary feed and artifact errors without changing preserved bytes", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "maket-preserve-feed-"));
    temporaryDirectories.push(outputDir);
    const attempts = new Map<string, number>();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (!url.pathname.includes("darwin/x64")) return new Response(null, { status: 404 });
      const attempt = (attempts.get(url.pathname) ?? 0) + 1;
      attempts.set(url.pathname, attempt);
      if (attempt === 1) return new Response(null, { status: 503 });
      expect(url.searchParams.has("maket-preserve-retry")).toBe(true);
      expect(new Headers(init?.headers).get("Cache-Control")).toBe("no-cache");
      return url.pathname.endsWith("RELEASES.json") ? macManifest("x64") : new Response("package");
    }) as typeof fetch;

    await preserveCandidateUpdateFeed({ outputDir, fetchImpl });

    await expect(readFile(join(outputDir, "darwin", "x64", "RELEASES.json"), "utf8")).resolves.toBe(
      await macManifest("x64").text(),
    );
    await expect(readFile(join(outputDir, "darwin", "x64", "Maket-x64.zip"), "utf8")).resolves.toBe("package");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it.each([503, "network"] as const)("accepts a confirmed 404 after a temporary %s failure", async (failure) => {
    const outputDir = await mkdtemp(join(tmpdir(), "maket-preserve-feed-"));
    temporaryDirectories.push(outputDir);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes("darwin/x64") && !url.search) {
        if (failure === "network") throw new TypeError("fetch failed");
        return new Response(null, { status: failure });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    await expect(preserveCandidateUpdateFeed({ outputDir, fetchImpl })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("fails after bounded retries instead of treating a persistent 503 as an absent feed", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "maket-preserve-feed-"));
    temporaryDirectories.push(outputDir);
    const fetchImpl = vi.fn(
      async (input: string | URL | Request) =>
        new Response(null, { status: String(input).includes("darwin/x64") ? 503 : 404 }),
    ) as typeof fetch;

    await expect(preserveCandidateUpdateFeed({ outputDir, fetchImpl })).rejects.toThrow(
      "Candidate macOS x64 feed returned 503",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});

function macManifest(arch: string, url?: string): Response {
  return Response.json({
    currentRelease: "2.0.0-rc.1",
    releases: [
      {
        version: "2.0.0-rc.1",
        updateTo: {
          url: url ?? `https://ng-galien.github.io/maket/updates/candidate/darwin/${arch}/Maket-${arch}.zip`,
        },
      },
    ],
  });
}
