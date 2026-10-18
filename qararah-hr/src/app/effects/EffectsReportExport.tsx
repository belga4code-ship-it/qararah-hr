"use client";

import { useMemo, useRef, useState } from "react";
import { toWesternDigits } from "@/lib/digits";
import type { HREvent, ApprovalStep } from "./EffectsWorkspace";
import EffectReportEditor from "./EffectReportEditor";
import EffectRequestPrintButton from "./EffectRequestPrintButton";
import { leaveCalendarDays } from "./request-print-details";
import "./EffectsReport.css";

const reportTypes = ["leave", "late_permission", "permission", "mission", "deduction"] as const;
type ReportType = typeof reportTypes[number];
const typeLabels: Record<ReportType, string> = { leave: "إجازة", late_permission: "إذن تأخير", permission: "إذن خروج / استئذان", mission: "مأمورية", deduction: "خصم من الراتب" };
const statusLabels = { pending: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض" } as const;
const employeeName = (event: HREvent) => event.employee?.full_name || [event.employee?.first_name, event.employee?.last_name].filter(Boolean).join(" ") || "موظف غير معروف";

type ReportRow = HREvent & { event_type: ReportType };

const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: string | null | undefined) => value ? toWesternDigits(value.slice(0,10).split("-").reverse().join("/")) : "—";
const timestamp = (value: string | null | undefined) => value ? toWesternDigits(new Intl.DateTimeFormat("ar-LY", { timeZone: "Africa/Tripoli", dateStyle: "short", timeStyle: "short" }).format(new Date(value))) : "—";
const normalized = (value: string) => toWesternDigits(value).normalize("NFKD").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").toLocaleLowerCase("ar");

export default function EffectsReportExport({ events, canExport, canEdit, approvalSteps, approvalNames }: { events: HREvent[]; canExport: boolean; canEdit: boolean; approvalSteps: ApprovalStep[]; approvalNames: Record<string,string> }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState<string | null>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);
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
    const query = normalized(employee.trim());
    return source.filter((event) => {
      const person = normalized(employeeName(event));
      const number = event.employee?.employee_number ?? "";
      return (!from || event.effective_date >= from)
        && (!to || event.effective_date <= to)
        && (type === "all" || event.event_type === type)
        && (status === "all" || event.status === status)
        && (branch === "all" || event.employee?.branch?.name === branch)
        && (!query || person.includes(query) || normalized(number).includes(query));
    }).sort((a, b) => sort === "oldest" ? a.effective_date.localeCompare(b.effective_date) || a.created_at.localeCompare(b.created_at) : sort === "amount" ? Number(b.amount ?? 0) - Number(a.amount ?? 0) || b.effective_date.localeCompare(a.effective_date) : b.effective_date.localeCompare(a.effective_date) || b.created_at.localeCompare(a.created_at));
  }, [source, from, to, type, status, branch, employee, sort]);

  const deductionsRecorded = filtered.filter((event) => event.status === "approved" && event.payroll_recorded_at && event.amount != null).reduce((sum, event) => sum + Number(event.amount ?? 0), 0);
  const approvedDeductions = filtered.filter((event) => event.status === "approved" && event.event_type === "deduction").reduce((sum, event) => sum + Number(event.amount ?? 0), 0);

  const leaveDeductions = filtered.filter((event) => event.status === "approved" && event.event_type === "leave").reduce((sum,event)=>sum+Number(event.amount ?? 0),0);
  const totalApproved = approvedDeductions + leaveDeductions;
  const pending = filtered.filter(event=>event.status === "pending").length;
  const totalPages = Math.max(1,Math.ceil(filtered.length/pageSize));
  const currentPage = Math.min(page,totalPages);
  const visibleRows = filtered.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const selectedEvent = source.find(event=>event.id === selected);
  const filtersActive = Boolean(from || to || type !== "all" || status !== "all" || branch !== "all" || employee);
  function resetFilters(){setFrom("");setTo("");setType("all");setStatus("all");setBranch("all");setEmployee("");setSort("newest");setPage(1);}
  function openDetails(id: string){setSelected(id);detailDialog.current?.showModal();}

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

        }
        if (event.status === "approved" && (event.event_type === "deduction" || event.event_type === "leave")) entry.approved += Number(event.amount ?? 0);
        if (event.status === "approved" && event.payroll_recorded_at) entry.payroll += Number(event.amount ?? 0);
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
      summary.getCell("A2").value = `عدد السجلات: ${filtered.length} · خصومات معتمدة: ${totalApproved.toFixed(2)} د.ل · مرحّلة للراتب: ${deductionsRecorded.toFixed(2)} د.ل`;
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

  return <section className="panel effects-report-panel effects-report-v2" dir="rtl">
    <header className="report-hero"><div><span className="report-eyebrow">الموارد البشرية / التقارير</span><h2>سجل الإذونات والخصومات</h2><p>تفاصيل واضحة لكل إجراء، ومتابعة موافقات الموظفين وأثرها المالي.</p></div><div className="report-hero-actions">{canExport && <button className="report-export-button" type="button" onClick={exportExcel} disabled={!filtered.length || busy}><span aria-hidden="true">⇩</span>{busy ? "جارٍ تجهيز الملف…" : "تصدير Excel"}</button>}<span className="report-access-note">{canEdit ? "التعديل متاح لك كمدير للنظام" : "عرض السجلات حسب صلاحيتك"}</span></div></header>
    <div className="report-body">
      <div className="report-metrics">
        <article><span>السجلات المعروضة</span><strong>{filtered.length}<small>سجل</small></strong><p>{new Set(filtered.map(event=>event.employee_id)).size} موظف ضمن النتائج</p></article>
        <article className="financial"><span>إجمالي الخصومات المعتمدة</span><strong dir="ltr">{money(totalApproved)} <small>د.ل</small></strong><p>مباشرة {money(approvedDeductions)} + إجازات {money(leaveDeductions)}</p></article>
        <article><span>مسجّل ضمن خصومات الراتب</span><strong dir="ltr">{money(deductionsRecorded)} <small>د.ل</small></strong><p>السجلات المعتمدة التي لها تاريخ ترحيل</p></article>
        <article className="waiting"><span>بانتظار المراجعة</span><strong>{pending}<small>طلب</small></strong><p>من إجمالي النتائج المصفّاة</p></article>
      </div>
      <div className="report-filter-heading"><div><h3>تصفية السجلات</h3><p>اختر الفترة أو الموظف للوصول إلى السجل المطلوب.</p></div>{filtersActive && <button type="button" className="report-reset" onClick={resetFilters}>مسح الفلاتر ×</button>}</div>
      <div className="report-filter-grid">
        <label className="report-search"><span>بحث عن موظف</span><input type="search" value={employee} onChange={e=>{setEmployee(e.target.value);setPage(1);}} placeholder="اسم الموظف أو الكود الوظيفي…"/></label>
        <label><span>من تاريخ</span><input type="date" value={from} max={to || undefined} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></label>
        <label><span>إلى تاريخ</span><input type="date" value={to} min={from || undefined} onChange={e=>{setTo(e.target.value);setPage(1);}}/></label>
        <label><span>الفرع</span><select value={branch} onChange={e=>{setBranch(e.target.value);setPage(1);}}><option value="all">كل الفروع</option>{branches.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
        <label><span>الحالة</span><select value={status} onChange={e=>{setStatus(e.target.value as typeof status);setPage(1);}}><option value="all">كل الحالات</option><option value="pending">قيد المراجعة</option><option value="approved">معتمد</option><option value="rejected">مرفوض</option></select></label>
      </div>
      <div className="report-category-tabs" aria-label="نوع السجل"><button type="button" aria-pressed={type === "all"} onClick={()=>{setType("all");setPage(1);}}>كل السجلات</button>{reportTypes.map(key=><button type="button" key={key} aria-pressed={type === key} onClick={()=>{setType(key);setPage(1);}}>{typeLabels[key]}</button>)}</div>
      <div className="report-table-heading"><div><h3>السجلات <span>{filtered.length}</span></h3><p>كل صف يمثل طلبًا أو إجراءً مستقلًا.</p></div><label>الترتيب<select value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}><option value="newest">الأحدث أولًا</option><option value="oldest">الأقدم أولًا</option><option value="amount">الأعلى مبلغًا</option></select></label></div>
      {message && <p className="report-export-message" role="status">{message}</p>}
      <div className="report-table-scroll"><table className="report-ledger"><thead><tr><th>الموظف</th><th>نوع السجل</th><th>الفترة / التاريخ</th><th>الفرع</th><th>الحالة</th><th>قيمة الخصم</th><th>الراتب</th><th>الإجراءات</th></tr></thead><tbody>{visibleRows.map(event=>{
        const days = event.event_type === "leave" ? leaveCalendarDays(event.effective_date,event.end_date) : null;
        return <tr key={event.id}><td><div className="report-person"><span className="report-person-avatar" aria-hidden="true">{employeeName(event).trim().charAt(0)}</span><div><strong>{employeeName(event)}</strong><small dir="ltr">{event.employee?.employee_number ?? "—"}</small></div></div></td>
        <td><span className={`report-type type-${event.event_type}`}>{typeLabels[event.event_type]}</span>{(event.report_revision ?? 0)>0 && <small className="report-corrected">تم تعديله · {event.report_revision}</small>}</td>
        <td className="report-date"><span dir="ltr">{date(event.effective_date)}</span>{event.end_date && <small>حتى <b dir="ltr">{date(event.end_date)}</b>{days !== null ? ` · ${days} أيام` : ""}</small>}</td><td>{event.employee?.branch?.name ?? "—"}</td>
        <td><span className={`report-status ${event.status}`}><i/>{statusLabels[event.status]}</span></td>
        <td><span className={`report-money ${Number(event.amount)>0 ? "has-amount" : ""}`} dir="ltr">{event.amount !== null ? <>{money(Number(event.amount))} <small>د.ل</small></> : "—"}</span>{Number(event.amount)>0 && event.status !== "approved" && <small className="report-money-note">{event.status === "pending" ? "غير معتمد" : "طلب مرفوض"}</small>}</td>
        <td>{event.status === "approved" && event.payroll_recorded_at ? <span className="report-payroll recorded">مسجّل</span> : <span className="report-payroll">—</span>}</td>
        <td><div className="report-row-actions"><button type="button" className="report-action" onClick={()=>openDetails(event.id)}>التفاصيل</button>{canEdit && <EffectReportEditor key={event.id} event={event}/>}</div></td></tr>;
      })}</tbody></table>{!filtered.length && <div className="report-empty"><span aria-hidden="true">⌕</span><h3>لا توجد سجلات مطابقة</h3><p>جرّب اسمًا آخر أو وسّع الفترة المحددة.</p><button type="button" className="secondary-button" onClick={resetFilters}>عرض كل السجلات</button></div>}</div>
      <footer className="report-table-footer"><div><span>{filtered.length ? `${(currentPage-1)*pageSize+1}–${Math.min(currentPage*pageSize,filtered.length)} من ${filtered.length} سجل` : "0 سجل"}</span><label>في الصفحة<select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label></div><nav aria-label="صفحات التقرير"><button type="button" disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>السابق</button><span>{currentPage} / {totalPages}</span><button type="button" disabled={currentPage>=totalPages} onClick={()=>setPage(currentPage+1)}>التالي</button></nav></footer>
      <p className="report-bottom-note">الإجماليات والتصدير تشمل جميع النتائج المطابقة للفلاتر، بما فيها السجلات في الصفحات الأخرى.</p>
    </div>
    <dialog ref={detailDialog} className="report-record-dialog" aria-label="تفاصيل سجل التقرير"><div className="report-record-detail" dir="rtl"><header><div><span>تفاصيل السجل</span><h2>{selectedEvent ? employeeName(selectedEvent) : "السجل"}</h2><p>{selectedEvent?.employee?.employee_number}</p></div><button type="button" className="report-dialog-close" aria-label="إغلاق تفاصيل السجل" onClick={()=>detailDialog.current?.close()}>×</button></header>
    {selectedEvent && <><dl className="report-detail-grid"><div><dt>نوع الإجراء</dt><dd>{typeLabels[selectedEvent.event_type]}</dd></div><div><dt>الحالة</dt><dd><span className={`report-status ${selectedEvent.status}`}>{statusLabels[selectedEvent.status]}</span></dd></div><div><dt>التاريخ</dt><dd>{date(selectedEvent.effective_date)}{selectedEvent.end_date && ` إلى ${date(selectedEvent.end_date)}`}</dd></div><div><dt>الفرع</dt><dd>{selectedEvent.employee?.branch?.name ?? "—"}</dd></div><div><dt>قيمة الخصم</dt><dd>{selectedEvent.amount == null ? "بدون خصم مسجل" : `${money(Number(selectedEvent.amount))} د.ل`}</dd></div><div><dt>الترحيل للراتب</dt><dd>{date(selectedEvent.payroll_recorded_at)}</dd></div><div className="wide"><dt>سبب الطلب / الإجراء</dt><dd>{selectedEvent.reason || "—"}</dd></div><div className="wide"><dt>القرار المسجل</dt><dd>{selectedEvent.decision_reason || "لم يسجل قرار بعد"}</dd></div><div><dt>مقدم الطلب</dt><dd>{selectedEvent.requester?.full_name || "غير مسجل"}</dd></div><div><dt>تاريخ القرار</dt><dd>{date(selectedEvent.decision_at)}</dd></div></dl>
    {(selectedEvent.report_revision ?? 0)>0 && <div className="report-edit-history"><strong>آخر تعديل · الإصدار {selectedEvent.report_revision}</strong><p>{approvalNames[selectedEvent.report_edited_by ?? ""] || "مدير النظام"} · {timestamp(selectedEvent.report_edited_at)}</p><p>{selectedEvent.report_edit_reason}</p><small>القيم قبل التعديل وبعده متاحة في سجل التدقيق.</small></div>}
    <footer>{["leave","permission","late_permission"].includes(selectedEvent.event_type) && <EffectRequestPrintButton kind={selectedEvent.event_type as "leave"|"permission"|"late_permission"} employeeName={employeeName(selectedEvent)} employeeNumber={selectedEvent.employee?.employee_number ?? "—"} submittedBy={selectedEvent.requester?.full_name || "غير مسجل"} submitterRole={selectedEvent.requester?.employee_id === selectedEvent.employee_id ? "الموظف نفسه" : "مقدم الطلب"} startDate={selectedEvent.effective_date} endDate={selectedEvent.end_date} requestedTime={typeof selectedEvent.details?.requested_time === "string" ? selectedEvent.details.requested_time : null} reason={selectedEvent.reason || ""} requestId={selectedEvent.id} requestStatus={selectedEvent.status} responsibleIds={Array.isArray(selectedEvent.details?.responsible_profile_ids) ? selectedEvent.details.responsible_profile_ids.filter((id):id is string=>typeof id === "string") : []} approvalSteps={approvalSteps.filter(step=>step.event_id === selectedEvent.id)} approvalNames={approvalNames} decisionBy={selectedEvent.decision_by || selectedEvent.approved_by || null} decisionAt={selectedEvent.decision_at || selectedEvent.approved_at || null} decisionReason={selectedEvent.decision_reason} adminOverride={Boolean(selectedEvent.details?.admin_override)} deductionAmount={selectedEvent.amount} deductionUnit={selectedEvent.amount_unit}/>}<button type="button" className="secondary-button" onClick={()=>detailDialog.current?.close()}>إغلاق</button></footer></>}
    </div></dialog>
  </section>;
}
