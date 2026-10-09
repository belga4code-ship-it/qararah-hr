"use client";

import { useMemo, useState } from "react";
import { toWesternDigits } from "@/lib/digits";
import { lateMinutesAfter915 } from "@/lib/attendance";

export type AttendanceRecordRow = {
  id: string; employee_id: string; attendance_date: string; first_in: string | null; last_out: string | null; total_work: string | null;
  status: string; exception_note: string | null;
  employee: { employee_number: string; zkt_user_id: string | null; full_name: string | null; first_name: string; last_name: string | null; status: string; hired_on: string | null; job_title: { name: string } | null; branch: { name: string } | null } | null;
};

const labels: Record<string, string> = { present: "حضور", late: "تأخر", absent: "غياب بصمة", incomplete: "بصمة ناقصة", on_mission: "مأمورية", leave: "إجازة", needs_review: "تحتاج مراجعة" };
const employeeStatusLabels: Record<string, string> = { active: "نشط", on_leave: "في إجازة", suspended: "موقوف", terminated: "منتهي الخدمة", needs_review: "يحتاج مراجعة" };

function serviceLength(hiredOn: string | null) {
  if (!hiredOn || !/^\d{4}-\d{2}-\d{2}$/.test(hiredOn)) return "غير محددة";
  const start = new Date(`${hiredOn}T00:00:00Z`);
  const now = new Date();
  let years = now.getUTCFullYear() - start.getUTCFullYear();
  let months = now.getUTCMonth() - start.getUTCMonth();
  if (now.getUTCDate() < start.getUTCDate()) months--;
  if (months < 0) { years--; months += 12; }
  if (years < 0) return "لم يبدأ بعد";
  if (years === 0 && months === 0) return "أقل من شهر";
  const yearText = years ? `${years} ${years === 1 ? "سنة" : "سنوات"}` : "";
  const monthText = months ? `${months} ${months === 1 ? "شهر" : "أشهر"}` : "";
  return toWesternDigits([yearText, monthText].filter(Boolean).join(" و "));
}

function formatTime(value: string | null) {
  if (!value) return "—";
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return toWesternDigits(match ? `${match[1].padStart(2, "0")}:${match[2]}` : value);
}

function formatDelay(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${toWesternDigits(value)} دقيقة`;
  if (!minutes) return `${toWesternDigits(hours)} ساعة`;
  return `${toWesternDigits(hours)} ساعة و${toWesternDigits(minutes)} دقيقة`;
}

export default function AttendanceRecords({ rows }: { rows: AttendanceRecordRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [branch, setBranch] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const branches = useMemo(() => [...new Set(rows.map((row) => row.employee?.branch?.name).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, "ar")), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const name = row.employee?.full_name || [row.employee?.first_name, row.employee?.last_name].filter(Boolean).join(" ") || "";
    const text = [name, row.employee?.employee_number, row.employee?.zkt_user_id, row.employee?.job_title?.name, row.employee?.status, row.employee?.branch?.name].filter(Boolean).map(toWesternDigits).join(" ").toLocaleLowerCase("ar");
    return (!query || text.includes(query.trim().toLocaleLowerCase("ar"))) && (status === "all" || row.status === status) && (branch === "all" || row.employee?.branch?.name === branch);
  }), [rows, query, status, branch]);

  async function exportExcel() {
    if (!filtered.length || exporting) return;
    setExporting(true);
    setExportMessage("");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "نظام الموارد البشرية - قرارة";
      const sheet = workbook.addWorksheet("سجل الحضور", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
      sheet.mergeCells("A1:O1");
      sheet.getCell("A1").value = "سجل الحضور والانصراف";
      sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123B5D" } };
      sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(1).height = 31;
      const reportDates = filtered.map((row) => row.attendance_date).sort();
      sheet.mergeCells("A2:O2");
      sheet.getCell("A2").value = `الفترة: ${toWesternDigits(reportDates[0])} إلى ${toWesternDigits(reportDates.at(-1))} | عدد السجلات: ${toWesternDigits(filtered.length)}`;
      sheet.getCell("A2").alignment = { horizontal: "center" };
      sheet.getCell("A2").font = { color: { argb: "FF475569" }, size: 10 };
      sheet.addRow([]);
      sheet.addRow(["م", "التاريخ", "الكود الوظيفي", "كود البصمة", "اسم الموظف", "الصفة", "حالة الموظف", "الفرع", "أول دخول", "آخر خروج", "مدة العمل", "التأخير", "مدة الخدمة", "حالة الحضور", "ملاحظات"]);
      const header = sheet.getRow(4);
      header.height = 33;
      header.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF167D75" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
      filtered.forEach((row, index) => {
        const employee = row.employee;
        const name = employee?.full_name || [employee?.first_name, employee?.last_name].filter(Boolean).join(" ") || "موظف غير معروف";
        const delay = lateMinutesAfter915(row.first_in);
        const attendanceLabel = row.status === "late" ? "حضور" : labels[row.status] ?? toWesternDigits(row.status);
        const attendanceState = delay !== null ? `${attendanceLabel} - تأخير ${formatDelay(delay)}` : row.status === "late" ? "حضور - تأخير" : attendanceLabel;
        const values = [index + 1, toWesternDigits(row.attendance_date), toWesternDigits(employee?.employee_number ?? "—"), toWesternDigits(employee?.zkt_user_id ?? "—"), toWesternDigits(name), toWesternDigits(employee?.job_title?.name ?? "غير محددة"), employeeStatusLabels[employee?.status ?? ""] ?? "غير محددة", toWesternDigits(employee?.branch?.name ?? "—"), formatTime(row.first_in), formatTime(row.last_out), formatTime(row.total_work), delay ?? (row.status === "late" ? "تأخير" : "—"), serviceLength(employee?.hired_on ?? null), attendanceState, toWesternDigits(row.exception_note ?? "")];
        const output = sheet.addRow(values);
        output.eachCell((cell) => { cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; cell.font = { size: 10, color: { argb: "FF334155" } }; cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } }; });
        if (index % 2 === 1) output.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7FAFC" } }; });
      });
      [7, 14, 17, 15, 28, 22, 17, 19, 14, 14, 14, 14, 21, 22, 30].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
      sheet.autoFilter = { from: "A4", to: `O${sheet.rowCount}` };
      sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `سجل-الحضور-${toWesternDigits(reportDates[0])}-${toWesternDigits(reportDates.at(-1))}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage(`تم تصدير ${toWesternDigits(filtered.length)} سجلًا.`);
    } catch (error) {
      setExportMessage(error instanceof Error ? `تعذر تصدير الملف: ${error.message}` : "تعذر تصدير الملف.");
    } finally {
      setExporting(false);
    }
  }

  return <>
    <div className="attendance-record-tools">
      <label className="attendance-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم أو رقم الموظف أو كود البصمة" aria-label="ابحث في سجلات الحضور" /></label>
      <label className="attendance-filter"><span>الحالة</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">كل الحالات</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="attendance-filter"><span>الفرع</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">كل الفروع</option>{branches.map((name) => <option key={name}>{name}</option>)}</select></label>
      <span className="attendance-result-count">{toWesternDigits(filtered.length)} سجل</span>
    </div>
    <button className="attendance-export-fab" type="button" onClick={exportExcel} disabled={!filtered.length || exporting} style={{ position: "fixed", zIndex: 1200, left: 24, bottom: 22, display: "flex", alignItems: "center", gap: 9, minHeight: 48, padding: "0 17px", border: 0, borderRadius: 13, background: "#0f766e", color: "#fff", boxShadow: "0 8px 24px #0f172a30", font: "inherit", fontSize: 12, fontWeight: 750, cursor: filtered.length && !exporting ? "pointer" : "not-allowed", opacity: filtered.length && !exporting ? 1 : 0.55 }}><span className="attendance-export-icon" aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 27, height: 27, border: "1px solid #ffffff50", borderRadius: 8, fontSize: 17, lineHeight: 1 }}>⇩</span><span>{exporting ? "جارٍ تجهيز Excel…" : "تصدير Excel"}</span></button>
    {exportMessage && <div className="attendance-export-message" role="status">{exportMessage}</div>}
    {filtered.length ? <div className="table-wrap attendance-table-wrap"><table className="attendance-record-table"><thead><tr><th>التاريخ</th><th>الموظف</th><th>الكود الوظيفي</th><th>كود البصمة</th><th>الفرع</th><th>أول دخول</th><th>آخر خروج</th><th>مدة العمل</th><th>الحالة / الملاحظة</th></tr></thead><tbody>{filtered.map((row) => {
      const employee = row.employee;
      const name = employee?.full_name || [employee?.first_name, employee?.last_name].filter(Boolean).join(" ") || "موظف غير معروف";
      const employeeStatus = employeeStatusLabels[employee?.status ?? ""] ?? "غير محددة";
      const jobTitle = employee?.job_title?.name || "المهنة غير محددة";
      const lateMinutes = lateMinutesAfter915(row.first_in);
      const isLate = lateMinutes !== null || row.status === "late";
      const attendanceLabel = row.status === "late" ? "حضور" : labels[row.status] ?? toWesternDigits(row.status);
      return <tr key={row.id}><td className="code-cell attendance-date-cell">{toWesternDigits(row.attendance_date)}</td><td><div className="employee-cell attendance-employee-cell"><span className="employee-avatar">{name.charAt(0)}</span><div className="attendance-employee-meta"><strong>{name}</strong><div className="attendance-employee-details"><span className="attendance-job-title">الصفة: {toWesternDigits(jobTitle)}</span><span className={`attendance-employee-state${employee?.status === "active" ? " active" : ""}`}>{employeeStatus}</span><span className="attendance-tenure">مدة الخدمة: {serviceLength(employee?.hired_on ?? null)}</span></div></div></div></td><td className="code-cell">{toWesternDigits(employee?.employee_number ?? "—")}</td><td className="code-cell">{toWesternDigits(employee?.zkt_user_id ?? "—")}</td><td>{toWesternDigits(employee?.branch?.name ?? "—")}</td><td className="code-cell">{formatTime(row.first_in)}</td><td className="code-cell">{formatTime(row.last_out)}</td><td className="code-cell">{formatTime(row.total_work)}</td><td><span className={`attendance-status ${isLate ? "late" : row.status}`}>{attendanceLabel}</span>{isLate ? <span className="attendance-late-detail">تأخير{lateMinutes !== null ? ` ${formatDelay(lateMinutes)}` : ""}</span> : null}{row.exception_note && <small className="attendance-row-note">{toWesternDigits(row.exception_note)}</small>}</td></tr>;
    })}</tbody></table></div> : <div className="attendance-table-empty">{rows.length ? "ما فيش سجلات تطابق خيارات البحث." : "ما فيش سجلات حضور لهذا اليوم. اختار تاريخًا ثانيًا أو ارفع تقرير ZKT."}</div>}
  </>;
}
