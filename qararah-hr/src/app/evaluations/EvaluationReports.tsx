"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { toWesternDigits } from "@/lib/digits";
import { employeeName, monthLabel, type EvaluatedEmployee, type EvaluationAssignment, type EvaluationRecord } from "./evaluation-model";

type View = "summary" | "branches" | "departments" | "employees";
type Status = "all" | "complete" | "partial" | "waiting" | "unassigned";
type Props = {
  month: string;
  onMonthChange: (month: string) => void;
  employees: EvaluatedEmployee[];
  assignments: EvaluationAssignment[];
  evaluations: EvaluationRecord[];
  evaluatorNames: Record<string, string>;
};
type ReportRow = {
  employee: EvaluatedEmployee;
  assignments: EvaluationAssignment[];
  evaluations: EvaluationRecord[];
  average: number | null;
  received: number;
  status: Exclude<Status, "all">;
};
type GroupRow = { name: string; employees: number; assessed: number; complete: number; partial: number; waiting: number; average: number | null; completion: number };

const views: { id: View; label: string; icon: string }[] = [
  { id: "summary", label: "ملخص النتائج", icon: "▦" },
  { id: "branches", label: "مقارنة الفروع", icon: "⌂" },
  { id: "departments", label: "مقارنة الإدارات", icon: "▤" },
  { id: "employees", label: "تفاصيل الموظفين", icon: "☷" },
];
const statuses: Record<Status, string> = { all: "كل الحالات", complete: "مكتمل", partial: "تقييم جزئي", waiting: "بانتظار التقييم", unassigned: "بدون مقيّم" };
const normalize = (value: string) => toWesternDigits(value).normalize("NFKD").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLocaleLowerCase("ar");
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const percent = (evaluation: EvaluationRecord) => evaluation.total_score !== null && evaluation.max_score > 0 ? evaluation.total_score / evaluation.max_score * 100 : null;
const criterionPercent = (score: number, max: number) => max > 0 ? score / max * 100 : null;

export default function EvaluationReports({ month, onMonthChange, employees, assignments, evaluations, evaluatorNames }: Props) {
  const [view, setView] = useState<View>("summary");
  const [branch, setBranch] = useState("all");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState<Status>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [printEmployeeId, setPrintEmployeeId] = useState<string | null>(null);

  const rows = useMemo<ReportRow[]>(() => employees.map((employee) => {
    const employeeAssignments = assignments.filter((assignment) => assignment.employee_id === employee.id).sort((a, b) => a.slot - b.slot);
    const submitted = evaluations.filter((evaluation) => evaluation.employee_id === employee.id && evaluation.period_month.slice(0, 7) === month && evaluation.status === "submitted");
    const results = submitted.map(percent).filter((value): value is number => value !== null);
    const average = results.length ? results.reduce((sum, value) => sum + value, 0) / results.length : null;
    const received = employeeAssignments.filter((assignment) => assignment.evaluator_profile_id && submitted.some((evaluation) => evaluation.evaluator_id === assignment.evaluator_profile_id)).length;
    const rowStatus: Exclude<Status, "all"> = !employeeAssignments.length ? "unassigned" : received >= employeeAssignments.length ? "complete" : submitted.length ? "partial" : "waiting";
    return { employee, assignments: employeeAssignments, evaluations: submitted, average, received, status: rowStatus };
  }), [employees, assignments, evaluations, month]);

  const departments = useMemo(() => [...new Set(rows.filter((row) => branch === "all" || row.employee.branch_id === branch).map((row) => row.employee.department_name || "القسم غير محدد"))].sort((a, b) => a.localeCompare(b, "ar")), [rows, branch]);
  const filtered = useMemo(() => {
    const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
    return rows.filter(({ employee, status: rowStatus }) => {
      const matchesSearch = terms.every((term) => normalize([employeeName(employee), employee.employee_number, employee.branch_name, employee.department_name, employee.job_title_name].join(" ")).includes(term));
      return matchesSearch
        && (branch === "all" || employee.branch_id === branch)
        && (department === "all" || employee.department_name === department)
        && (status === "all" || rowStatus === status);
    });
  }, [rows, query, branch, department, status]);

  const summary = useMemo(() => {
    const scored = filtered.filter((row) => row.average !== null);
    return {
      employees: filtered.length,
      submitted: filtered.reduce((total, row) => total + row.evaluations.length, 0),
      complete: filtered.filter((row) => row.status === "complete").length,
      waiting: filtered.filter((row) => row.status === "waiting" || row.status === "partial").length,
      unassigned: filtered.filter((row) => row.status === "unassigned").length,
      average: scored.length ? scored.reduce((total, row) => total + row.average!, 0) / scored.length : null,
    };
  }, [filtered]);

  const groupRows = useMemo(() => {
    const group = (nameFor: (row: ReportRow) => string): GroupRow[] => {
      const grouped = new Map<string, ReportRow[]>();
      for (const row of filtered) {
        const name = nameFor(row) || "غير محدد";
        grouped.set(name, [...(grouped.get(name) ?? []), row]);
      }
      return [...grouped.entries()].map(([name, group]) => {
        const scored = group.filter((row) => row.average !== null);
        const assigned = group.filter((row) => row.assignments.length > 0);
        return {
          name,
          employees: group.length,
          assessed: scored.length,
          complete: group.filter((row) => row.status === "complete").length,
          partial: group.filter((row) => row.status === "partial").length,
          waiting: group.filter((row) => row.status === "waiting").length,
          average: scored.length ? scored.reduce((total, row) => total + row.average!, 0) / scored.length : null,
          completion: assigned.length ? assigned.filter((row) => row.status === "complete").length / assigned.length * 100 : 0,
        };
      }).sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.name.localeCompare(b.name, "ar"));
    };
    return { branches: group((row) => row.employee.branch_name), departments: group((row) => row.employee.department_name) };
  }, [filtered]);

  const criteria = useMemo(() => {
    const aggregate = new Map<string, { total: number; count: number }>();
    for (const row of filtered) for (const evaluation of row.evaluations) for (const item of evaluation.evaluation_items ?? []) {
      const value = criterionPercent(item.score, item.max_score);
      if (value === null) continue;
      const current = aggregate.get(item.criterion) ?? { total: 0, count: 0 };
      current.total += value;
      current.count += 1;
      aggregate.set(item.criterion, current);
    }
    return [...aggregate.entries()].map(([name, value]) => ({ name, average: value.total / value.count, count: value.count })).sort((a, b) => a.average - b.average);
  }, [filtered]);

  function changeBranch(value: string) {
    setBranch(value);
    if (department !== "all" && !rows.some((row) => (value === "all" || row.employee.branch_id === value) && row.employee.department_name === department)) setDepartment("all");
  }

  function exportPdf(employeeId?: string) {
    if (employeeId) setPrintEmployeeId(employeeId);
    setMessage("اختر «حفظ كملف PDF» من نافذة الطباعة.");
    if (employeeId) {
      const cleanup = () => setPrintEmployeeId(null);
      window.addEventListener("afterprint", cleanup, { once: true });
    }
    window.setTimeout(() => window.print(), 150);
  }

  async function exportEmployeeExcel(row: ReportRow) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "نظام الموارد البشرية - قرارة";
      const summarySheet = workbook.addWorksheet("ملخص الموظف", { views: [{ rightToLeft: true }] });
      summarySheet.columns = [{ width: 30 }, { width: 42 }];
      summarySheet.mergeCells("A1:B1");
      summarySheet.getCell("A1").value = "تقرير تقييم أداء الموظف";
      summarySheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      summarySheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173B65" } };
      summarySheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      summarySheet.getRow(1).height = 32;
      [
        ["فترة التقييم", monthLabel(month)], ["اسم الموظف", employeeName(row.employee)], ["الكود الوظيفي", row.employee.employee_number],
        ["الصفة", row.employee.job_title_name || "—"], ["الفرع", row.employee.branch_name || "—"], ["الإدارة", row.employee.department_name || "—"],
        ["متوسط النتيجة", row.average === null ? "لم يُقدّم تقييم" : `${number(row.average)}%`], ["التقييمات المقدمة", row.evaluations.length],
        ["المقيّمون المسندون", row.assignments.length], ["حالة التقييم", statuses[row.status]],
      ].forEach((values) => summarySheet.addRow(values));
      summarySheet.eachRow((excelRow, index) => {
        if (index === 1) return;
        excelRow.getCell(1).font = { bold: true, color: { argb: "FF315775" } };
        excelRow.eachCell((cell) => { cell.alignment = { vertical: "middle", wrapText: true }; cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } }; });
      });
      const detailSheet = workbook.addWorksheet("تفاصيل البنود", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
      detailSheet.addRow(["المقيّم", "النتيجة العامة %", "بند التقييم", "الدرجة %", "الدليل أو الملاحظة"]);
      detailSheet.getRow(1).eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2873B8" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
      for (const evaluation of row.evaluations) {
        const assigned = row.assignments.find((assignment) => assignment.evaluator_profile_id === evaluation.evaluator_id);
        const evaluator = evaluatorNames[evaluation.evaluator_id ?? ""] || assigned?.evaluator_employee?.full_name || (assigned ? `المقيّم المسند ${assigned.slot}` : "مقيّم إضافي");
        for (const item of evaluation.evaluation_items ?? []) detailSheet.addRow([evaluator, percent(evaluation) === null ? null : Math.round(percent(evaluation)! * 10) / 10, item.criterion, criterionPercent(item.score, item.max_score) === null ? null : Math.round(criterionPercent(item.score, item.max_score)! * 10) / 10, item.evidence || evaluation.notes || "—"]);
      }
      [27, 16, 52, 14, 52].forEach((width, index) => { detailSheet.getColumn(index + 1).width = width; });
      detailSheet.autoFilter = { from: "A1", to: `E${Math.max(detailSheet.rowCount, 1)}` };
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `تقييم-${row.employee.employee_number}-${month}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`تم تصدير تقييم ${employeeName(row.employee)} إلى Excel.`);
    } catch (error) {
      setMessage(error instanceof Error ? `تعذر تصدير تقييم الموظف: ${error.message}` : "تعذر تصدير تقييم الموظف.");
    } finally {
      setBusy(false);
    }
  }

  async function exportExcel() {
    if (!filtered.length || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "نظام الموارد البشرية - قرارة";
      workbook.created = new Date();
      const titleStyle = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
      const headerStyle = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      const addTableSheet = (name: string, title: string, headers: string[], data: (string | number | null)[][], widths: number[]) => {
        const sheet = workbook.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
        const lastColumn = String.fromCharCode(64 + headers.length);
        sheet.mergeCells(`A1:${lastColumn}1`);
        const titleCell = sheet.getCell("A1");
        titleCell.value = title;
        titleCell.font = titleStyle;
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173B65" } };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };
        sheet.getRow(1).height = 30;
        sheet.mergeCells(`A2:${lastColumn}2`);
        sheet.getCell("A2").value = `الفترة: ${monthLabel(month)} · الموظفون: ${filtered.length} · متوسط النتيجة: ${summary.average === null ? "—" : `${number(summary.average)}%`}`;
        sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
        sheet.mergeCells(`A3:${lastColumn}3`);
        sheet.getCell("A3").value = `الفرع: ${branch === "all" ? "كل الفروع" : rows.find((row) => row.employee.branch_id === branch)?.employee.branch_name || branch} · الإدارة: ${department === "all" ? "كل الإدارات" : department} · الحالة: ${statuses[status]}`;
        sheet.getCell("A3").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        sheet.addRow(headers);
        sheet.getRow(4).height = 34;
        sheet.getRow(4).eachCell((cell) => { cell.font = headerStyle; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2873B8" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
        for (const [index, values] of data.entries()) {
          const row = sheet.addRow([index + 1, ...values]);
          row.eachCell((cell) => { cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.font = { size: 10, color: { argb: "FF334155" } }; cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } }; });
          if (index % 2) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F9FD" } }; });
        }
        widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
        sheet.autoFilter = { from: "A4", to: `${lastColumn}${Math.max(sheet.rowCount, 4)}` };
        sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
        return sheet;
      };

      addTableSheet("الموظفون", "تقرير تقييم أداء الموظفين", ["م", "الكود الوظيفي", "الموظف", "الصفة", "الفرع", "الإدارة", "متوسط النتيجة %", "التقييمات المقدمة", "المقيّمون المسندون", "حالة التقييم", "ملاحظات المقيّمين"], filtered.map((row) => [row.employee.employee_number, employeeName(row.employee), row.employee.job_title_name || "—", row.employee.branch_name || "—", row.employee.department_name || "—", row.average === null ? null : Math.round(row.average * 10) / 10, row.evaluations.length, row.assignments.length, statuses[row.status], row.evaluations.map((evaluation) => evaluation.notes).filter(Boolean).join(" | ") || "—"]), [7, 16, 28, 18, 20, 22, 16, 16, 16, 20, 45]);
      addTableSheet("الفروع", "مقارنة أداء الفروع", ["م", "الفرع", "الموظفون", "لديهم نتائج", "مكتمل", "جزئي", "بانتظار", "متوسط النتيجة %", "اكتمال التقييم %"], groupRows.branches.map((group) => [group.name, group.employees, group.assessed, group.complete, group.partial, group.waiting, group.average === null ? null : Math.round(group.average * 10) / 10, Math.round(group.completion * 10) / 10]), [7, 28, 14, 14, 12, 12, 14, 18, 18]);
      addTableSheet("الإدارات", "مقارنة أداء الإدارات", ["م", "الإدارة", "الموظفون", "لديهم نتائج", "مكتمل", "جزئي", "بانتظار", "متوسط النتيجة %", "اكتمال التقييم %"], groupRows.departments.map((group) => [group.name, group.employees, group.assessed, group.complete, group.partial, group.waiting, group.average === null ? null : Math.round(group.average * 10) / 10, Math.round(group.completion * 10) / 10]), [7, 28, 14, 14, 12, 12, 14, 18, 18]);
      addTableSheet("بنود التقييم", "تحليل بنود التقييم", ["م", "بند التقييم", "متوسط الدرجة %", "عدد الإجابات"], criteria.map((criterion) => [criterion.name, Math.round(criterion.average * 10) / 10, criterion.count]), [7, 56, 22, 18]);

      const details = workbook.addWorksheet("تفاصيل التقييمات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
      details.addRow(["الموظف", "الكود الوظيفي", "الفرع", "الإدارة", "المقيّم", "النتيجة %", "بند التقييم", "الدرجة %", "الدليل أو الملاحظة"]);
      details.getRow(1).eachCell((cell) => { cell.font = headerStyle; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2873B8" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
      for (const row of filtered) for (const evaluation of row.evaluations) {
        const assignedEvaluator = row.assignments.find((assignment) => assignment.evaluator_profile_id === evaluation.evaluator_id);
        const evaluator = assignedEvaluator?.evaluator_employee?.full_name || `المقيّم المسند ${assignedEvaluator?.slot ?? ""}`;
        for (const item of evaluation.evaluation_items ?? []) details.addRow([employeeName(row.employee), row.employee.employee_number, row.employee.branch_name || "—", row.employee.department_name || "—", evaluator, percent(evaluation) === null ? null : Math.round(percent(evaluation)! * 10) / 10, item.criterion, Math.round(criterionPercent(item.score, item.max_score) ?? 0), item.evidence || evaluation.notes || "—"]);
      }
      [28, 16, 20, 22, 26, 14, 52, 14, 50].forEach((width, index) => { details.getColumn(index + 1).width = width; });
      details.autoFilter = { from: "A1", to: `I${Math.max(details.rowCount, 1)}` };
      details.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `تقرير-تقييم-الأداء-${month}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("تم تصدير التقرير بكل مقارناته وتفاصيل بنوده وفق الفلاتر المحددة.");
    } catch (error) {
      setMessage(error instanceof Error ? `تعذر تجهيز ملف Excel: ${error.message}` : "تعذر تجهيز ملف Excel.");
    } finally {
      setBusy(false);
    }
  }

  return <section id="evaluation-report-print" className="evaluation-report" data-print-employee={printEmployeeId ?? undefined}>
    <header className="evaluation-report-hero"><div><span>الموارد البشرية / متابعة الأداء</span><h2>تقرير تقييم الأداء</h2><p>قارن نتائج الفروع والإدارات، وتابع اكتمال التقييمات وبنود الأداء للفترة المختارة.</p></div><div className="evaluation-report-actions"><button type="button" className="evaluation-export-excel" onClick={() => void exportExcel()} disabled={!filtered.length || busy}>{busy ? "جارٍ إعداد الملف…" : "⇩ تصدير Excel"}</button><button type="button" className="evaluation-export-pdf" onClick={() => exportPdf()} disabled={!filtered.length}>▧ تصدير PDF</button></div></header>
    {message && <p className="evaluation-report-message" role="status">{message}</p>}
    <div className="evaluation-report-filters">
      <label><span>شهر التقرير</span><input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)}/></label>
      <label><span>الفرع</span><select value={branch} onChange={(event) => changeBranch(event.target.value)}><option value="all">كل الفروع</option>{[...new Map(rows.map((row) => [row.employee.branch_id, row.employee.branch_name || "الفرع غير محدد"])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label><span>الإدارة / القسم</span><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="all">كل الإدارات</option>{departments.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><span>حالة التقييم</span><select value={status} onChange={(event) => setStatus(event.target.value as Status)}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="evaluation-report-search"><span>بحث بالموظف أو الرقم الوظيفي</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="اكتب اسمًا أو رقمًا وظيفيًا…"/></label>
      <button type="button" className="evaluation-report-reset" onClick={() => { setBranch("all"); setDepartment("all"); setStatus("all"); setQuery(""); }}>مسح الفلاتر</button>
    </div>
    <nav className="evaluation-report-views" aria-label="طريقة عرض التقرير">{views.map((item) => <button type="button" key={item.id} className={view === item.id ? "active" : ""} aria-pressed={view === item.id} onClick={() => setView(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}</nav>
    <div className="evaluation-report-content">
      <div className="evaluation-report-summary">
        <article><span>متوسط الأداء</span><strong>{summary.average === null ? "—" : `${number(summary.average)}%`}</strong><small>متوسط الموظفين الذين لديهم نتيجة</small></article>
        <article><span>التقييمات المقدمة</span><strong>{summary.submitted}</strong><small>{summary.employees} موظف ضمن الفلاتر</small></article>
        <article className="complete"><span>اكتمل التقييم</span><strong>{summary.complete}</strong><small>استلم جميع المقيّمين تقييماتهم</small></article>
        <article className="waiting"><span>تحتاج متابعة</span><strong>{summary.waiting}</strong><small>تقييم جزئي أو بانتظار التقييم</small></article>
        <article className="unassigned"><span>بدون مقيّم</span><strong>{summary.unassigned}</strong><small>لم يُحدد لهم مقيّم</small></article>
      </div>
      {view === "summary" && <div className="evaluation-report-grid"><GroupTable title="مقارنة الفروع" groups={groupRows.branches}/><GroupTable title="مقارنة الإدارات" groups={groupRows.departments}/><section className="evaluation-report-card evaluation-criteria-card"><div className="evaluation-report-section-heading"><h3>مؤشرات بنود التقييم</h3><span>{criteria.length} بند</span></div>{criteria.length ? <div className="evaluation-criteria-list">{criteria.map((criterion) => <div className="evaluation-criterion-row" key={criterion.name}><div><strong>{criterion.name}</strong><small>{criterion.count} إجابة</small></div><b>{number(criterion.average)}%</b><div className="evaluation-criterion-track"><span style={{ width: `${Math.min(100, Math.max(0, criterion.average))}%` }}/></div></div>)}</div> : <EmptyReport/>}</section></div>}
      {view === "branches" && <GroupTable title="ترتيب ومقارنة الفروع" groups={groupRows.branches} expanded/>}
      {view === "departments" && <GroupTable title="ترتيب ومقارنة الإدارات" groups={groupRows.departments} expanded/>}
      {view === "employees" && <section className="evaluation-report-card"><div className="evaluation-report-section-heading"><div><h3>تفاصيل تقييم الموظفين</h3><small>{monthLabel(month)} · اختر الموظف لعرض تقييمه أو تصديره</small></div><span>{filtered.length} موظف</span></div>{filtered.length ? <div className="evaluation-report-employee-list">{filtered.map((row) => <EmployeeEvaluationSheet key={row.employee.id} row={row} month={month} evaluatorNames={evaluatorNames} busy={busy} printTarget={printEmployeeId === row.employee.id} onExportExcel={() => void exportEmployeeExcel(row)} onExportPdf={() => exportPdf(row.employee.id)}/>)}</div> : <EmptyReport/>}</section>}
      {!filtered.length && view !== "employees" && <EmptyReport/>}
    </div>
    <p className="evaluation-report-note">يُحسب متوسط الموظف من التقييمات المقدّمة فقط. يظل المتوسط جزئيًا إلى أن يرسل كل المقيّمين المسندين تقييمهم. التصدير يطابق الفلاتر المحددة؛ وPDF يفتح نافذة الطباعة للحفظ كملف.</p>
  </section>;
}

function EmptyReport() { return <div className="evaluation-report-empty"><span aria-hidden="true">▧</span><p>لا توجد تقييمات مطابقة للفترة والفلاتر الحالية.</p></div>; }

function EmployeeEvaluationSheet({ row, month, evaluatorNames, busy, printTarget, onExportExcel, onExportPdf }: {
  row: ReportRow;
  month: string;
  evaluatorNames: Record<string, string>;
  busy: boolean;
  printTarget: boolean;
  onExportExcel: () => void;
  onExportPdf: () => void;
}) {
  return <details className="evaluation-report-employee" data-print-target={printTarget ? "true" : undefined}>
    <summary><div><strong>{employeeName(row.employee)}</strong><small>{row.employee.employee_number} · {[row.employee.branch_name, row.employee.department_name].filter(Boolean).join(" · ") || "—"}</small></div><b className={row.average !== null && row.average >= 75 ? "good" : ""}>{row.average === null ? "—" : `${number(row.average)}%`}</b><span>{statuses[row.status]}</span></summary>
    <div className="evaluation-employee-export-actions"><button type="button" onClick={onExportExcel} disabled={busy}>{busy ? "جارٍ التصدير…" : "⇩ Excel لهذا الموظف"}</button><button type="button" onClick={onExportPdf}>▧ PDF لهذا الموظف</button></div>
    <div className="evaluation-single-employee-print">
      <header className="evaluation-single-report-header"><Image src="/qararah-logo.jpeg" alt="شعار شركة قرارة" width={68} height={68}/><div><span>شركة قرارة للرخام والجرانيت · الموارد البشرية</span><h2>نتيجة تقييم الأداء</h2><p>الفترة: {monthLabel(month)}</p></div><div className="evaluation-single-score"><small>{row.status === "complete" ? "النتيجة النهائية" : "النتيجة الحالية"}</small><strong>{row.average === null ? "—" : `${number(row.average)}%`}</strong><span>{statuses[row.status]}</span></div></header>
      <div className="evaluation-single-employee-info"><span><small>الموظف</small><b>{employeeName(row.employee)}</b></span><span><small>الكود الوظيفي</small><b>{row.employee.employee_number}</b></span><span><small>الصفة</small><b>{row.employee.job_title_name || "—"}</b></span><span><small>الفرع والإدارة</small><b>{[row.employee.branch_name, row.employee.department_name].filter(Boolean).join(" · ") || "—"}</b></span><span><small>التقييمات الواردة</small><b>{row.evaluations.length} من {row.assignments.length} مقيّم مسند</b></span></div>
      {row.evaluations.length ? <div className="evaluation-single-reviewers">{row.evaluations.map((evaluation, reviewIndex) => {
        const assigned = row.assignments.find((assignment) => assignment.evaluator_profile_id === evaluation.evaluator_id);
        const evaluator = evaluatorNames[evaluation.evaluator_id ?? ""] || assigned?.evaluator_employee?.full_name || (assigned ? `المقيّم المسند ${assigned.slot}` : `مقيّم إضافي ${reviewIndex + 1}`);
        return <section className="evaluation-single-review" key={evaluation.id}>
          <header><div><small>المقيّم</small><strong>{evaluator}</strong></div><div className="evaluation-review-score"><small>معدل تقييمه</small><strong>{percent(evaluation) === null ? "—" : `${number(percent(evaluation)!)}%`}</strong><span>{evaluation.total_score === null ? "—" : `${number(evaluation.total_score)} / ${number(evaluation.max_score)}`}</span></div></header>
          <table><thead><tr><th>بند التقييم</th><th>الدرجة</th><th>النسبة</th><th>الملاحظة / الدليل</th></tr></thead><tbody>{(evaluation.evaluation_items ?? []).map((item, index) => <tr key={`${item.criterion}-${index}`}><th>{item.criterion}</th><td>{number(item.score)} / {number(item.max_score)}</td><td>{number(criterionPercent(item.score, item.max_score) ?? 0)}%</td><td>{item.evidence || "—"}</td></tr>)}</tbody></table>
          {evaluation.notes && <p className="evaluation-single-review-note"><b>ملخص المقيّم:</b> {evaluation.notes}</p>}
        </section>;
      })}</div> : <EmptyReport/>}
      <footer className="evaluation-single-signatures"><p>هذه نتيجة التقييم المسجلة في النظام، ولا تمثل اعتمادًا إداريًا إلكترونيًا.</p><div><span><small>توقيع المقيّم</small><i/></span><span><small>اعتماد المدير · توقيع يدوي</small><i/></span><span><small>التاريخ</small><i/></span></div></footer>
    </div>
  </details>;
}

function GroupTable({ title, groups, expanded = false }: { title: string; groups: GroupRow[]; expanded?: boolean }) {
  return <section className={`evaluation-report-card evaluation-group-card${expanded ? " expanded" : ""}`}><div className="evaluation-report-section-heading"><div><h3>{title}</h3><small>الترتيب حسب متوسط نتيجة التقييم</small></div><span>{groups.length} مجموعة</span></div>{groups.length ? <div className="evaluation-report-table-wrap"><table className="evaluation-report-table"><thead><tr><th>الفرع / الإدارة</th><th>الموظفون</th><th>لديهم نتيجة</th><th>مكتمل</th><th>جزئي</th><th>بانتظار</th><th>متوسط النتيجة</th><th>اكتمال الإسناد</th></tr></thead><tbody>{groups.map((group) => <tr key={group.name}><th>{group.name}</th><td>{group.employees}</td><td>{group.assessed}</td><td>{group.complete}</td><td>{group.partial}</td><td>{group.waiting}</td><td><strong>{group.average === null ? "—" : `${number(group.average)}%`}</strong>{group.average !== null && <div className="evaluation-compare-track"><span style={{ width: `${Math.min(100, Math.max(0, group.average))}%` }}/></div>}</td><td><strong>{number(group.completion)}%</strong></td></tr>)}</tbody></table></div> : <EmptyReport/>}</section>;
}
