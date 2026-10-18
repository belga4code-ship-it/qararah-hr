"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;
const FRIDAY = 5;
const BRANCHES = [
  { label: "التعمير", aliases: ["التعمير"], ends: ["18:30", "18:30", "18:30", "18:30", "18:30", "14:30", ""] },
  { label: "إنباك-", aliases: ["النباك", "انبك", "إنباك"], ends: ["18:00", "18:00", "18:00", "18:00", "14:30", "14:30", ""] },
  { label: "GR", aliases: ["gr"], ends: ["17:30", "17:30", "17:30", "17:30", "17:30", "14:30", ""] },
  { label: "الرئيسى", aliases: ["الرئيسي", "الرئيسى", "الإدارة الرئيسية مصراتة"], ends: ["17:30", "17:30", "17:30", "17:30", "17:30", "14:30", ""] },
  { label: "فرع السبعةVIP", aliases: ["vip", "السبعة", "السبعة & vip", "مصنع قص vip"], ends: ["17:30", "17:30", "17:30", "17:30", "17:30", "14:30", ""] },
  { label: "وادى الربيع", aliases: ["وادي الربيع", "وادى الربيع"], ends: ["18:00", "18:00", "18:00", "18:00", "18:00", "14:30", ""] },
  { label: "عين زارة", aliases: ["عين زارة"], ends: ["17:30", "17:30", "17:30", "17:30", "17:30", "14:30", ""] },
];

type Employee = {
  id: string; employee_number: string | null; zkt_user_id: string | null;
  full_name: string | null; first_name: string; last_name: string | null;
  status: string; hired_on: string | null; attendance_required?: boolean; branch: { name: string } | null;
};
type Punch = {
  employee_id: string; attendance_date: string; first_in: string | null; last_out: string | null;
  total_work: string | null; status: string; exception_note: string | null;
};
type HREvent = { employee_id: string; event_type: string; effective_date: string; end_date: string | null; reason: string | null; status: string };

const normalize = (value: string) => value.trim().toLocaleLowerCase("ar").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي");
const minuteOf = (value?: string | null) => {
  if (!value) return null;
  const match = value.match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const shortTime = (value?: string | null) => value ? toWesternDigits(value.slice(0, 5)) : "";
const hoursBetween = (start: string | null, end: string | null) => {
  const a = minuteOf(start), b = minuteOf(end);
  if (a === null || b === null || b < a) return "";
  const duration = b - a;
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`;
};
const dayName = (date: string) => DAYS[new Date(`${date}T12:00:00`).getDay()];
const dateRange = (from: string, to: string) => {
  const dates: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const last = new Date(`${to}T12:00:00Z`);
  while (cursor <= last && dates.length < 93) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

export default function AttendancePunchExport({ from, to }: { from: string; to: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function exportReport() {
    if (busy || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
    setBusy(true);
    setMessage("");
    try {
      const dates = dateRange(from, to);
      if (!dates.length || dates.length >= 93) throw new Error("الفترة يجب ألا تتجاوز 92 يومًا.");
      const supabase = createClient();
      const [{ data: employeeRows, error: employeeError }, firstPunchPage, { data: eventRows, error: eventError }] = await Promise.all([
        supabase.from("employees").select("id,employee_number,zkt_user_id,full_name,first_name,last_name,status,hired_on,attendance_required,branch:branches(name)").order("employee_number"),
        supabase.from("attendance_records").select("employee_id,attendance_date,first_in,last_out,total_work,status,exception_note").gte("attendance_date", from).lte("attendance_date", to).order("attendance_date").range(0, 999),
        supabase.from("hr_events").select("employee_id,event_type,effective_date,end_date,reason,status").lte("effective_date", to).order("effective_date", { ascending: false }).range(0, 999),
      ]);
      if (employeeError) throw employeeError;
      if (firstPunchPage.error) throw firstPunchPage.error;
      if (eventError) throw eventError;

      const employees = (employeeRows ?? []) as unknown as Employee[];
      const punches = [...((firstPunchPage.data ?? []) as Punch[])];
      for (let offset = punches.length; punches.length > 0 && punches.length % 1000 === 0; offset += 1000) {
        const { data, error } = await supabase.from("attendance_records").select("employee_id,attendance_date,first_in,last_out,total_work,status,exception_note").gte("attendance_date", from).lte("attendance_date", to).order("attendance_date").range(offset, offset + 999);
        if (error) throw error;
        const page = (data ?? []) as Punch[];
        punches.push(...page);
        if (page.length < 1000) break;
      }
      const events = (eventRows ?? []) as HREvent[];
      const eventLabels: Record<string, string> = { leave: "إجازة", late_permission: "إذن تأخير", permission: "إذن خروج / استئذان", mission: "مأمورية" };
      const eventNotes = (employeeId: string, date: string) => events
        .filter((event) => event.employee_id === employeeId && eventLabels[event.event_type] && event.effective_date <= date && (event.end_date ?? event.effective_date) >= date)
        .map((event) => `${eventLabels[event.event_type]} (${event.status === "approved" ? "معتمد" : event.status === "pending" ? "قيد المراجعة" : "مرفوض"})${event.reason ? `: ${event.reason}` : ""}`);
      const punchesByEmployeeDay = new Map(punches.map((punch) => [`${punch.employee_id}:${punch.attendance_date}`, punch]));
      const employeesWithPunches = new Set(punches.map((punch) => punch.employee_id));
      const activeEmployees = employees.filter((employee) => employee.attendance_required !== false && (employee.status === "active" || employeesWithPunches.has(employee.id)));
      const grouped = new Map<string, Employee[]>();
      for (const employee of activeEmployees) {
        const branchName = employee.branch?.name ?? "فرع غير محدد";
        const normalized = normalize(branchName);
        const config = BRANCHES.find((item) => item.aliases.some((alias) => normalized === normalize(alias)));
        const sheetName = config?.label ?? branchName;
        grouped.set(sheetName, [...(grouped.get(sheetName) ?? []), employee]);
      }

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "نظام الموارد البشرية - قرارة";
      workbook.created = new Date();
      const navy = "FF123B5D", teal = "FF167D75", pale = "FFF1F5F9", ink = "FF334155";
      let exportedEmployees = 0;

      for (const [branchName, branchEmployees] of grouped) {
        const sheet = workbook.addWorksheet(branchName.slice(0, 31), { views: [{ rightToLeft: true, state: "frozen", ySplit: 5 }] });
        sheet.mergeCells("A1:Q1");
        sheet.getCell("A1").value = `تقرير الحضور والانصراف - ${branchName}`;
        sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
        sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
        sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
        sheet.getRow(1).height = 32;
        sheet.mergeCells("A2:Q2");
        sheet.getCell("A2").value = `الفترة: ${from} إلى ${to}  |  بداية الدوام: 09:00  |  يوم الجمعة عطلة أسبوعية`;
        sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
        sheet.getCell("A2").font = { size: 10, color: { argb: ink } };
        sheet.getRow(2).height = 24;
        sheet.mergeCells("A3:Q3");
        sheet.getCell("A3").value = "التأخير والانصراف المبكر والإضافي محسوب بالدقائق مقارنة بجدول الدوام الرسمي. السطر الخالي من البصمة لا يُحتسب غيابًا تلقائيًا.";
        sheet.getCell("A3").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        sheet.getCell("A3").font = { italic: true, size: 9, color: { argb: "FF0F766E" } };
        sheet.getRow(3).height = 30;

        sheet.mergeCells("A4:A5"); sheet.getCell("A4").value = "م";
        sheet.mergeCells("B4:B5"); sheet.getCell("B4").value = "كود البصمة";
        sheet.mergeCells("C4:C5"); sheet.getCell("C4").value = "اسم الموظف";
        sheet.mergeCells("D4:D5"); sheet.getCell("D4").value = "التاريخ";
        sheet.mergeCells("E4:E5"); sheet.getCell("E4").value = "اليوم";
        sheet.mergeCells("F4:H4"); sheet.getCell("F4").value = "الدوام الرسمي";
        sheet.mergeCells("I4:K4"); sheet.getCell("I4").value = "الحضور الفعلي";
        sheet.mergeCells("L4:O4"); sheet.getCell("L4").value = "الملاحظات والتأثيرات";
        sheet.mergeCells("P4:Q4"); sheet.getCell("P4").value = "إجمالي التأخير خلال الفترة";
        ["بداية الدوام", "نهاية الدوام", "ساعات الدوام", "وقت الحضور", "وقت الانصراف", "ساعات العمل", "ملاحظات", "تأخير (دقيقة)", "مبكر (دقيقة)", "إضافي (دقيقة)", "عدد الأيام", "دقيقة"].forEach((value, index) => { sheet.getCell(5, index + 6).value = value; });
        for (const rowNum of [4, 5]) {
          const row = sheet.getRow(rowNum);
          row.height = rowNum === 4 ? 28 : 36;
          row.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
        }

        branchEmployees.sort((a, b) => (a.employee_number ?? "").localeCompare(b.employee_number ?? "", "en", { numeric: true }));
        let rowNo = 0;
        for (const employee of branchEmployees) {
          const employeeDates = dates.filter((date) => {
            const weekday = new Date(`${date}T12:00:00`).getDay();
            return weekday !== FRIDAY && (!employee.hired_on || employee.hired_on <= date);
          });
          const config = BRANCHES.find((item) => item.label === branchName);
          const startRow = sheet.rowCount + 1;
          let lateDays = 0, lateMinutes = 0;
          for (const date of employeeDates) {
            const punch = punchesByEmployeeDay.get(`${employee.id}:${date}`);
            const weekday = new Date(`${date}T12:00:00`).getDay();
            const scheduledEnd = config ? config.ends[(weekday + 1) % 7] : (weekday === 6 ? "14:30" : "17:30");
            const scheduledStart = "09:00";
            const actualIn = minuteOf(punch?.first_in), actualOut = minuteOf(punch?.last_out);
            const late = actualIn === null ? 0 : Math.max(0, actualIn - (minuteOf(scheduledStart) ?? 0));
            const early = actualOut === null ? 0 : Math.max(0, (minuteOf(scheduledEnd) ?? 0) - actualOut);
            const overtime = actualOut === null ? 0 : Math.max(0, actualOut - (minuteOf(scheduledEnd) ?? 0));
            if (late > 0) { lateDays++; lateMinutes += late; }
            const statusNote = punch?.status === "leave" ? "إجازة" : punch?.status === "absent" ? "غياب" : punch?.status === "incomplete" ? "بصمة ناقصة" : punch?.status === "needs_review" ? "تحتاج مراجعة" : "";
            const annotations = eventNotes(employee.id, date);
            const note = [...annotations, statusNote, punch?.exception_note, !punch && !annotations.some((item) => item.startsWith("إجازة (معتمد)")) ? "لا توجد بصمة مسجلة" : ""].filter(Boolean).join(" - ");
            const fullName = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ");
            const actualWork = punch?.total_work ? punch.total_work.slice(0, 5) : hoursBetween(punch?.first_in ?? null, punch?.last_out ?? null);
            const row = sheet.addRow([++rowNo, toWesternDigits(employee.zkt_user_id ?? employee.employee_number ?? "—"), toWesternDigits(fullName), date, dayName(date), scheduledStart, scheduledEnd, hoursBetween(`${scheduledStart}:00`, `${scheduledEnd}:00`), shortTime(punch?.first_in), shortTime(punch?.last_out), actualWork, toWesternDigits(note), late || "", early || "", overtime || "", "", ""]);
            row.height = 25;
            row.eachCell((cell) => { cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; cell.font = { size: 9, color: { argb: ink } }; cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } }; });
            row.getCell(3).alignment = { horizontal: "right", vertical: "middle" };
            row.getCell(12).alignment = { horizontal: "right", vertical: "middle", wrapText: true };
            if (rowNo % 2 === 0) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pale } }; });
          }
          const endRow = sheet.rowCount;
          if (endRow >= startRow) {
            sheet.mergeCells(`P${startRow}:P${endRow}`);
            sheet.mergeCells(`Q${startRow}:Q${endRow}`);
            sheet.getCell(`P${startRow}`).value = lateDays;
            sheet.getCell(`Q${startRow}`).value = lateMinutes;
            for (const col of [16, 17]) {
              const cell = sheet.getCell(startRow, col);
              cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
              cell.font = { bold: true, size: 10, color: { argb: navy } };
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0F8" } };
            }
            exportedEmployees++;
          }
        }
        const totalRow = sheet.addRow(["", "", "", "", "", "", "", "", "", "", "", "إجمالي دقائق التأخير بالفرع", "", "", "", "", ""]);
        sheet.mergeCells(`L${totalRow.number}:O${totalRow.number}`);
        const branchLate = branchEmployees.reduce((sum, employee) => sum + dates.reduce((employeeTotal, date) => {
          const punch = punchesByEmployeeDay.get(`${employee.id}:${date}`);
          const weekday = new Date(`${date}T12:00:00`).getDay();
          if (weekday === FRIDAY || !punch?.first_in || (employee.hired_on && employee.hired_on > date)) return employeeTotal;
          const mins = minuteOf(punch.first_in);
          return employeeTotal + (mins === null ? 0 : Math.max(0, mins - 540));
        }, 0), 0);
        totalRow.getCell(16).value = branchLate;
        totalRow.getCell(17).value = "دقيقة";
        totalRow.eachCell((cell) => { cell.font = { bold: true, color: { argb: navy }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0F8" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
        [7, 14, 26, 14, 12, 14, 14, 13, 13, 13, 14, 30, 14, 14, 14, 14, 12].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
        sheet.autoFilter = { from: "A4", to: `Q${sheet.rowCount - 1}` };
        sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.5 } };
        sheet.getColumn(3).alignment = { horizontal: "right", vertical: "middle", wrapText: true };
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `تقرير-الحضور-والانصراف-${from}-${to}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`تم تصدير تقرير ${toWesternDigits(exportedEmployees)} موظفًا عن الفترة المحددة.`);
    } catch (error) {
      setMessage(error instanceof Error ? `تعذر إعداد التقرير: ${error.message}` : "تعذر إعداد التقرير.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="monthly-tardiness-action">
    <button type="button" className="monthly-tardiness-button" onClick={exportReport} disabled={busy} aria-label="استخراج تقرير الحضور والانصراف">
      <span className="monthly-tardiness-icon" aria-hidden="true">▦</span>
      <span className="monthly-tardiness-button-copy"><strong>{busy ? "جارٍ تجهيز التقرير…" : "الحضور والانصراف"}</strong><small>تقرير الموارد البشرية · {from} – {to}</small></span>
      <span className="monthly-tardiness-download" aria-hidden="true">↓</span>
    </button>
    {message && <span className="monthly-tardiness-message" role="status">{message}</span>}
  </div>;
}
