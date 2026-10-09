"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { readSheet } from "read-excel-file/browser";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";

type EmployeeMatch = { id: string; employee_number: string; zkt_user_id: string | null; full_name: string | null; first_name: string; last_name: string | null; branch_id: string; branch: { name: string } | null };
type AttendanceRow = {
  line: number; employeeCode: string; sourceName: string; date: string; firstIn: string | null; lastOut: string | null; totalWork: string | null;
  status: "present" | "absent" | "incomplete" | "leave" | "needs_review"; statusLabel: string; exceptionNote: string | null;
  employee: EmployeeMatch | null; rawData: Record<string, string | number | null>;
};

const requiredHeaders = ["التاريخ", "رقم الموظف", "أول تسجيل دخول", "أخر تسجيل خروج", "الوقت الإجمالي", "الإسم الأول"];
const statusLabels: Record<AttendanceRow["status"], string> = { present: "حضور", absent: "غياب بصمة", incomplete: "بصمة ناقصة", leave: "إجازة", needs_review: "تحتاج مراجعة" };

function clean(value: unknown) {
  return toWesternDigits(value).replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
}

function westernDigits(value: string) {
  return value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function normalizeHeader(value: unknown) {
  return westernDigits(clean(value)).replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي");
}

function normalizeCode(value: unknown) {
  const code = westernDigits(clean(value));
  return /^\d+\.0$/.test(code) ? code.slice(0, -2) : code;
}

function asDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  const text = westernDigits(clean(value));
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

function asTime(value: unknown, duration = false): string | null {
  if (value == null || value === "") return null;
  let hours: number; let minutes: number; let seconds = 0;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    if (duration) {
      const totalMinutes = Math.max(0, Math.round((value.getTime() - Date.UTC(1899, 11, 30)) / 60_000));
      hours = Math.floor(totalMinutes / 60); minutes = totalMinutes % 60;
    } else { hours = value.getUTCHours(); minutes = value.getUTCMinutes(); seconds = value.getUTCSeconds(); }
  } else if (typeof value === "number" && Number.isFinite(value)) {
    const totalMinutes = Math.round(Math.abs(value) * 24 * 60);
    hours = duration ? Math.floor(totalMinutes / 60) : Math.floor(totalMinutes / 60) % 24;
    minutes = totalMinutes % 60;
  } else {
    const match = westernDigits(clean(value)).match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!match) return null;
    hours = Number(match[1]); minutes = Number(match[2]); seconds = Number(match[3] ?? 0);
  }
  if (minutes > 59 || seconds > 59 || (!duration && hours > 23)) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}${duration ? ":00" : seconds ? `:${String(seconds).padStart(2, "0")}` : ""}`;
}

function rawValue(value: unknown): string | number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === "number" ? value : clean(value);
}

function makeRows(sheet: unknown[][], employeeByCode: Map<string, EmployeeMatch>, ambiguousCodes: Set<string>) {
  const headerRow = sheet.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return requiredHeaders.every((header) => headers.includes(normalizeHeader(header)));
  });
  if (headerRow < 0) throw new Error("لم نعثر على أعمدة تقرير ZKT المطلوبة. تأكد أن الملف هو تقرير الحضور الأسبوعي.");
  const rawHeaders = sheet[headerRow].map(clean);
  const headers = rawHeaders.map(normalizeHeader);
  const column = (name: string) => headers.indexOf(normalizeHeader(name));
  const dataRows = sheet.slice(headerRow + 1).filter((row) => row.some((cell) => clean(cell) !== ""));
  const rows: AttendanceRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  dataRows.forEach((cells, index) => {
    const line = headerRow + index + 2;
    const employeeCode = normalizeCode(cells[column("رقم الموظف")]);
    const sourceName = clean(cells[column("الإسم الأول")]);
    const date = asDate(cells[column("التاريخ")]);
    if (!employeeCode || !date) { errors.push(`صف ${line}: كود الموظف أو التاريخ مفقود/غير مقروء.`); return; }
    const key = `${employeeCode}\u0000${date}`;
    if (seen.has(key)) { errors.push(`صف ${line}: تكرار سجل كود البصمة ${employeeCode} في تاريخ ${date}.`); return; }
    seen.add(key);

    const firstValue = cells[column("أول تسجيل دخول")];
    const firstText = clean(firstValue);
    const lastOut = asTime(cells[column("أخر تسجيل خروج")]);
    const firstIn = asTime(firstValue);
    const totalWork = asTime(cells[column("الوقت الإجمالي")], true);
    let status: AttendanceRow["status"] = "needs_review";
    let exceptionNote: string | null = null;
    if (/إجازة|اجازة/.test(firstText)) { status = "leave"; }
    else if (/لا توجد بصمة/.test(firstText)) { status = "absent"; exceptionNote = "لا توجد بصمة مسجلة حسب تقرير الجهاز."; }
    else if (firstIn && lastOut && totalWork !== "00:00:00") { status = "present"; }
    else if (firstIn || lastOut || totalWork) { status = "incomplete"; exceptionNote = totalWork === "00:00:00" ? "مدة العمل صفرية أو يوجد تسجيل بصمة واحد؛ تحتاج مراجعة." : "أحد أوقات البصمة أو مدة العمل ناقصة في التقرير."; }
    else { exceptionNote = "لا توجد أوقات أو حالة موضحة في صف التقرير."; }

    const employee = employeeByCode.get(employeeCode) ?? null;
    if (ambiguousCodes.has(employeeCode)) errors.push(`صف ${line}: كود البصمة ${employeeCode} مرتبط بأكثر من موظف؛ يلزم تصحيح الأكواد المكررة.`);
    else if (!employee) errors.push(`صف ${line}: كود البصمة ${employeeCode} غير مرتبط بموظف في النظام.`);
    const rawData = Object.fromEntries(rawHeaders.map((header, i) => {
      const normalized = headers[i];
      const value = normalized === normalizeHeader("التاريخ") ? asDate(cells[i]) : normalized === normalizeHeader("الوقت الإجمالي") ? asTime(cells[i], true) : [normalizeHeader("أول تسجيل دخول"), normalizeHeader("أخر تسجيل خروج")].includes(normalized) ? (asTime(cells[i]) ?? rawValue(cells[i])) : rawValue(cells[i]);
      return [header, value] as const;
    }).filter(([header]) => Boolean(header))) as Record<string, string | number | null>;
    rows.push({ line, employeeCode, sourceName, date, firstIn, lastOut, totalWork, status, statusLabel: statusLabels[status], exceptionNote, employee, rawData });
  });
  return { rows, errors };
}

export default function AttendanceImport() {
  const router = useRouter();
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [replaceExisting, setReplaceExisting] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRows([]); setErrors([]); setExistingKeys(new Set()); setReplaceExisting(false); setMessage(""); setDone(false);
    if (!file) return;
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".xlsx")) { setMessage("يرجى اختيار ملف Excel بصيغة .xlsx."); return; }
    try {
      const sheet = await readSheet(file);
      const cells = sheet as unknown[][];
      const headerIndex = cells.findIndex((row) => requiredHeaders.every((header) => row.map(normalizeHeader).includes(normalizeHeader(header))));
      if (headerIndex < 0) throw new Error("لم نعثر على أعمدة تقرير ZKT المطلوبة. تأكد أن الملف هو تقرير الحضور الأسبوعي.");
      const codeIndex = cells[headerIndex].map(normalizeHeader).indexOf(normalizeHeader("رقم الموظف"));
      const previewCodes = new Set(cells.slice(headerIndex + 1).map((row) => normalizeCode(row[codeIndex])).filter(Boolean));
      if (!previewCodes.size) { setMessage("لم نعثر على أكواد موظفين في ورقة التقرير."); return; }
      const supabase = createClient();
      const employeeResult = await supabase.from("employees").select("id,employee_number,zkt_user_id,full_name,first_name,last_name,branch_id,branch:branches(name)").in("zkt_user_id", [...previewCodes]);
      if (employeeResult.error) throw employeeResult.error;
      const employees = (employeeResult.data ?? []) as unknown as EmployeeMatch[];
      const employeeGroups = new Map<string, EmployeeMatch[]>();
      employees.forEach((employee) => { if (employee.zkt_user_id) employeeGroups.set(normalizeCode(employee.zkt_user_id), [...(employeeGroups.get(normalizeCode(employee.zkt_user_id)) ?? []), employee]); });
      const ambiguousCodes = new Set([...employeeGroups.entries()].filter(([, matches]) => matches.length > 1).map(([code]) => code));
      const employeeByCode = new Map([...employeeGroups.entries()].flatMap(([code, matches]) => matches.length === 1 ? [[code, matches[0]] as const] : []));
      const parsed = makeRows(cells, employeeByCode, ambiguousCodes);
      setRows(parsed.rows); setErrors(parsed.errors);
      if (!parsed.rows.length && !parsed.errors.length) { setMessage("لم نعثر على سجلات في ورقة التقرير."); return; }
      const matchedIds = [...new Set(parsed.rows.flatMap((row) => row.employee ? [row.employee.id] : []))];
      if (matchedIds.length) {
        const dates = parsed.rows.map((row) => row.date).sort();
        const existingResult = await supabase.from("attendance_records").select("employee_id,attendance_date").in("employee_id", matchedIds).gte("attendance_date", dates[0]).lte("attendance_date", dates[dates.length - 1]);
        if (existingResult.error) throw existingResult.error;
        setExistingKeys(new Set((existingResult.data ?? []).map((record) => `${record.employee_id}\u0000${record.attendance_date}`)));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر قراءة ملف Excel أو مطابقة الموظفين.");
    }
  }

  async function importRows() {
    if (!rows.length || errors.length || busy || (existingKeys.size > 0 && !replaceExisting)) return;
    setBusy(true); setMessage("");
    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("انتهت جلسة الدخول. سجّل الدخول من جديد ثم أعد المحاولة.");
      const branchGroups = new Map<string, AttendanceRow[]>();
      rows.forEach((row) => { if (row.employee) branchGroups.set(row.employee.branch_id, [...(branchGroups.get(row.employee.branch_id) ?? []), row]); });
      if (branchGroups.size === 0) throw new Error("لا توجد سجلات مرتبطة بموظفين في النظام.");
      const dates = rows.map((row) => row.date).sort();
      const imports = [...branchGroups.entries()].map(([branchId, branchRows]) => ({
        branch_id: branchId, source_file: fileName, imported_by: user.id, period_start: dates[0], period_end: dates[dates.length - 1],
        row_count: branchRows.length, exception_count: branchRows.filter((row) => row.status !== "present").length,
        notes: "تقرير حضور أسبوعي صادر من جهاز ZKT.",
      }));
      const importResult = await supabase.from("attendance_imports").insert(imports).select("id,branch_id");
      if (importResult.error) throw importResult.error;
      const importIdByBranch = new Map((importResult.data ?? []).map((item) => [item.branch_id, item.id]));
      const payload = rows.filter((row) => row.employee).map((row) => ({
        employee_id: row.employee!.id, branch_id: row.employee!.branch_id, attendance_date: row.date,
        first_in: row.firstIn, last_out: row.lastOut, total_work: row.totalWork, status: row.status,
        exception_note: row.exceptionNote, import_id: importIdByBranch.get(row.employee!.branch_id) ?? null,
        raw_data: row.rawData, reviewed_by: null, reviewed_at: null,
      }));
      const recordsResult = await supabase.from("attendance_records").upsert(payload, { onConflict: "employee_id,attendance_date" });
      if (recordsResult.error) throw recordsResult.error;
      setDone(true);
      setMessage(`تم استيراد ${payload.length} سجل حضور من الملف إلى ${branchGroups.size} فروع.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ سجلات الحضور.");
    } finally { setBusy(false); }
  }

  const reviewCount = rows.filter((row) => row.status !== "present").length;
  const unmatchedCount = rows.filter((row) => !row.employee).length;
  const replaceCount = rows.filter((row) => row.employee && existingKeys.has(`${row.employee.id}\u0000${row.date}`)).length;

  return <div className="attendance-import-flow">
    <section className="attendance-file-section">
      <label className="attendance-file-drop" htmlFor="zkt-attendance-file">
        <span className="attendance-file-icon">⇧</span><strong>{fileName || "اسحب تقرير ZKT هنا أو اختر الملف"}</strong>
        <span>{fileName && rows.length ? `${rows.length} سجل مقروء · ${reviewCount} حالة تحتاج مراجعة` : "ملف Excel بصيغة .xlsx — يُقرأ أول تبويب في الملف"}</span>
        <input id="zkt-attendance-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} />
      </label>
      {message && <p className={`import-message${done ? " success" : ""}`} role="status">{message}</p>}
      {errors.length > 0 && <div className="import-errors"><strong>يلزم تصحيح هذه السجلات قبل الحفظ:</strong>{errors.slice(0, 10).map((error) => <span key={error}>{error}</span>)}{errors.length > 10 && <span>ويوجد {errors.length - 10} أخطاء أخرى.</span>}</div>}
    </section>

    {rows.length > 0 && <section className="panel attendance-preview-panel">
      <div className="attendance-panel-heading"><div><h2>معاينة السجلات</h2><p>{rows.length} سجل · {new Set(rows.map((row) => row.date)).size} أيام · {new Set(rows.map((row) => row.employee?.branch_id).filter(Boolean)).size} فروع · {reviewCount} حالة غير اعتيادية</p></div><button type="button" className="primary-button" onClick={importRows} disabled={busy || done || errors.length > 0 || (replaceCount > 0 && !replaceExisting)}>{busy ? "جارٍ الحفظ..." : done ? "تم الاستيراد" : `اعتماد واستيراد ${rows.length} سجل`}</button></div>
      {replaceCount > 0 && <label className="attendance-replace-warning"><input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} /><span><strong>تحديث {replaceCount} سجلات موجودة</strong><small>سيستبدل هذا الاستيراد بيانات البصمة والحالة الحالية للسجلات المتكررة في نفس التاريخ، ويعيدها إلى حالة غير مراجعة.</small></span></label>}
      {unmatchedCount > 0 && <p className="attendance-error-note">{unmatchedCount} كود بصمة غير مرتبط بموظف؛ راجع بيانات كود البصمة في ملفات الموظفين أولًا.</p>}
      <div className="table-wrap attendance-table-wrap"><table className="attendance-import-table"><thead><tr><th>التاريخ</th><th>كود البصمة</th><th>الموظف في النظام</th><th>الاسم في التقرير</th><th>أول دخول</th><th>آخر خروج</th><th>مدة العمل</th><th>الحالة</th></tr></thead><tbody>{rows.slice(0, 25).map((row) => <tr key={`${row.employeeCode}-${row.date}-${row.line}`}><td className="code-cell">{row.date}</td><td className="code-cell">{row.employeeCode}</td><td>{row.employee?.full_name || [row.employee?.first_name, row.employee?.last_name].filter(Boolean).join(" ") || <span className="attendance-unmatched">غير مرتبط</span>}</td><td>{row.sourceName || "—"}</td><td className="code-cell">{row.firstIn ?? "—"}</td><td className="code-cell">{row.lastOut ?? "—"}</td><td className="code-cell">{row.totalWork?.slice(0, 5) ?? "—"}</td><td><span className={`attendance-status ${row.status}`}>{row.statusLabel}</span></td></tr>)}</tbody></table></div>
      {rows.length > 25 && <p className="preview-foot">تعرض أول 25 سجلًا؛ سيُحفظ كامل الملف وعدده {rows.length} سجلًا.</p>}
      <p className="preview-foot">يُطابق التقرير حسب كود البصمة، ويُحفظ وقت الحضور ومدة العمل ومحتوى صف المصدر كما ورد في الملف.</p>
    </section>}
  </div>;
}
