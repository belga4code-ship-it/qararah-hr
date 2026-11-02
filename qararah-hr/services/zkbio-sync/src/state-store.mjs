import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const emptyState = () => ({ version: 1, processedIds: [], rawRecords: [], unmatchedRecords: [], lastSuccessfulSyncAt: null, lastError: null });

export async function loadState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
}

export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  await rename(tempPath, path);
}

