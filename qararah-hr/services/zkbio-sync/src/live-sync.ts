import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;
type Device = { serial_number: string; device_name: string | null; external_status_code: string | null; last_activity_at: string | null; raw_payload: JsonObject };
type Punch = { sync_key: string; external_record_id: string | null; external_employee_id: string; device_serial: string; punch_time: string; punch_type: string | null; raw_payload: JsonObject };
type State = { lastSuccessfulWindowEnd: string | null; lastAttemptAt: string | null; lastError: string | null };

const baseDir = fileURLToPath(new URL("..", import.meta.url));

function loadEnvFile() {
  try {
    const contents = readFileSync(resolve(baseDir, ".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

loadEnvFile();

function setting(name: string, fallback = "") { return process.env[name]?.trim() || fallback; }
function intSetting(name: string, fallback: number, min: number, max: number) {
  const value = Number(setting(name, String(fallback)));
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
function required(name: string) {
  const value = setting(name);
  if (!value) throw new Error(`Missing ${name} in services/zkbio-sync/.env.`);
  return value;
}
function getPath(object: unknown, path: string) {
  if (!path) return undefined;
  return path.split(".").reduce((value: any, key) => value?.[key], object as any);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as JsonObject)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function localWallClockToIso(value: string, timeZone: string) {
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (hasOffset) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp returned by ZKBio: ${value}`);
    return date.toISOString();
  }
  const match = value.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!match) throw new Error(`Unsupported ZKBio timestamp format: ${value}`);
  const [year, month, day, hour, minute, second, millis] = match.slice(1).map((part, index) => Number(part ?? (index === 6 ? "0" : "0")));
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  let candidate = desiredUtc;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second), millis);
    candidate += desiredUtc - localAsUtc;
  }
  return new Date(candidate).toISOString();
}
function formatLocalQuery(value: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function field(record: JsonObject, name: string, requiredField: boolean) {
  const value = getPath(record, name);
  if (value === undefined || value === null || value === "") {
    if (requiredField) throw new Error(`A transaction is missing configured field '${name}'. Available fields: ${Object.keys(record).join(", ")}`);
    return null;
  }
  return String(value);
}
function encodeUrl(url: string) { return url.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

const config = {
  mode: setting("SYNC_MODE", "dry-run"),
  intervalMinutes: intSetting("SYNC_INTERVAL_MINUTES", 15, 1, 1440),
  overlapMinutes: intSetting("SYNC_OVERLAP_MINUTES", 30, 0, 1440),
  pageSize: intSetting("ZKBIO_PAGE_SIZE", 500, 1, 2000),
  timeoutMs: intSetting("HTTP_TIMEOUT_SECONDS", 45, 5, 300) * 1000,
  attempts: intSetting("RETRY_ATTEMPTS", 3, 1, 10),
  retryDelayMs: intSetting("RETRY_DELAY_SECONDS", 3, 0, 300) * 1000,
  timezone: setting("ZKBIO_TIME_ZONE", "Africa/Tripoli"),
  stateFile: resolve(baseDir, setting("STATE_FILE", "./state/live-state.json")),
};

async function readState(): Promise<State> {
  try { return JSON.parse(await readFile(config.stateFile, "utf8")) as State; }
  catch (error) { if (error.code === "ENOENT") return { lastSuccessfulWindowEnd: null, lastAttemptAt: null, lastError: null }; throw error; }
}
async function writeState(state: State) {
  await mkdir(dirname(config.stateFile), { recursive: true });
  const tempPath = `${config.stateFile}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  await rename(tempPath, config.stateFile);
}
async function retry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    try { return await operation(); }
    catch (error) { lastError = error; if (attempt < config.attempts) await new Promise((done) => setTimeout(done, config.retryDelayMs)); }
  }
  throw lastError;
}

const zkbioBase = setting("ZKBIO_BASE_URL", "http://127.0.0.1:8089").replace(/\/+$/, "");
const authPath = setting("ZKBIO_AUTH_PATH", "/api-token-auth/");
const tokenField = setting("ZKBIO_TOKEN_FIELD", "token");
const transactionsPath = setting("ZKBIO_TRANSACTIONS_PATH", "/iclock/api/transactions/");
const terminalsPath = setting("ZKBIO_TERMINALS_PATH", "/iclock/api/terminals/");
let token: string | null = null;

async function login() {
  const response = await fetch(new URL(authPath, `${zkbioBase}/`), {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ username: required("ZKBIO_USERNAME"), password: required("ZKBIO_PASSWORD") }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`ZKBio authentication failed (HTTP ${response.status}).`);
  const body = await response.json() as JsonObject;
  const issued = getPath(body, tokenField);
  if (typeof issued !== "string" || !issued) throw new Error(`ZKBio auth response did not contain configured token field '${tokenField}'.`);
  token = issued;
}

async function requestJson(url: URL, canRefresh = true): Promise<JsonObject> {
  if (!token) await login();
  const response = await fetch(url, { headers: { accept: "application/json", authorization: `Token ${token}` }, signal: AbortSignal.timeout(config.timeoutMs) });
  if (response.status === 401 && canRefresh) { token = null; await login(); return requestJson(url, false); }
  if (!response.ok) throw new Error(`ZKBio API request failed (HTTP ${response.status}) for ${url.pathname}.`);
  return await response.json() as JsonObject;
}

function assertSameOrigin(next: string) {
  const url = new URL(next, `${zkbioBase}/`);
  if (url.origin !== new URL(zkbioBase).origin) throw new Error("ZKBio pagination returned a next URL outside the configured server; refusing to forward the auth token.");
  return url;
}

async function pagedGet(path: string, params?: URLSearchParams, resultsField = "results") {
  const first = new URL(path, `${zkbioBase}/`);
  if (params) for (const [key, value] of params) first.searchParams.set(key, value);
  const rows: JsonObject[] = [];
  const visited = new Set<string>();
  let current: URL | null = first;
  for (let page = 0; current && page < 10000; page++) {
    if (visited.has(current.href)) throw new Error("ZKBio API pagination loop detected.");
    visited.add(current.href);
    const body = await retry(() => requestJson(current!));
    const result = getPath(body, resultsField);
    if (!Array.isArray(result)) throw new Error(`Expected '${resultsField}' to be an array in the ZKBio response. Available keys: ${Object.keys(body).join(", ")}`);
    rows.push(...result as JsonObject[]);
    const next = body.next;
    current = typeof next === "string" && next ? assertSameOrigin(next) : null;
  }
  if (current) throw new Error("ZKBio API exceeded the 10,000-page safety limit.");
  return rows;
}

function mapDevices(rows: JsonObject[]): Device[] {
  const serialField = setting("ZKBIO_DEVICE_SERIAL_FIELD", "terminal_sn");
  const nameField = setting("ZKBIO_DEVICE_NAME_FIELD", "terminal_alias");
  const statusField = setting("ZKBIO_DEVICE_STATUS_FIELD", "state");
  const activityField = setting("ZKBIO_DEVICE_LAST_ACTIVITY_FIELD", "last_activity");
  return rows.map((row) => {
    const serial = field(row, serialField, true)!;
    const activity = field(row, activityField, false);
    return {
      serial_number: serial,
      device_name: field(row, nameField, false),
      external_status_code: field(row, statusField, false),
      last_activity_at: activity ? localWallClockToIso(activity, config.timezone) : null,
      raw_payload: row,
    };
  });
}

function mapPunches(rows: JsonObject[]): Punch[] {
  const idField = setting("ZKBIO_RECORD_ID_FIELD", "id");
  const employeeField = setting("ZKBIO_EMPLOYEE_CODE_FIELD", "emp_code");
  const serialField = setting("ZKBIO_PUNCH_DEVICE_FIELD", "terminal_sn");
  const timeField = setting("ZKBIO_PUNCH_TIME_FIELD", "punch_time");
  const typeField = setting("ZKBIO_PUNCH_TYPE_FIELD", "punch_state");
  return rows.map((row) => {
    const externalRecordId = field(row, idField, false);
    const externalEmployeeId = field(row, employeeField, true)!;
    const deviceSerial = field(row, serialField, true)!;
    const punchTimeRaw = field(row, timeField, true)!;
    const punchTime = localWallClockToIso(punchTimeRaw, config.timezone);
    const punchType = field(row, typeField, false);
    const stableSource = externalRecordId ? `${externalRecordId}` : stableJson(row);
    const syncKey = createHash("sha256").update(["zkbio", deviceSerial, externalEmployeeId, stableSource].join("\u001f")).digest("hex");
    return { sync_key: syncKey, external_record_id: externalRecordId, external_employee_id: externalEmployeeId, device_serial: deviceSerial, punch_time: punchTime, punch_type: punchType, raw_payload: row };
  });
}

async function readWindow(start: Date, end: Date) {
  const timeParams = new URLSearchParams({ start_time: formatLocalQuery(start, config.timezone), end_time: formatLocalQuery(end, config.timezone), page_size: String(config.pageSize) });
  const [deviceRows, punchRows] = await Promise.all([
    pagedGet(terminalsPath, undefined, setting("ZKBIO_DEVICES_RESULTS_FIELD", "results")),
    pagedGet(transactionsPath, timeParams, setting("ZKBIO_TRANSACTIONS_RESULTS_FIELD", "results")),
  ]);
  return { devices: mapDevices(deviceRows), punches: mapPunches(punchRows) };
}

async function postToSupabase(payload: JsonObject) {
  const url = required("SUPABASE_INGEST_URL");
  const syncToken = required("SUPABASE_SYNC_TOKEN");
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json", "x-sync-token": syncToken },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`Supabase ingest failed (HTTP ${response.status}).`);
  return await response.json().catch(() => ({}));
}

async function sendBatches(devices: Device[], punches: Punch[], windowStart: Date, windowEnd: Date) {
  const batchSize = 500;
  const batches: Punch[][] = [];
  for (let i = 0; i < punches.length; i += batchSize) batches.push(punches.slice(i, i + batchSize));
  if (!batches.length) batches.push([]);
  const totals = { accepted: 0, duplicates: 0, unmatched: 0, ambiguous_employee_codes: 0 };
  for (let i = 0; i < batches.length; i++) {
    const response = await retry(() => postToSupabase({
      source_id: "zkbio-central",
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      complete_window: i === batches.length - 1,
      devices: i === 0 ? devices : [],
      records: batches[i],
    }));
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += Number(response[key] ?? 0);
  }
  return totals;
}

async function main() {
  if (config.mode !== "dry-run" && config.mode !== "push") throw new Error("SYNC_MODE must be 'dry-run' or 'push'.");
  const state = await readState();
  const initialFrom = setting("SYNC_INITIAL_FROM");
  if (!state.lastSuccessfulWindowEnd && !initialFrom) throw new Error("Set SYNC_INITIAL_FROM in .env before the first live run; it prevents an accidental full-history import.");
  const end = new Date();
  const priorEnd = state.lastSuccessfulWindowEnd ? new Date(state.lastSuccessfulWindowEnd) : new Date(initialFrom);
  if (Number.isNaN(priorEnd.getTime())) throw new Error("SYNC_INITIAL_FROM or saved cursor is not a valid date.");
  const start = new Date(priorEnd.getTime() - (state.lastSuccessfulWindowEnd ? config.overlapMinutes : 0) * 60_000);
  state.lastAttemptAt = new Date().toISOString();
  await writeState(state);
  try {
    const { devices, punches } = await readWindow(start, end);
    if (config.mode === "push") {
      const result = await sendBatches(devices, punches, start, end);
      state.lastSuccessfulWindowEnd = end.toISOString();
      state.lastError = null;
      await writeState(state);
      console.log(JSON.stringify({ mode: config.mode, devices: devices.length, fetched: punches.length, accepted: result.accepted, duplicates: result.duplicates, unmatched: result.unmatched, ambiguousEmployeeCodes: result.ambiguous_employee_codes, windowEnd: state.lastSuccessfulWindowEnd }));
      return;
    }
    if (config.mode !== "dry-run") throw new Error("SYNC_MODE must be 'dry-run' or 'push' for the real connector.");
    console.log(JSON.stringify({ mode: config.mode, devices: devices.length, fetched: punches.length, windowStart: start.toISOString(), windowEnd: end.toISOString(), transactionFields: [...new Set(punches.slice(0, 5).flatMap((row) => Object.keys(row.raw_payload)))], cursorAdvanced: false }));
  } catch (error) {
    state.lastError = String(error.message ?? error);
    await writeState(state);
    console.error(JSON.stringify({ mode: config.mode, error: state.lastError }));
    throw error;
  }
}

if (process.argv.includes("--validate-config")) {
  if (config.mode !== "dry-run" && config.mode !== "push") throw new Error("SYNC_MODE must be 'dry-run' or 'push'.");
  new URL(zkbioBase);
  for (const key of ["ZKBIO_USERNAME", "ZKBIO_PASSWORD", "SYNC_INITIAL_FROM"]) required(key);
  if (Number.isNaN(new Date(setting("SYNC_INITIAL_FROM")).getTime())) throw new Error("SYNC_INITIAL_FROM must be a valid date.");
  if (config.mode === "push") for (const key of ["SUPABASE_INGEST_URL", "SUPABASE_SYNC_TOKEN"]) required(key);
  console.log(`Configuration valid; mode=${config.mode}, interval=${config.intervalMinutes}m.`);
} else {
  await main();
}

