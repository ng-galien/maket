import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const makeOutput = resolve(import.meta.dirname, "../packages/desktop/out/make");

await rm(makeOutput, { recursive: true, force: true });
