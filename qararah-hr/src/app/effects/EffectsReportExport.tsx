"use client";

import { useMemo, useState } from "react";
import { toWesternDigits } from "@/lib/digits";
import type { HREvent } from "./EffectsWorkspace";

const reportTypes = ["leave", "late_permission", "permission", "mission", "deduction"] as const;
type ReportType = typeof reportTypes[number];
const typeLabels: Record<ReportType, string> = { leave: "إجازة", late_permission: "إذن تأخير", permission: "إذن خروج / استئذان", mission: "مأمورية", deduction: "خصم من الراتب" };
const statusLabels = { pending: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض" } as const;
const employeeName = (event: HREvent) => event.employee?.full_name || [event.employee?.first_name, event.employee?.last_name].filter(Boolean).join(" ") || "موظف غير معروف";

type ReportRow = HREvent & { event_type: ReportType };

export default function EffectsReportExport({ events }: { events: HREvent[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState<"all" | ReportType>("all");
  const [status, setStatus] = useState<"all" | HREvent["status"]>("all");
  const [branch, setBranch] = useState("all");
  const [employee, setEmployee] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const source = useMemo(() => events.filter((event): event is ReportRow => reportTypes.includes(event.event_type as ReportType)), [events]);
  const branches = useMemo(() => [...new Set(source.map((event) => event.employee?.branch?.name).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, "ar")), [source]);
  const filtered = useMemo(() => {
    const query = employee.trim().toLocaleLowerCase("ar");
    return source.filter((event) => {
      const person = employeeName(event).toLocaleLowerCase("ar");
      const number = event.employee?.employee_number ?? "";
      return (!from || event.effective_date >= from)
        && (!to || event.effective_date <= to)
        && (type === "all" || event.event_type === type)
        && (status === "all" || event.status === status)
        && (branch === "all" || event.employee?.branch?.name === branch)
        && (!query || person.includes(query) || number.toLocaleLowerCase("ar").includes(query));
    }).sort((a, b) => b.effective_date.localeCompare(a.effective_date) || b.created_at.localeCompare(a.created_at));
  }, [source, from, to, type, status, branch, employee]);

  const deductionsRecorded = filtered.filter((event) => event.payroll_recorded_at && event.amount != null).reduce((sum, event) => sum + Number(event.amount ?? 0), 0);
  const approvedDeductions = filtered.filter((event) => event.status === "approved" && event.event_type === "deduction").reduce((sum, event) => sum + Number(event.amount ?? 0), 0);

  async function exportExcel() {
    if (!filtered.length || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "نظام الموارد البشرية - قرارة";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet("الذونات والخصومات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
      sheet.mergeCells("A1:O1");
      sheet.getCell("A1").value = "تقرير الإذونات والخصومات";
      sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173B65" } };
      sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(1).height = 32;
      sheet.mergeCells("A2:O2");
      sheet.getCell("A2").value = `الفترة: ${from || "كل الفترات"} إلى ${to || "كل الفترات"} · الفرع: ${branch === "all" ? "كل الفروع المتاحة" : branch} · تاريخ التصدير: ${new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Tripoli" })}`;
      sheet.getCell("A2").font = { size: 10, color: { argb: "FF475569" } };
      sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      sheet.mergeCells("A3:O3");
      sheet.getCell("A3").value = "الخصم المرحّل: السجل الذي يحمل تاريخ تسجيل ضمن خصومات الراتب. المبالغ بالدينار الليبي.";
      sheet.getCell("A3").font = { size: 9, italic: true, color: { argb: "FF64748B" } };
      sheet.getCell("A3").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      sheet.addRow(["م", "الكود الوظيفي", "اسم الموظف", "الفرع", "نوع الإجراء", "الحالة", "من تاريخ", "إلى تاريخ", "المبلغ", "العملة", "السبب", "قرار الإدارة", "تاريخ القرار", "تاريخ الاعتماد", "تاريخ ترحيل الخصم"]);
      const header = sheet.getRow(4);
      header.height = 34;
      header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2873B8" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });

      filtered.forEach((event, index) => {
        const row = sheet.addRow([
          index + 1,
          toWesternDigits(event.employee?.employee_number ?? "—"),
          toWesternDigits(employeeName(event)),
          toWesternDigits(event.employee?.branch?.name ?? "—"),
          typeLabels[event.event_type],
          statusLabels[event.status],
          toWesternDigits(event.effective_date),
          toWesternDigits(event.end_date ?? "—"),
          event.amount == null ? null : Number(event.amount),
          event.amount_unit === "LYD" ? "د.ل" : event.amount_unit ?? "—",
          toWesternDigits(event.reason ?? "—"),
          toWesternDigits(event.decision_reason ?? "—"),
          toWesternDigits(event.decision_at?.slice(0, 10) ?? "—"),
          toWesternDigits(event.approved_at?.slice(0, 10) ?? "—"),
          toWesternDigits(event.payroll_recorded_at?.slice(0, 10) ?? "—"),
        ]);
        row.eachCell((cell) => {
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          cell.font = { size: 10, color: { argb: "FF334155" } };
          cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
        });
        row.getCell(9).numFmt = '#,##0.00;[Red]-#,##0.00;–';
        if (index % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F9FD" } }; });
        const statusCell = row.getCell(6);
        statusCell.font = { bold: true, size: 10, color: { argb: event.status === "approved" ? "FF187247" : event.status === "rejected" ? "FFB42318" : "FF9A6700" } };
      });
      const totalRow = sheet.addRow(["", "", "", "", "", "", "", "إجمالي المبالغ", { formula: `SUM(I5:I${Math.max(4, sheet.rowCount)})` }, "د.ل"]);
      totalRow.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FF173B65" }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2FA" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
      totalRow.getCell(9).numFmt = '#,##0.00;[Red]-#,##0.00;–';
      [7, 18, 27, 21, 22, 17, 15, 15, 16, 11, 34, 34, 18, 18, 21].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
      sheet.autoFilter = { from: "A4", to: `O${Math.max(4, sheet.rowCount - 1)}` };
      sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };

      const byEmployee = new Map<string, { name: string; number: string; branch: string; leaves: number; permissions: number; deductions: number; pending: number; approved: number; payroll: number }>();
      for (const event of filtered) {
        const id = event.employee_id;
        const entry = byEmployee.get(id) ?? { name: employeeName(event), number: event.employee?.employee_number ?? "—", branch: event.employee?.branch?.name ?? "—", leaves: 0, permissions: 0, deductions: 0, pending: 0, approved: 0, payroll: 0 };
        if (event.event_type === "leave") entry.leaves += 1;
        if (event.event_type === "late_permission" || event.event_type === "permission" || event.event_type === "mission") entry.permissions += 1;
        if (event.event_type === "deduction") {
          entry.deductions += 1;
          if (event.status === "pending") entry.pending += Number(event.amount ?? 0);
          if (event.status === "approved") entry.approved += Number(event.amount ?? 0);
        }
        if (event.payroll_recorded_at) entry.payroll += Number(event.amount ?? 0);
        byEmployee.set(id, entry);
      }
      const summary = workbook.addWorksheet("ملخص الموظفين", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
      summary.mergeCells("A1:J1");
      summary.getCell("A1").value = "ملخص الإذونات والخصومات حسب الموظف";
      summary.getCell("A1").font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
      summary.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173B65" } };
      summary.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      summary.getRow(1).height = 30;
      summary.mergeCells("A2:J2");
      summary.getCell("A2").value = `عدد السجلات: ${filtered.length} · خصومات معتمدة: ${approvedDeductions.toFixed(2)} د.ل · مرحّلة للراتب: ${deductionsRecorded.toFixed(2)} د.ل`;
      summary.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
      summary.addRow([]);
      summary.addRow(["الكود الوظيفي", "اسم الموظف", "الفرع", "الإجازات", "أذونات التأخير والخروج", "طلبات الخصم", "خصومات معلّقة", "خصومات معتمدة", "خصومات مرحّلة للراتب", "العملة"]);
      const summaryHeader = summary.getRow(4);
      summaryHeader.height = 36;
      summaryHeader.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2873B8" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
      [...byEmployee.values()].sort((a, b) => a.branch.localeCompare(b.branch, "ar") || a.name.localeCompare(b.name, "ar")).forEach((entry, index) => {
        const row = summary.addRow([toWesternDigits(entry.number), toWesternDigits(entry.name), toWesternDigits(entry.branch), entry.leaves, entry.permissions, entry.deductions, entry.pending, entry.approved, entry.payroll, "د.ل"]);
        row.eachCell((cell) => { cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.font = { size: 10, color: { argb: "FF334155" } }; cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } }; });
        [7, 8, 9].forEach((column) => { row.getCell(column).numFmt = '#,##0.00;[Red]-#,##0.00;–'; });
        if (index % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F9FD" } }; });
      });
      [18, 28, 22, 13, 22, 15, 17, 17, 22, 11].forEach((width, index) => { summary.getColumn(index + 1).width = width; });
      summary.autoFilter = { from: "A4", to: `J${summary.rowCount}` };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `تقرير-الإذونات-والخصومات-${from || "من-البداية"}-${to || "حتى-اليوم"}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`تم تجهيز التقرير وفيه ${toWesternDigits(filtered.length)} سجلًا في ورقتين.`);
    } catch (error) {
      setMessage(error instanceof Error ? `تعذر إعداد التقرير: ${error.message}` : "تعذر إعداد التقرير.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel effects-report-panel">
    <div className="effects-panel-heading"><div><span className="effects-report-eyebrow">تصدير ومتابعة</span><h2>تقرير الإذونات والخصومات</h2><p>يشمل الإجازات وأذونات التأخير والخروج والخصومات ضمن السجلات التي تسمح صلاحيتك بعرضها.</p></div><span className="effects-report-count">{toWesternDigits(filtered.length)} سجل</span></div>
    <div className="effects-report-filters">
      <label>من تاريخ<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>إلى تاريخ<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
      <label>نوع السجل<select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="all">كل الإذونات والخصومات</option>{reportTypes.map((item) => <option key={item} value={item}>{typeLabels[item]}</option>)}</select></label>
      <label>الحالة<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">كل الحالات</option><option value="pending">قيد المراجعة</option><option value="approved">معتمد</option><option value="rejected">مرفوض</option></select></label>
      <label>الفرع<select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">كل الفروع</option>{branches.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="effects-report-employee-filter">بحث الموظف<input type="search" value={employee} onChange={(event) => setEmployee(event.target.value)} placeholder="الاسم أو الرقم الوظيفي" /></label>
    </div>
    <div className="effects-report-stats"><article><span>إجمالي السجلات</span><strong>{toWesternDigits(filtered.length)}</strong></article><article><span>خصومات معتمدة</span><strong>{toWesternDigits(approvedDeductions.toFixed(2))} <small>د.ل</small></strong></article><article><span>مرحل للراتب</span><strong>{toWesternDigits(deductionsRecorded.toFixed(2))} <small>د.ل</small></strong></article></div>
    {filtered.length > 0 && <div className="effects-report-preview"><div><strong>معاينة السجلات</strong><span>الأحدث حسب تاريخ الإجراء · يعرض حتى ٥ سجلات</span></div>{filtered.slice(0, 5).map((event) => <article key={event.id}><div><strong>{toWesternDigits(employeeName(event))}</strong><span>{typeLabels[event.event_type]} · {toWesternDigits(event.effective_date)} · {toWesternDigits(event.employee?.branch?.name ?? "—")}</span></div><b className={`effects-report-status ${event.status}`}>{statusLabels[event.status]}</b>{event.amount !== null && <strong className="effects-report-amount">{toWesternDigits(Number(event.amount).toFixed(2))} د.ل</strong>}</article>)}</div>}
    <div className="effects-report-actions"><button className="effects-report-export" type="button" onClick={exportExcel} disabled={!filtered.length || busy}><span aria-hidden="true">⇩</span>{busy ? "جارٍ إعداد Excel…" : "تصدير Excel"}</button>{message && <p role="status" className="effects-report-message">{message}</p>}</div>
    {!filtered.length && <p className="effects-report-empty">لا توجد سجلات تطابق الفلاتر الحالية.</p>}
  </section>;
}
