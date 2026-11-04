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
    if (!row || typeof row.sync_key !== "string" || !/^[a-f0-9]{64}$/.test(row.sync_key) || typeof row.external_employee_id !== "string" || !row.external_employee_id.trim() || typeof row.device_serial !== "string" || !row.device_serial.trim() || typeof row.punch_time !== "string" || !Number.isFinite(Date.parse(row.punch_time))) return json({ error: "invalid_record" }, 400);
  }
  for (const device of devices) if (!device || typeof device.serial_number !== "string" || !device.serial_number) return json({ error: "invalid_device" }, 400);

  if (Date.parse(window_start) > Date.parse(window_end)) return json({ error: "invalid_window" }, 400);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data, error } = await supabase.rpc("ingest_zkbio_attendance", { p_payload: body });
    if (error) throw error;
    return json(data);
  } catch {
    // Never log payloads, cookies, tokens or full database error details.
    console.error("zkbio ingest failed");
    await supabase.from("attendance_sync_state").upsert({ source_id: "zkbio-central", status: "error", last_error: "ingest_failed", updated_at: new Date().toISOString() }, { onConflict: "source_id" });
    return json({ error: "ingest_failed" }, 500);
  }
});
