import test from "node:test";
import assert from "node:assert/strict";
import { ingestBatch, retry, stableRecordId } from "../src/core.mjs";

const employees = new Map([["E-1", "employee-1"]]);
const row = { sourceSystem: "zkbio-test", externalRecordId: "record-1", externalEmployeeId: "E-1", deviceSerial: "SERIAL-1", punchTime: "2026-10-31T08:00:00+02:00", punchType: "check_in" };

test("imports a mapped punch and retains the original source row", () => {
  const result = ingestBatch([row], { employeeMap: employees });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].employeeId, "employee-1");
  assert.equal(result.accepted[0].punchTime, "2026-10-31T06:00:00.000Z");
  assert.deepEqual(result.accepted[0].original, row);
});

test("keeps unmatched employees for review and does not drop their punches", () => {
  const result = ingestBatch([{ ...row, externalEmployeeId: "UNKNOWN" }], { employeeMap: employees });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0].employeeId, null);
});

test("deduplicates repeated IDs within a batch and against prior sync state", () => {
  const id = stableRecordId(row);
  assert.equal(ingestBatch([row, row], { employeeMap: employees }).accepted.length, 1);
  assert.equal(ingestBatch([row], { employeeMap: employees, existingIds: new Set([id]) }).accepted.length, 0);
});

test("builds a stable fingerprint if a source record ID is missing", () => {
  const noExternalId = { ...row, externalRecordId: null };
  assert.equal(stableRecordId(noExternalId), stableRecordId(noExternalId));
});

test("retries transient failures then succeeds", async () => {
  let calls = 0;
  const value = await retry(async () => {
    calls++;
    if (calls < 3) throw new Error("temporary failure");
    return "ok";
  }, { attempts: 3, delayMs: 0 });
  assert.equal(value, "ok");
  assert.equal(calls, 3);
});

test("reports failure after exhausting retry attempts", async () => {
  let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error("offline"); }, { attempts: 2, delayMs: 0 }), /offline/);
  assert.equal(calls, 2);
});

