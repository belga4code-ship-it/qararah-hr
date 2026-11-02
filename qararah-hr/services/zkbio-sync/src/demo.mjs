import { randomUUID } from "node:crypto";

export const demoEmployeeMap = new Map([
  ["DEMO-1001", "demo-employee-1001"],
  ["DEMO-1002", "demo-employee-1002"],
]);

export function makeDemoBatch() {
  const timestamp = new Date().toISOString();
  return [
    { sourceSystem: "zkbio-demo", externalRecordId: "demo-punch-001", externalEmployeeId: "DEMO-1001", deviceSerial: "DEMO-DEVICE-01", punchTime: timestamp, punchType: "check_in" },
    { sourceSystem: "zkbio-demo", externalRecordId: "demo-punch-002", externalEmployeeId: "DEMO-1002", deviceSerial: "DEMO-DEVICE-02", punchTime: timestamp, punchType: "check_out" },
    { sourceSystem: "zkbio-demo", externalRecordId: "demo-punch-unmatched", externalEmployeeId: "DEMO-UNKNOWN", deviceSerial: "DEMO-DEVICE-01", punchTime: timestamp, punchType: "unknown" },
  ];
}

export function makeDemoAdapter({ failFirst = false } = {}) {
  let hasFailed = false;
  return {
    async readNewPunches() {
      if (failFirst && !hasFailed) {
        hasFailed = true;
        throw new Error("Simulated temporary ZKBio connection loss.");
      }
      return makeDemoBatch().map((record) => ({ ...record, externalRecordId: record.externalRecordId ?? randomUUID() }));
    },
  };
}

