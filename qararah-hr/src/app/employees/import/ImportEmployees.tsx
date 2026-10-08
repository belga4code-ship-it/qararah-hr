"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { readSheet } from "read-excel-file/browser";
import { createClient } from "@/lib/supabase/client";

type ImportEmployee = {
  employeeNumber: string;
  fullName: string;
  zktUserId: string | null;
  jobTitle: string;
  department: string;
  branch: string;
  branchCode: string | null;
  hiredOn: string | null;
  status: "active" | "needs_review";
  statusLabel: string;
};

const requiredHeaders = ["الكود الوظيفى", "الاسم", "الوظيفة", "القسم", "الفرع"];

function clean(value: unknown) {
  return value == null ? "" : String(value).replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
}

function asDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const text = clean(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

function makeRows(rows: unknown[][]) {
  const headerRow = rows.findIndex((row) => requiredHeaders.every((header) => row.some((cell) => clean(cell) === header)));
  if (headerRow < 0) throw new Error("لم نجد أعمدة قاعدة الموظفين المطلوبة في هذا الملف.");

  const headers = rows[headerRow].map(clean);
  const column = (name: string) => headers.indexOf(name);
  const dataRows = rows.slice(headerRow + 1).filter((row) => row.some((cell) => clean(cell) !== ""));
  const employees: ImportEmployee[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  dataRows.forEach((row, index) => {
    const line = headerRow + index + 2;
    const employeeNumber = clean(row[column("الكود الوظيفى")]);
    const fullName = clean(row[column("الاسم")]);
    const jobTitle = clean(row[column("الوظيفة")]);
    const department = clean(row[column("القسم")]);
    const branch = clean(row[column("الفرع")]);
    if (!employeeNumber || !fullName || !jobTitle || !department || !branch) {
      errors.push(`صف ${line}: ينقصه كود الموظف أو الاسم أو الوظيفة أو القسم أو الفرع.`);
      return;
    }
    if (seen.has(employeeNumber)) {
      errors.push(`صف ${line}: الكود الوظيفي مكرر في الملف.`);
      return;
    }
    seen.add(employeeNumber);
    const sourceStatus = clean(row[column("الحالة")]);
    const isActive = sourceStatus === "نشط";
    employees.push({
      employeeNumber,
      fullName,
      zktUserId: clean(row[column("كود البصمة")]) || null,
      jobTitle,
      department,
      branch,
      branchCode: clean(row[column("رمز الفرع")]) || null,
      hiredOn: asDate(row[column("تاريخ التعيين بالشركة")]),
      status: isActive ? "active" : "needs_review",
      statusLabel: isActive ? "نشط" : sourceStatus ? "مراجعة الحالة" : "الحالة غير محددة",
    });
  });

  return { employees, errors };
}

export default function ImportEmployees() {
  const [rows, setRows] = useState<ImportEmployee[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRows([]);
    setParseErrors([]);
    setMessage("");
    setDone(false);
    if (!file) return;
    setFileName(file.name);

    try {
      const data = await readSheet(file, "DATA BAISE 2026");
      const parsed = makeRows(data as unknown[][]);
      setRows(parsed.employees);
      setParseErrors(parsed.errors);
      if (!parsed.employees.length && !parsed.errors.length) setMessage("لم نجد سجلات موظفين في الورقة.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر قراءة ملف Excel.");
    }
  }

  async function importRows() {
    if (!rows.length || parseErrors.length) return;
    setBusy(true);
    setMessage("");

    try {
      const supabase = createClient();
      const departmentNames = [...new Set(rows.map((row) => row.department))];
      const branchNames = [...new Set(rows.map((row) => row.branch))];
      const departmentsResult = await supabase.from("departments").upsert(departmentNames.map((name) => ({ name })), { onConflict: "name" }).select("id,name");
      if (departmentsResult.error) throw departmentsResult.error;
      const branchesResult = await supabase.from("branches").upsert(branchNames.map((name) => ({ name, branch_code: rows.find((row) => row.branch === name)?.branchCode ?? null, is_active: true })), { onConflict: "name" }).select("id,name");
      if (branchesResult.error) throw branchesResult.error;

      const departmentIds = new Map((departmentsResult.data ?? []).map((item) => [item.name, item.id]));
      const branchIds = new Map((branchesResult.data ?? []).map((item) => [item.name, item.id]));
      const titleKeys = [...new Map(rows.map((row) => [`${row.jobTitle}\u0000${row.department}`, { name: row.jobTitle, department_id: departmentIds.get(row.department) }])).values()];
      if (titleKeys.some((item) => !item.department_id)) throw new Error("تعذر ربط بعض الأقسام. تأكد من تشغيل ترحيل قاعدة بيانات الموظفين.");
      const titlesResult = await supabase.from("job_titles").upsert(titleKeys, { onConflict: "name,department_id" }).select("id,name,department_id");
      if (titlesResult.error) throw titlesResult.error;
      const titleIds = new Map((titlesResult.data ?? []).map((item) => [`${item.name}\u0000${item.department_id}`, item.id]));
      const employeeRows = rows.map((row) => ({
        employee_number: row.employeeNumber,
        first_name: row.fullName,
        last_name: null,
        full_name: row.fullName,
        zkt_user_id: row.zktUserId,
        branch_id: branchIds.get(row.branch),
        department_id: departmentIds.get(row.department),
        job_title_id: titleIds.get(`${row.jobTitle}\u0000${departmentIds.get(row.department)}`),
        hired_on: row.hiredOn,
        status: row.status,
      }));
      if (employeeRows.some((row) => !row.branch_id || !row.department_id || !row.job_title_id)) throw new Error("تعذر ربط الفرع أو القسم أو الوظيفة لبعض الموظفين.");
      for (let index = 0; index < employeeRows.length; index += 75) {
        const { error } = await supabase.from("employees").upsert(employeeRows.slice(index, index + 75), { onConflict: "employee_number" });
        if (error) throw error;
      }
      setDone(true);
      setMessage(`تم استيراد ${employeeRows.length} سجل موظف بنجاح.`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "تعذر حفظ البيانات.";
      setMessage(["needs_review", "employee_private", "job_titles_name_department", "branch_code", "full_name"].some((part) => text.includes(part))
        ? "قاعدة البيانات تحتاج التهيئة الجديدة قبل الاستيراد. شغّل ملف ترحيل قاعدة الموظفين من SQL Editor ثم أعد المحاولة."
        : text);
    } finally {
      setBusy(false);
    }
  }

  const reviewCount = rows.filter((row) => row.status === "needs_review").length;
  const missingFingerprint = rows.filter((row) => !row.zktUserId).length;

  return (
    <div className="import-layout">
      <section className="panel import-panel">
        <div className="panel-heading"><div><h2>رفع ملف الموظفين</h2><p>اختر ملف Excel بصيغة .xlsx يحتوي على ورقة DATA BAISE 2026.</p></div></div>
        <label className="file-drop">
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} />
          <span className="upload-symbol">⇧</span>
          <strong>{fileName || "اختار ملف Excel من جهازك"}</strong>
          <span>يدعم الملف الذي أرسلته، وتتم قراءة الأعمدة الوظيفية المطلوبة فقط.</span>
        </label>
        <div className="privacy-note"><strong>البيانات التي ستُستورد</strong><span>الكود الوظيفي، الاسم، كود البصمة، الوظيفة، القسم، الفرع، رمز الفرع وتاريخ التعيين.</span><span>لن نرسل الرواتب أو أرقام الهواتف أو الجوازات أو العناوين أو بقية البيانات الشخصية.</span></div>
        {message && <p className={`import-message${done ? " success" : ""}`} role="status">{message}</p>}
      </section>

      {rows.length > 0 && <section className="panel import-preview">
        <div className="panel-heading"><div><h2>معاينة قبل الحفظ</h2><p>{rows.length} موظفًا · {missingFingerprint} بلا كود بصمة · {reviewCount} حالة تحتاج مراجعة</p></div><button className="primary-button" type="button" onClick={importRows} disabled={busy || done || parseErrors.length > 0}>{busy ? "جارٍ الاستيراد..." : done ? "تم الاستيراد" : "استيراد الموظفين"}</button></div>
        {parseErrors.length > 0 && <div className="import-errors"><strong>أصلح الملف قبل الاستيراد:</strong>{parseErrors.slice(0, 8).map((error) => <span key={error}>{error}</span>)}{parseErrors.length > 8 && <span>وهناك {parseErrors.length - 8} أخطاء أخرى.</span>}</div>}
        <div className="table-wrap"><table><thead><tr><th>الكود الوظيفي</th><th>اسم الموظف</th><th>كود البصمة</th><th>الوظيفة</th><th>القسم</th><th>الفرع</th><th>الحالة عند الاستيراد</th></tr></thead><tbody>{rows.slice(0, 10).map((row) => <tr key={row.employeeNumber}><td className="code-cell">{row.employeeNumber}</td><td>{row.fullName}</td><td className="code-cell">{row.zktUserId ?? "غير مسجل"}</td><td>{row.jobTitle}</td><td>{row.department}</td><td>{row.branch}</td><td><span className={`status-pill ${row.status === "active" ? "green" : "amber"}`}>{row.statusLabel}</span></td></tr>)}</tbody></table></div>
        {rows.length > 10 && <p className="preview-foot">تعرض المعاينة أول 10 سجلات؛ سيتم حفظ {rows.length} سجلًا.</p>}
        <p className="preview-foot">السجلات التي لا تحمل حالة واضحة ستُحفظ كـ «تحتاج مراجعة»، ولن تُصنف نشطة تلقائيًا. إذا تكرر الكود الوظيفي مع سجل موجود، سيتم تحديث بيانات العمل لذلك السجل.</p>
      </section>}
    </div>
  );
}
