"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";
import { lateMinutesAfter915 } from "@/lib/attendance";

type MonthlyEmployee = {
  id: string;
  employee_number: string | null;
  zkt_user_id: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
  branch: { name: string } | null;
  job_title: { name: string } | null;
};
type MonthlyPunch = { employee_id: string; attendance_date: string; first_in: string | null };
const statusLabels: Record<string, string> = { active: "نشط", on_leave: "في إجازة", suspended: "موقوف", terminated: "منتهي الخدمة", needs_review: "يحتاج مراجعة" };

export default function MonthlyTardinessExport({ month }: { month: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function exportMonth() {
    if (busy || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    setBusy(true);
    setMessage("");
    try {
      const [year, monthNumber] = month.split("-").map(Number);
      const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
      const monthStart = `${month}-01`;
      const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
      const supabase = createClient();
      const [{ data: employeeData, error: employeeError }, { data: punchData, error: punchError }] = await Promise.all([
        supabase.from("employees").select("id,employee_number,zkt_user_id,full_name,first_name,last_name,status,branch:branches(name),job_title:job_titles(name)").order("employee_number"),
        supabase.from("attendance_records").select("employee_id,attendance_date,first_in").gte("attendance_date", monthStart).lte("attendance_date", monthEnd),
      ]);
      if (employeeError) throw employeeError;
      if (punchError) throw punchError;
      const employees = (employeeData ?? []) as unknown as MonthlyEmployee[];
      const punches = (punchData ?? []) as MonthlyPunch[];
      const totals = new Map<string, [number, number, number, number]>();
      for (const employee of employees) totals.set(employee.id, [0, 0, 0, 0]);
      for (const punch of punches) {
        const lateMinutes = lateMinutesAfter915(punch.first_in);
        if (lateMinutes === null) continue;
        const values = totals.get(punch.employee_id);
        const day = Number(punch.attendance_date.slice(8, 10));
        if (!values || !Number.isFinite(day)) continue;
        const weekIndex = Math.min(3, Math.floor((day - 1) / 7));
        values[weekIndex] += lateMinutes;
      }

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "نظام الموارد البشرية - قرارة";
      const sheet = workbook.addWorksheet("التأخير الشهري", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
      sheet.mergeCells("A1:L1");
      sheet.getCell("A1").value = `تقرير التأخير الشهري - ${month}`;
      sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123B5D" } };
      sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(1).height = 32;
      sheet.mergeCells("A2:L2");
      sheet.getCell("A2").value = "التأخير محسوب بالدقائق بعد 09:15. الأسبوع 1: الأيام 1–7، 2: 8–14، 3: 15–21، 4: 22 إلى نهاية الشهر.";
      sheet.getCell("A2").alignment = { horizontal: "center", wrapText: true };
      sheet.getCell("A2").font = { color: { argb: "FF475569" }, size: 10 };
      sheet.getRow(2).height = 26;
      sheet.addRow([]);
      const weekLabels = [`الأسبوع 1 (1–7)`, `الأسبوع 2 (8–14)`, `الأسبوع 3 (15–21)`, `الأسبوع 4 (22–${lastDay})`];
      sheet.addRow(["م", "الكود الوظيفي", "كود البصمة", "اسم الموظف", "الصفة", "الفرع", "الحالة الوظيفية", ...weekLabels.map((label) => `${label} · دقيقة`), "إجمالي الشهر · دقيقة"]);
      const header = sheet.getRow(4);
      header.height = 36;
      header.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF167D75" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
      employees.sort((a, b) => (a.branch?.name ?? "").localeCompare(b.branch?.name ?? "", "ar") || (a.full_name ?? a.first_name ?? "").localeCompare(b.full_name ?? b.first_name ?? "", "ar"));
      const monthTotals = [0, 0, 0, 0];
      employees.forEach((employee, index) => {
        const weekly = totals.get(employee.id) ?? [0, 0, 0, 0];
        weekly.forEach((value, i) => { monthTotals[i] += value; });
        const name = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ") || "موظف غير معروف";
        const row = sheet.addRow([index + 1, toWesternDigits(employee.employee_number ?? "—"), toWesternDigits(employee.zkt_user_id ?? "—"), toWesternDigits(name), toWesternDigits(employee.job_title?.name ?? "غير محددة"), toWesternDigits(employee.branch?.name ?? "—"), statusLabels[employee.status] ?? "غير محددة", ...weekly, weekly.reduce((sum, value) => sum + value, 0)]);
        row.eachCell((cell) => { cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.font = { size: 10, color: { argb: "FF334155" } }; cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } }; });
        if (index % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7FAFC" } }; });
      });
      const totalsRow = sheet.addRow(["", "", "", "", "", "", "إجمالي دقائق التأخير", ...monthTotals, monthTotals.reduce((sum, value) => sum + value, 0)]);
      totalsRow.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FF123B5D" }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0F8" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
      [7, 18, 16, 27, 23, 19, 18, 20, 20, 20, 23, 22].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
      sheet.autoFilter = { from: "A4", to: `L${Math.max(4, sheet.rowCount - 1)}` };
      sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `تقرير-التأخير-${month}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`تم تصدير تأخير ${toWesternDigits(employees.length)} موظفًا لشهر ${month}.`);
    } catch (error) {
      setMessage(error instanceof Error ? `تعذر إعداد التقرير: ${error.message}` : "تعذر إعداد التقرير.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="monthly-tardiness-action"><button type="button" className="monthly-tardiness-button" onClick={exportMonth} disabled={busy}><span aria-hidden="true">▤</span>{busy ? "جارٍ تجهيز التقرير…" : "تصدير التأخير الشهري"}</button>{message && <span className="monthly-tardiness-message" role="status">{message}</span>}</div>;
}
