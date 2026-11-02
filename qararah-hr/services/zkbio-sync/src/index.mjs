import { config } from "./config.mjs";
import { ingestBatch, retry } from "./core.mjs";
import { demoEmployeeMap, makeDemoAdapter } from "./demo.mjs";
import { loadState, saveState } from "./state-store.mjs";

const once = process.argv.includes("--once");
const failFirst = process.argv.includes("--simulate-disconnect");

if (config.mode !== "demo") {
  console.error("Real mode is disabled until the installed ZKBio API manual and a secure database ingestion endpoint are confirmed.");
  process.exitCode = 2;
} else {
  const adapter = makeDemoAdapter({ failFirst });
  const state = await loadState(config.stateFile);

  async function syncOnce() {
    const started = new Date().toISOString();
    try {
      const rows = await retry(() => adapter.readNewPunches(), {
        attempts: config.retryAttempts,
        delayMs: config.retryDelaySeconds * 1000,
      });
      const result = ingestBatch(rows, { employeeMap: demoEmployeeMap, existingIds: new Set(state.processedIds) });
      state.processedIds = [...result.nextIds];
      state.rawRecords.push(...result.accepted);
      state.unmatchedRecords.push(...result.unmatched);
      state.lastSuccessfulSyncAt = new Date().toISOString();
      state.lastError = null;
      await saveState(config.stateFile, state);
      console.log(JSON.stringify({ mode: config.mode, startedAt: started, fetched: rows.length, imported: result.accepted.length, duplicates: result.duplicates.length, unmatched: result.unmatched.length, lastSuccessfulSyncAt: state.lastSuccessfulSyncAt }));
    } catch (error) {
      state.lastError = { at: new Date().toISOString(), message: String(error.message ?? error) };
      await saveState(config.stateFile, state);
      console.error(JSON.stringify({ mode: config.mode, startedAt: started, error: state.lastError.message }));
      throw error;
    }
  }

  await syncOnce();
  if (!once) {
    console.log(`Demo sync loop running every ${config.intervalMinutes} minute(s). Press Ctrl+C to stop.`);
    setInterval(() => syncOnce().catch(() => {}), config.intervalMinutes * 60_000);
  }
}

