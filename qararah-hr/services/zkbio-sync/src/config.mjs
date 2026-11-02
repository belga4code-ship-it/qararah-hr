import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadLocalEnv() {
  try {
    const contents = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // .env is optional for the demo.
  }
}

loadLocalEnv();

function integerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

const serviceDir = fileURLToPath(new URL("..", import.meta.url));
const statePath = process.env.STATE_FILE ?? "./state/demo-state.json";

export const config = Object.freeze({
  mode: process.env.SYNC_MODE ?? "demo",
  intervalMinutes: integerEnv("SYNC_INTERVAL_MINUTES", 5, 1, 1440),
  retryAttempts: integerEnv("RETRY_ATTEMPTS", 3, 1, 10),
  retryDelaySeconds: integerEnv("RETRY_DELAY_SECONDS", 2, 0, 300),
  stateFile: resolve(serviceDir, statePath),
});

