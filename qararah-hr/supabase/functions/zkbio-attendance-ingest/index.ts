import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-sync-token", "access-control-allow-methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

async function equalSecret(left: string, right: string) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(left)), crypto.subtle.digest("SHA-256", encoder.encode(right))]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const expected = Deno.env.get("SYNC_INGEST_TOKEN");
  const supplied = req.headers.get("x-sync-token") ?? "";
  if (!expected || !supplied || !(await equalSecret(supplied, expected))) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "server_not_configured" }, 500);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { source_id, window_start, window_end, complete_window, devices, records } = body ?? {};
  if (source_id !== "zkbio-central" || typeof window_start !== "string" || !Number.isFinite(Date.parse(window_start)) || typeof window_end !== "string" || !Number.isFinite(Date.parse(window_end)) || typeof complete_window !== "boolean" || !Array.isArray(devices) || !Array.isArray(records) || records.length > 500 || devices.length > 100) return json({ error: "invalid_payload" }, 400);
  for (const row of records) {
    if (!row || typeof row.sync_key !== "string" || !/^[a-f0-9]{64}$/.test(row.sync_key) || typeof row.external_employee_id !== "string" || typeof row.device_serial !== "string" || !Number.isFinite(Date.parse(row.punch_time))) return json({ error: "invalid_record" }, 400);
  }
  for (const device of devices) if (!device || typeof device.serial_number !== "string" || !device.serial_number) return json({ error: "invalid_device" }, 400);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let syncSourceId: string | null = source_id;
  try {
    const serials = [...new Set([...devices.map((device: any) => device.serial_number), ...records.map((row: any) => row.device_serial)])];
    const existingDevices = serials.length ? await supabase.from("attendance_devices").select("id,serial_number,branch_id").in("serial_number", serials) : { data: [], error: null };
    if (existingDevices.error) throw existingDevices.error;
    const known = new Map((existingDevices.data ?? []).map((row: any) => [row.serial_number, row]));

    if (devices.length) {
      const upserts = devices.map((device: any) => ({
        serial_number: device.serial_number,
        device_name: device.device_name ?? null,
        branch_id: known.get(device.serial_number)?.branch_id ?? null,
        last_seen_at: device.last_activity_at ?? null,
        external_status_code: device.external_status_code ?? null,
        raw_payload: device.raw_payload ?? {},
        updated_at: new Date().toISOString(),
      }));
      const saved = await supabase.from("attendance_devices").upsert(upserts, { onConflict: "serial_number" });
      if (saved.error) throw saved.error;
    }

    const serialsAfterUpsert = serials.length ? await supabase.from("attendance_devices").select("id,serial_number,branch_id").in("serial_number", serials) : { data: [], error: null };
    if (serialsAfterUpsert.error) throw serialsAfterUpsert.error;
    const devicesBySerial = new Map((serialsAfterUpsert.data ?? []).map((row: any) => [row.serial_number, row]));
    const externalIds = [...new Set(records.map((row: any) => row.external_employee_id))];
    const employeesResult = externalIds.length ? await supabase.from("employees").select("id,zkt_user_id").in("zkt_user_id", externalIds) : { data: [], error: null };
    if (employeesResult.error) throw employeesResult.error;
    const employeesByCode = new Map<string, any[]>();
    for (const employee of employeesResult.data ?? []) {
      const code = String(employee.zkt_user_id);
      employeesByCode.set(code, [...(employeesByCode.get(code) ?? []), employee]);
    }
    const employees = new Map([...employeesByCode.entries()].filter(([, matches]) => matches.length === 1).map(([code, matches]) => [code, matches[0].id]));
    const ambiguousCodes = new Set([...employeesByCode.entries()].filter(([, matches]) => matches.length > 1).map(([code]) => code));

    const rows = records.map((record: any) => {
      const device: any = devicesBySerial.get(record.device_serial);
      return {
        source_system: "zkbio",
        sync_key: record.sync_key,
        external_record_id: record.external_record_id ?? null,
        external_employee_id: record.external_employee_id,
        employee_id: employees.get(record.external_employee_id) ?? null,
        device_id: device?.id ?? null,
        branch_id: device?.branch_id ?? null,
        punch_time: record.punch_time,
        punch_type: record.punch_type ?? null,
        raw_payload: record.raw_payload ?? {},
      };
    });
    let accepted = 0;
    if (rows.length) {
      const inserted = await supabase.from("attendance_raw_logs").upsert(rows, { onConflict: "source_system,sync_key", ignoreDuplicates: true, count: "exact" });
      if (inserted.error) throw inserted.error;
      accepted = inserted.count ?? 0;
    }
    const unmatched = rows.filter((row: any) => !row.employee_id).length;
    const ambiguous = [...new Set(records.map((row: any) => row.external_employee_id))].filter((code: string) => ambiguousCodes.has(code)).length;

    if (complete_window) {
      const savedState = await supabase.from("attendance_sync_state").upsert({ source_id, last_successful_sync: window_end, cursor: { window_start, window_end }, status: "ok", last_error: null, updated_at: new Date().toISOString() }, { onConflict: "source_id" });
      if (savedState.error) throw savedState.error;
    }
    return json({ accepted, duplicates: records.length - accepted, unmatched, ambiguous_employee_codes: ambiguous, complete_window });
  } catch (error) {
    console.error("zkbio ingest failed", error instanceof Error ? error.message : "unknown_error");
    if (syncSourceId) {
      await supabase.from("attendance_sync_state").upsert({ source_id: syncSourceId, status: "error", last_error: "ingest_failed", updated_at: new Date().toISOString() }, { onConflict: "source_id" });
    }
    return json({ error: "ingest_failed" }, 500);
  }
});
