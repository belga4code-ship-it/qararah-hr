"use client";

import { useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";

const DAYS = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"] as const;
const BRANCHES = [
  { sheet: "التعمير", aliases: ["التعمير"], end: ["18:30", "18:30", "18:30", "18:30", "18:30", "14:30", ""] },
  { sheet: "إنباك-", aliases: ["النباك", "انبك", "إنباك"], end: ["18:00", "18:00", "18:00", "18:00", "14:30", "14:30", ""] },
  { sheet: "GR", aliases: ["gr"], end: ["17:30", "17:30", "17:30", "17:30", "17:30", "14:30", ""] },
  { sheet: "الرئيسى", aliases: ["الرئيسي", "الرئيسى", "الإدارة الرئيسية مصراتة"], end: ["17:30", "17:30", "17:30", "17:30", "17:30", "14:30", ""] },
  { sheet: "فرع السبعةVIP", aliases: ["vip", "السبعة", "السبعة & vip", "مصنع قص vip"], end: ["17:30", "17:30", "17:30", "17:30", "17:30", "14:30", ""] },
  { sheet: "وادى الربيع", aliases: ["وادي الربيع", "وادى الربيع"], end: ["18:00", "18:00", "18:00", "18:00", "18:00", "14:30", ""] },
  { sheet: "عين زارة", aliases: ["عين زارة"], end: ["17:30", "17:30", "17:30", "17:30", "17:30", "14:30", ""] },
];
type Schedule = Record<string, Record<string, { start: string; end: string }>>;
type Row = { employee_id: string; attendance_date: string; first_in: string | null; last_out: string | null; total_work: string | null; status: string; exception_note: string | null; employee: { employee_number: string | null; zkt_user_id: string | number | null; full_name: string | null; first_name: string | null; last_name: string | null; branch: { name: string | null } | null } | null };
const dayIndex = (date: string) => (new Date(`${date}T12:00:00`).getDay() + 1) % 7;
const normalize = (value: string) => value.trim().toLocaleLowerCase("ar").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي");
const minutes = (value?: string | null) => { if (!value) return null; const match = value.match(/(\d{1,2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };
const timeText = (value?: string | null) => value ? toWesternDigits(value.slice(0, 5)) : "";
const timeInput = (value: string) => toWesternDigits(value).replace(/[^0-9:]/g, "").slice(0, 5);
const duration = (a: string | null, b: string | null) => { const x = minutes(a), y = minutes(b); return x === null || y === null ? "" : `${Math.floor(Math.max(0, y - x) / 60)}:${String(Math.max(0, y - x) % 60).padStart(2, "0")}`; };
const currentWeek = () => { const now = new Date(); const d = (now.getDay() + 1) % 7; now.setDate(now.getDate() - d); return now.toISOString().slice(0, 10); };
const plusDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const monthBounds = (month: string, period: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  if (period === "all") return [`${month}-01`, `${month}-${String(lastDay).padStart(2, "0")}`] as const;
  const firstDay = (Number(period) - 1) * 7 + 1;
  const finalDay = Math.min(firstDay + 6, lastDay);
  return [`${month}-${String(firstDay).padStart(2, "0")}`, `${month}-${String(finalDay).padStart(2, "0")}`] as const;
};
const MONTH_NAMES = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

function initialSchedule(): Schedule {
  return Object.fromEntries(BRANCHES.map((branch) => [branch.sheet, Object.fromEntries(DAYS.map((day, i) => [day, { start: i === 6 ? "" : "09:00", end: branch.end[i] }]))]));
}

export default function WeeklyAttendanceReport() {
  const [start, setStart] = useState(currentWeek());
  const [end, setEnd] = useState(plusDays(currentWeek(), 6));
  const [selectedMonth, setSelectedMonth] = useState(currentWeek().slice(0, 7));
  const [selectedPeriod, setSelectedPeriod] = useState("custom");
  const [schedule, setSchedule] = useState<Schedule>(initialSchedule);
  const [selectedBranch, setSelectedBranch] = useState(BRANCHES[0].sheet);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dates = useMemo(() => { const out: string[] = []; for (let d = start, i = 0; d <= end && i < 31; d = plusDays(d, 1), i++) out.push(d); return out; }, [start, end]);

  const updateSchedule = (branch: string, day: string, key: "start" | "end", value: string) => setSchedule((old) => ({ ...old, [branch]: { ...old[branch], [day]: { ...old[branch][day], [key]: value } } }));
  const applyPeriod = (month: string, period: string) => {
    setSelectedMonth(month);
    setSelectedPeriod(period);
    if (period !== "custom") {
      const [from, to] = monthBounds(month, period);
      setStart(from);
      setEnd(to);
    }
  };

  async function createReport() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end || dates.length > 31) { setMessage("أدخل تاريخي بداية ونهاية صحيحين بصيغة YYYY-MM-DD."); return; }
    setBusy(true); setMessage("");
    try {
      const supabase = createClient();
      const all: Row[] = [];
      for (let from = start, page = 0; from <= end && page < 31; from = plusDays(from, 1), page++) {
        const { data, error } = await supabase.from("attendance_records").select("employee_id,attendance_date,first_in,last_out,total_work,status,exception_note,employee:employees(employee_number,zkt_user_id,full_name,first_name,last_name,branch:branches(name))").eq("attendance_date", from).order("first_in", { ascending: true, nullsFirst: false });
        if (error) throw error;
        all.push(...((data ?? []) as unknown as Row[]));
      }
      if (!all.length) { setMessage("لا توجد سجلات حضور للفترة المحددة."); return; }

      const groups = new Map<string, Row[]>();
      for (const row of all) {
        const name = row.employee?.branch?.name ?? "فرع غير محدد";
        const normalized = normalize(name);
        const match = BRANCHES.find((b) => b.aliases.some((alias) => normalized === normalize(alias)));
        const key = match?.sheet ?? name;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "نظام الموارد البشرية - قرارة";
      workbook.created = new Date();
      const groupEntries = [...groups.entries()];
      for (const [branchName, rows] of groupEntries) {
        const sheet = workbook.addWorksheet(branchName.slice(0, 31), { views: [{ rightToLeft: true, state: "frozen", ySplit: 5 }] });
        sheet.mergeCells("A1:Q1"); sheet.getCell("A1").value = `تقرير الحضور والانصراف الأسبوعي - ${branchName}`;
        sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } }; sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123B5D" } }; sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }; sheet.getRow(1).height = 31;
        sheet.mergeCells("A2:Q2"); sheet.getCell("A2").value = `الفترة: ${start} إلى ${end}    |    إجمالي السجلات: ${rows.length}`; sheet.getCell("A2").alignment = { horizontal: "center" }; sheet.getCell("A2").font = { color: { argb: "FF475569" }, size: 10 };
        sheet.mergeCells("A3:Q3"); sheet.getCell("A3").value = "إجمالي التأخير الأسبوعي محسوب آليًا من مجموع دقائق تأخير الدخول لكل موظف."; sheet.getCell("A3").alignment = { horizontal: "center" }; sheet.getCell("A3").font = { italic: true, color: { argb: "FF0F766E" }, size: 10 };
        sheet.addRow([]); sheet.addRow(["م", "كود الموظف", "الاسم", "التاريخ", "اليوم", "بداية الدوام", "نهاية الدوام", "ساعات الدوام", "الحضور", "الانصراف", "ساعات العمل", "ملاحظات", "تأخير الدخول (دقيقة)", "انصراف مبكر (دقيقة)", "إضافي (دقيقة)", "إجمالي التأخير الأسبوعي", "الوحدة"]);
        const header = sheet.getRow(5); header.height = 32; header.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF167D75" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
        const employeeTotals = new Map<string, number>();
        const computed = rows.map((r) => {
          const branch = BRANCHES.find((b) => b.sheet === branchName);
          const day = DAYS[dayIndex(r.attendance_date)];
          const sched = schedule[branchName]?.[day] ?? { start: "", end: "" };
          const late = r.first_in && sched.start ? Math.max(0, (minutes(r.first_in) ?? 0) - (minutes(sched.start) ?? 0)) : 0;
          employeeTotals.set(r.employee_id, (employeeTotals.get(r.employee_id) ?? 0) + late);
          const early = r.last_out && sched.end ? Math.max(0, (minutes(sched.end) ?? 0) - (minutes(r.last_out) ?? 0)) : 0;
          const overtime = r.last_out && sched.end ? Math.max(0, (minutes(r.last_out) ?? 0) - (minutes(sched.end) ?? 0)) : 0;
          const fullName = r.employee?.full_name || [r.employee?.first_name, r.employee?.last_name].filter(Boolean).join(" ") || "—";
          return { r, sched, day, late, early, overtime, fullName: toWesternDigits(fullName), code: toWesternDigits(r.employee?.zkt_user_id ?? r.employee?.employee_number ?? "—"), branch };
        });
        const seenWeekly = new Set<string>();
        computed.forEach(({ r, sched, day, late, early, overtime, fullName, code }, index) => {
          const statusNote = r.status === "leave" ? "إجازة" : r.status === "absent" ? "غياب" : r.status === "incomplete" ? "بصمة ناقصة" : r.status === "needs_review" ? "تحتاج مراجعة" : "";
          const note = toWesternDigits([statusNote, r.exception_note].filter(Boolean).join(" - "));
          const dailyHours = duration(sched.start ? `${sched.start}:00` : null, sched.end ? `${sched.end}:00` : null);
          const work = r.total_work || duration(r.first_in, r.last_out);
          const weekly = seenWeekly.has(r.employee_id) ? "" : employeeTotals.get(r.employee_id) ?? 0;
          seenWeekly.add(r.employee_id);
          const row = sheet.addRow([index + 1, code, fullName, r.attendance_date, day, sched.start, sched.end, dailyHours, timeText(r.first_in) || (r.status === "absent" ? "غياب" : ""), timeText(r.last_out), work, note, late || "", early || "", overtime || "", weekly, weekly === "" ? "" : "دقيقة"]);
          row.eachCell((cell) => { cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; cell.font = { size: 10, color: { argb: "FF334155" } }; cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } }; });
          if (index % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7FAFC" } }; });
          row.getCell(3).alignment = { horizontal: "right", vertical: "middle" };
          row.getCell(12).alignment = { horizontal: "right", vertical: "middle", wrapText: true };
        });
        [7, 16, 24, 15, 13, 13, 13, 13, 12, 12, 14, 30, 15, 15, 14, 18, 12].forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
        sheet.autoFilter = { from: "A5", to: `Q${sheet.rowCount}` };
        sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
        sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 5 }];
        void branchName;
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `تقرير-الحضور-${start}-${end}.xlsx`; anchor.click(); URL.revokeObjectURL(url);
      setMessage(`تم تجهيز التقرير بعدد ${all.length} سجلًا في ${groupEntries.length} أوراق.`);
    } catch (error) {
      setMessage(error instanceof Error ? `تعذر إنشاء التقرير: ${error.message}` : "تعذر إنشاء التقرير.");
    } finally { setBusy(false); }
  }

  return <div className="attendance-report-layout">
    <section className="panel attendance-upload-panel">
      <div className="attendance-panel-heading"><div><h2>فترة التقرير</h2><p>اختر تاريخ البداية والنهاية؛ تُجمع كل السجلات بينهما.</p></div><span className="attendance-step">إعداد التقرير</span></div>
      <div className="report-date-fields report-period-fields"><label>الشهر<select value={selectedMonth} onChange={(e) => applyPeriod(e.target.value, selectedPeriod === "custom" ? "all" : selectedPeriod)}>{Array.from({ length: 9 }, (_, i) => new Date().getFullYear() - 5 + i).flatMap((year) => MONTH_NAMES.map((monthName, i) => { const value = `${year}-${String(i + 1).padStart(2, "0")}`; return <option key={value} value={value}>{monthName} {year}</option>; }))}</select></label><label>الفترة<select value={selectedPeriod} onChange={(e) => applyPeriod(selectedMonth, e.target.value)}><option value="custom">تاريخ مخصص</option><option value="1">الأسبوع الأول · 1–7</option><option value="2">الأسبوع الثاني · 8–14</option><option value="3">الأسبوع الثالث · 15–21</option><option value="4">الأسبوع الرابع · 22–نهاية الشهر</option><option value="all">كل الشهر</option></select></label><label>من تاريخ<input type="text" inputMode="numeric" dir="ltr" placeholder="YYYY-MM-DD" maxLength={10} value={start} onChange={(e) => { const value = toWesternDigits(e.target.value).replace(/[^0-9-]/g, "").slice(0, 10); setStart(value); setSelectedPeriod("custom"); if (value && end < value) setEnd(value); }} /></label><label>إلى تاريخ<input type="text" inputMode="numeric" dir="ltr" placeholder="YYYY-MM-DD" maxLength={10} value={end} onChange={(e) => { setEnd(toWesternDigits(e.target.value).replace(/[^0-9-]/g, "").slice(0, 10)); setSelectedPeriod("custom"); }} /></label><div className="report-days-hint">{toWesternDigits(dates.length)} أيام محددة</div></div>
    </section>
    <section className="panel attendance-upload-panel report-schedule-panel">
      <div className="attendance-panel-heading"><div><h2>الدوام الرسمي حسب الفرع</h2><p>هذه القيم افتراضية من نموذج التقرير، ويمكن تعديلها لهذا التقرير قبل التنزيل.</p></div><span className="attendance-step">تعديل خاص بهذا التقرير</span></div>
      <div className="report-branch-tabs" role="tablist" aria-label="اختيار فرع الدوام">{BRANCHES.map((branch) => <button className={`report-branch-tab${selectedBranch === branch.sheet ? " active" : ""}`} type="button" role="tab" aria-selected={selectedBranch === branch.sheet} key={branch.sheet} onClick={() => setSelectedBranch(branch.sheet)}><span className="report-branch-tab-icon">{branch.sheet.slice(0, 1)}</span><span>{branch.sheet}</span><small>7 أيام</small></button>)}</div>
      {BRANCHES.filter((branch) => branch.sheet === selectedBranch).map((branch) => <article className="report-branch-editor" role="tabpanel" key={branch.sheet}><div className="report-branch-editor-heading"><div><span className="report-branch-overline">جدول الدوام الرسمي</span><h3>{branch.sheet}</h3><p>عدّل وقت بداية ونهاية الدوام لكل يوم. هذه التغييرات خاصة بالتقرير الحالي.</p></div><span className="report-branch-days-badge">{toWesternDigits(DAYS.filter((day) => schedule[branch.sheet]?.[day]?.start && schedule[branch.sheet]?.[day]?.end).length)} أيام عمل</span></div><div className="report-schedule-table-wrap"><table className="report-schedule-table"><thead><tr><th>اليوم</th><th>بداية الدوام</th><th>نهاية الدوام</th><th>الحالة</th></tr></thead><tbody>{DAYS.map((day) => { const daySchedule = schedule[branch.sheet]?.[day] ?? { start: "", end: "" }; const off = !daySchedule.start && !daySchedule.end; return <tr key={day}><th scope="row"><span className="report-day-indicator">{toWesternDigits(DAYS.indexOf(day) + 1)}</span>{day}</th><td><label className="report-time-field"><span>من</span><input aria-label={`${branch.sheet} ${day} بداية الدوام`} type="text" inputMode="numeric" dir="ltr" placeholder="09:00" maxLength={5} value={daySchedule.start} onChange={(e) => updateSchedule(branch.sheet, day, "start", timeInput(e.target.value))} /></label></td><td><label className="report-time-field"><span>إلى</span><input aria-label={`${branch.sheet} ${day} نهاية الدوام`} type="text" inputMode="numeric" dir="ltr" placeholder="18:00" maxLength={5} value={daySchedule.end} onChange={(e) => updateSchedule(branch.sheet, day, "end", timeInput(e.target.value))} /></label></td><td><span className={`report-day-status${off ? " off" : ""}`}>{off ? "عطلة" : "دوام"}</span></td></tr>; })}</tbody></table></div></article>)}
    </section>
    <section className="panel report-export-panel"><div><h2>حساب التقرير</h2><p>إجمالي التأخير الأسبوعي = مجموع دقائق تأخير الدخول للموظف خلال الفترة.</p>{message && <div className="report-message" role="status">{message}</div>}</div><button className="primary-button" type="button" onClick={createReport} disabled={busy}>{busy ? "جارٍ تجهيز التقرير…" : "تنزيل تقرير Excel"}</button></section>
  </div>;
}
