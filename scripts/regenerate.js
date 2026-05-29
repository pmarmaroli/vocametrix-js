#!/usr/bin/env node
/**
 * Regenerate the TypeScript client from the Vocametrix OpenAPI spec.
 * Usage: node scripts/regenerate.js [--spec <url-or-path>]
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const LIVE_SPEC = "https://www.vocametrix.com/openapi.json";
const LOCAL_SPEC = resolve(ROOT, "openapi.json");
const OUTPUT_DIR = resolve(ROOT, "src", "_generated");

const args = process.argv.slice(2);
const specIdx = args.indexOf("--spec");
let spec = specIdx !== -1 ? args[specIdx + 1] : null;

if (!spec) {
  spec = existsSync(LOCAL_SPEC) ? LOCAL_SPEC : LIVE_SPEC;
  console.log(`Using spec: ${spec}`);
}

const cmd = [
  "npx @hey-api/openapi-ts",
  `--input "${spec}"`,
  `--output "${OUTPUT_DIR}"`,
  "--client @hey-api/client-fetch",
].join(" ");

try {
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
  console.log(`Generated client written to ${OUTPUT_DIR}`);
} catch (err) {
  console.error("Regeneration failed:", err);
  process.exitCode = 1;
}
