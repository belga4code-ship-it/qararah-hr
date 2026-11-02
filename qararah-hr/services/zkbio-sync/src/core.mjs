import { createHash } from "node:crypto";

export function stableRecordId(record) {
  if (record.externalRecordId) return `${record.sourceSystem}:${record.externalRecordId}`;
  const canonical = [record.sourceSystem, record.deviceSerial, record.externalEmployeeId, record.punchTime, record.punchType].join("\u001f");
  return `${record.sourceSystem}:sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function normalizeRecord(input, employeeMap) {
  const externalEmployeeId = String(input.externalEmployeeId ?? "").trim();
  const deviceSerial = String(input.deviceSerial ?? "").trim();
  const sourceSystem = String(input.sourceSystem ?? "").trim();
  const punchType = String(input.punchType ?? "unknown").trim().toLowerCase();
  const punchTime = new Date(input.punchTime);
  if (!sourceSystem || !externalEmployeeId || !deviceSerial || Number.isNaN(punchTime.getTime())) {
    throw new Error("Invalid punch: source, employee ID, device serial and valid timestamp are required.");
  }
  return Object.freeze({
    syncId: stableRecordId({ ...input, sourceSystem, externalEmployeeId, deviceSerial, punchType, punchTime: punchTime.toISOString() }),
    sourceSystem,
    externalRecordId: input.externalRecordId ? String(input.externalRecordId) : null,
    externalEmployeeId,
    employeeId: employeeMap.get(externalEmployeeId) ?? null,
    deviceSerial,
    punchTime: punchTime.toISOString(),
    punchType,
    importedAt: new Date().toISOString(),
    original: structuredClone(input),
  });
}

export function ingestBatch(inputs, { employeeMap, existingIds = new Set() }) {
  const accepted = [];
  const unmatched = [];
  const duplicates = [];
  const batchIds = new Set(existingIds);
  for (const input of inputs) {
    const record = normalizeRecord(input, employeeMap);
    if (batchIds.has(record.syncId)) {
      duplicates.push(record.syncId);
      continue;
    }
    batchIds.add(record.syncId);
    accepted.push(record);
    if (!record.employeeId) unmatched.push(record);
  }
  return { accepted, unmatched, duplicates, nextIds: batchIds };
}

export async function retry(operation, { attempts = 3, delayMs = 1000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw lastError;
}

