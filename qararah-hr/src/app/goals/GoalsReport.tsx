"use client";

import { Fragment, useMemo, useState } from "react";
import { toWesternDigits } from "@/lib/digits";
import "./GoalsReport.css";

type Task = { id: string; title: string; is_completed: boolean; due_date: string | null };
type GoalRow = {
  id: string; employee_id: string; period_month: string; title: string; description: string | null;
  target_value: number | null; actual_value: number | null; target_unit: string | null; tasks?: Task[];
  employee?: { full_name: string | null; first_name: string; last_name: string | null; employee_number: string; branch?: { name: string } | null } | null;
};
type EmployeeOption = { id: string; full_name: string; employee_number: string; branch_name: string };
type Outcome = "all" | "achieved" | "below" | "waiting" | "no_target";
type Deadline = "all" | "overdue" | "on_time" | "no_tasks";

const todayInTripoli = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const monthLabel = (value: string) => new Intl.DateTimeFormat("ar-LY", { timeZone: "Africa/Tripoli", month: "long", year: "numeric" }).format(new Date(`${value}-15T12:00:00Z`));
const dateLabel = (value: string | null) => value ? toWesternDigits(new Intl.DateTimeFormat("ar-LY", { timeZone: "Africa/Tripoli", dateStyle: "medium" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))) : "—";
const outcomeLabel: Record<Exclude<Outcome, "all">, string> = { achieved: "حقق المستهدف", below: "أقل من المستهدف", waiting: "لم يسجل النتيجة", no_target: "دون مستهدف رقمي" };
const deadlineLabel: Record<Exclude<Deadline, "all">, string> = { overdue: "متأخر", on_time: "غير متأخر", no_tasks: "بلا مهام" };
const employeeName = (goal: GoalRow) => goal.employee?.full_name || [goal.employee?.first_name, goal.employee?.last_name].filter(Boolean).join(" ") || "موظف";

function goalOutcome(goal: GoalRow): Exclude<Outcome, "all"> {
  if (goal.actual_value === null) return "waiting";
  if (goal.target_value === null || goal.target_value <= 0) return "no_target";
  return goal.actual_value >= goal.target_value ? "achieved" : "below";
}
function overdueTasks(goal: GoalRow, today: string) { return (goal.tasks ?? []).filter((task) => !task.is_completed && task.due_date && task.due_date < today); }

export default function GoalsReport({ goals, employees, defaultMonth, canViewAll }: { goals: GoalRow[]; employees: EmployeeOption[]; defaultMonth: string; canViewAll: boolean }) {
  const [month, setMonth] = useState(defaultMonth);
  const [branch, setBranch] = useState("all");
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [deadline, setDeadline] = useState<Deadline>("all");
  const [query, setQuery] = useState("");
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const today = todayInTripoli();

  const monthGoals = useMemo(() => goals.filter((goal) => goal.period_month.slice(0, 7) === month), [goals, month]);
  const branches = useMemo(() => [...new Set(monthGoals.map((goal) => goal.employee?.branch?.name || employees.find((row) => row.id === goal.employee_id)?.branch_name).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "ar")), [monthGoals, employees]);
  const filtered = useMemo(() => {
    const search = toWesternDigits(query.trim()).toLocaleLowerCase("ar");
    return monthGoals.filter((goal) => {
      const currentBranch = goal.employee?.branch?.name || employees.find((row) => row.id === goal.employee_id)?.branch_name || "—";
      const goalTasks = goal.tasks ?? [];
      const isOverdue = overdueTasks(goal, today).length > 0;
      const goalDeadline: Exclude<Deadline, "all"> = !goalTasks.length ? "no_tasks" : isOverdue ? "overdue" : "on_time";
      const name = employeeName(goal).toLocaleLowerCase("ar");
      const employeeNumber = goal.employee?.employee_number || employees.find((row) => row.id === goal.employee_id)?.employee_number || "";
      return (branch === "all" || branch === currentBranch)
        && (outcome === "all" || outcome === goalOutcome(goal))
        && (deadline === "all" || deadline === goalDeadline)
        && (!search || name.includes(search) || toWesternDigits(employeeNumber).toLocaleLowerCase("ar").includes(search) || goal.title.toLocaleLowerCase("ar").includes(search));
    }).sort((a, b) => (a.employee?.branch?.name || "").localeCompare(b.employee?.branch?.name || "", "ar") || employeeName(a).localeCompare(employeeName(b), "ar") || a.title.localeCompare(b.title, "ar"));
  }, [monthGoals, branch, outcome, deadline, query, today, employees]);

  const achievedCount = filtered.filter((goal) => goalOutcome(goal) === "achieved").length;
  const waitingCount = filtered.filter((goal) => goalOutcome(goal) === "waiting").length;
  const overdueCount = filtered.filter((goal) => overdueTasks(goal, today).length > 0).length;
  const taskCount = filtered.reduce((sum, goal) => sum + (goal.tasks?.length ?? 0), 0);
  const doneCount = filtered.reduce((sum, goal) => sum + (goal.tasks?.filter((task) => task.is_completed).length ?? 0), 0);

  function resetFilters() { setBranch("all"); setOutcome("all"); setDeadline("all"); setQuery(""); }

  function exportPdf() {
    setExpandedGoals(new Set(filtered.map((goal) => goal.id)));
    window.setTimeout(() => window.print(), 100);
  }

  async function exportExcel() {
    if (!filtered.length || busy) return;
    setBusy(true); setMessage("");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "نظام الموارد البشرية - قرارة";
      const sheet = workbook.addWorksheet("تقرير الأهداف", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
      sheet.mergeCells("A1:P1");
      sheet.getCell("A1").value = "تقرير أهداف الموظفين";
      sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173B65" } };
      sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(1).height = 32;
      sheet.mergeCells("A2:P2");
      sheet.getCell("A2").value = `الفترة: ${monthLabel(month)} · الفرع: ${branch === "all" ? "كل الفروع المتاحة" : branch} · تاريخ التصدير: ${today}`;
      sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      sheet.mergeCells("A3:P3");
      sheet.getCell("A3").value = "تحقيق الهدف يعتمد على النتيجة الفعلية؛ وإنجاز المهام يعرض بشكل مستقل.";
      sheet.getCell("A3").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      sheet.addRow(["م", "الشهر", "الكود الوظيفي", "الموظف", "الفرع", "الهدف", "المستهدف", "النتيجة الفعلية", "تحقيق الهدف %", "مهام منجزة", "إجمالي المهام", "مهام متبقية", "مهام متأخرة", "أقرب موعد", "حالة النتيجة", "حالة المهام"]);
      sheet.getRow(4).height = 36;
      sheet.getRow(4).eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2873B8" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
      filtered.forEach((goal, index) => {
        const tasks = goal.tasks ?? [];
        const done = tasks.filter((task) => task.is_completed).length;
        const late = overdueTasks(goal, today);
        const remainingTasks = tasks.filter((task) => !task.is_completed);
        const nextDue = remainingTasks.map((task) => task.due_date).filter((date): date is string => Boolean(date)).sort()[0] ?? null;
        const target = goal.target_value;
        const actual = goal.actual_value;
        const percentage = target && target > 0 && actual !== null ? actual / target * 100 : null;
        const person = employees.find((row) => row.id === goal.employee_id);
        const row = sheet.addRow([index + 1, monthLabel(goal.period_month.slice(0, 7)), goal.employee?.employee_number || person?.employee_number || "—", employeeName(goal), goal.employee?.branch?.name || person?.branch_name || "—", goal.title, target, actual, percentage === null ? null : Math.round(percentage * 10) / 10, done, tasks.length, remainingTasks.length, late.length, nextDue ? dateLabel(nextDue) : "—", outcomeLabel[goalOutcome(goal)], !tasks.length ? deadlineLabel.no_tasks : late.length ? deadlineLabel.overdue : deadlineLabel.on_time]);
        row.eachCell((cell) => { cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.font = { size: 10, color: { argb: "FF334155" } }; cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } }; });
        if (index % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F9FD" } }; });
        if (percentage !== null) row.getCell(9).numFmt = '0.0"%"';
      });
      [7, 15, 23, 27, 20, 35, 16, 17, 16, 13, 14, 14, 14, 18, 25, 17].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
      sheet.autoFilter = { from: "A4", to: `P${sheet.rowCount}` };
      sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };

      // Keep the goal summary compact, and provide every task on a dedicated sheet.
      const taskSheet = workbook.addWorksheet("تفاصيل المهام", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
      taskSheet.mergeCells("A1:H1");
      taskSheet.getCell("A1").value = "تفاصيل مهام الأهداف";
      taskSheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      taskSheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173B65" } };
      taskSheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      taskSheet.getRow(1).height = 32;
      taskSheet.mergeCells("A2:H2");
      taskSheet.getCell("A2").value = `الفترة: ${monthLabel(month)} · الفرع: ${branch === "all" ? "كل الفروع المتاحة" : branch} · تاريخ التصدير: ${today}`;
      taskSheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      taskSheet.addRow(["م", "الموظف", "الكود الوظيفي", "الفرع", "الهدف", "المهمة", "حالة المهمة", "موعد التسليم"]);
      taskSheet.getRow(3).height = 34;
      taskSheet.getRow(3).eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2873B8" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
      let taskIndex = 0;
      filtered.forEach((goal) => {
        const person = employees.find((row) => row.id === goal.employee_id);
        const employeeNumber = goal.employee?.employee_number || person?.employee_number || "—";
        const branchName = goal.employee?.branch?.name || person?.branch_name || "—";
        (goal.tasks ?? []).forEach((task) => {
          taskIndex += 1;
          const row = taskSheet.addRow([taskIndex, employeeName(goal), employeeNumber, branchName, goal.title, task.title, task.is_completed ? "منجزة" : "غير منجزة", task.due_date ? dateLabel(task.due_date) : "غير محدد"]);
          row.eachCell((cell) => { cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true }; cell.font = { size: 10, color: { argb: "FF334155" } }; cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } }; });
          row.getCell(7).font = { size: 10, bold: true, color: { argb: task.is_completed ? "FF18724F" : "FF9A6B24" } };
          if (taskIndex % 2 === 0) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F9FD" } }; });
        });
      });
      [8, 28, 17, 22, 34, 42, 18, 20].forEach((width, index) => { taskSheet.getColumn(index + 1).width = width; });
      if (taskIndex) taskSheet.autoFilter = { from: "A3", to: `H${taskSheet.rowCount}` };
      taskSheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `تقرير-الأهداف-${month}.xlsx`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`تم تصدير ${toWesternDigits(filtered.length)} هدف إلى Excel.`);
    } catch (error) {
      setMessage(error instanceof Error ? `تعذر إعداد التقرير: ${error.message}` : "تعذر إعداد التقرير.");
    } finally { setBusy(false); }
  }

  return <section className="goals-report" dir="rtl">
    <header className="goals-report-hero"><div><span>الموارد البشرية / متابعة الأداء</span><h2>تقرير الأهداف</h2><p>تابع النتائج الفعلية، إنجاز المهام، والمواعيد المتأخرة لكل موظف.</p></div><div className="goals-report-actions"><button type="button" onClick={exportExcel} disabled={!filtered.length || busy}>{busy ? "جارٍ تجهيز الملف…" : "⇩ تصدير Excel"}</button><button type="button" onClick={exportPdf} disabled={!filtered.length}>▧ تصدير PDF</button></div></header>
    <div className="goals-report-metrics"><article><span>الأهداف في التقرير</span><strong>{number(filtered.length)}</strong><small>{monthLabel(month)}</small></article><article className="achieved"><span>حققت المستهدف</span><strong>{number(achievedCount)}</strong><small>حسب النتيجة الفعلية</small></article><article className="waiting"><span>النتيجة غير مسجلة</span><strong>{number(waitingCount)}</strong><small>تحتاج إدخال الإنجاز الفعلي</small></article><article className="late"><span>لديها مهام متأخرة</span><strong>{number(overdueCount)}</strong><small>{number(doneCount)} من {number(taskCount)} مهمة منجزة</small></article></div>
    <section className="goals-report-filters"><header><div><h3>تصفية التقرير</h3><p>الفلاتر تؤثر على الجدول وملفي التصدير.</p></div><button type="button" onClick={resetFilters}>مسح الفلاتر</button></header><div className="goals-report-filter-grid"><label>الشهر<input type="month" value={month} onChange={(event) => setMonth(event.target.value)}/></label>{canViewAll && <label>الفرع<select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">كل الفروع</option>{branches.map((name) => <option key={name}>{name}</option>)}</select></label>}<label className="search">بحث عن موظف أو هدف<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="الاسم، الكود الوظيفي، أو الهدف"/></label><label>حالة النتيجة<select value={outcome} onChange={(event) => setOutcome(event.target.value as Outcome)}><option value="all">كل الحالات</option><option value="achieved">حقق المستهدف</option><option value="below">أقل من المستهدف</option><option value="waiting">لم يسجل النتيجة</option><option value="no_target">دون مستهدف رقمي</option></select></label><label>حالة المهام<select value={deadline} onChange={(event) => setDeadline(event.target.value as Deadline)}><option value="all">كل الحالات</option><option value="overdue">متأخر</option><option value="on_time">غير متأخر</option><option value="no_tasks">بلا مهام</option></select></label></div></section>
    {message && <p className="goals-report-message" role="status">{message}</p>}
    <section className="goals-report-sheet" id="goals-report-print"><header><div><small>شركة قرارة · الموارد البشرية</small><h3>تقرير أهداف الموظفين</h3><p>{monthLabel(month)} · {branch === "all" ? "كل الفروع المتاحة" : branch}</p></div><div><b>{number(filtered.length)}</b><span>هدف في التقرير</span></div></header><div className="goals-report-table-wrap"><table><thead><tr><th>الموظف والفرع</th><th>الهدف</th><th>النتيجة الفعلية</th><th>تحقيق الهدف</th><th>إنجاز المهام</th><th>المهام المتأخرة</th><th>أقرب موعد</th><th>الحالة</th></tr></thead><tbody>{filtered.map((goal) => {
      const tasks = goal.tasks ?? [];
      const done = tasks.filter((task) => task.is_completed).length;
      const late = overdueTasks(goal, today);
      const nextDue = tasks.filter((task) => !task.is_completed && task.due_date).map((task) => task.due_date as string).sort()[0] ?? null;
      const actualPercent = goal.target_value && goal.target_value > 0 && goal.actual_value !== null ? goal.actual_value / goal.target_value * 100 : null;
      const person = employees.find((row) => row.id === goal.employee_id);
      const branchName = goal.employee?.branch?.name || person?.branch_name || "—";
      const goalStatus = goalOutcome(goal);
      const expanded = expandedGoals.has(goal.id);
      return <Fragment key={goal.id}><tr><td data-label="الموظف والفرع"><strong>{employeeName(goal)}</strong><small>{goal.employee?.employee_number || person?.employee_number || "—"} · {branchName}</small></td><td data-label="الهدف"><div className="goals-report-goal-heading"><strong>{goal.title}</strong><button type="button" className={`goals-report-expand ${expanded ? "expanded" : ""}`} aria-expanded={expanded} aria-label={`${expanded ? "إخفاء" : "عرض"} مهام الهدف ${goal.title}`} onClick={() => setExpandedGoals((current) => { const next = new Set(current); if (next.has(goal.id)) next.delete(goal.id); else next.add(goal.id); return next; })}>{expanded ? "−" : "+"}</button></div>{goal.description && <small>{goal.description}</small>}<small className="goals-report-task-summary">{number(done)} من {number(tasks.length)} مهام منجزة</small></td><td data-label="النتيجة الفعلية">{goal.actual_value === null ? "لم تُسجل" : `${number(goal.actual_value)} ${goal.target_unit || ""}`}{goal.target_value !== null && <small>المستهدف: {number(goal.target_value)} {goal.target_unit || ""}</small>}</td><td data-label="تحقيق الهدف">{actualPercent === null ? "—" : `${number(actualPercent)}٪`}</td><td data-label="إنجاز المهام"><strong>{number(done)} / {number(tasks.length)}</strong><small>{tasks.filter((task) => !task.is_completed).length} متبقية</small></td><td data-label="المهام المتأخرة"><span className={`goals-report-pill ${late.length ? "late" : "ok"}`}>{number(late.length)}</span></td><td data-label="أقرب موعد">{dateLabel(nextDue)}</td><td data-label="الحالة"><span className={`goals-report-pill outcome-${goalStatus}`}>{outcomeLabel[goalStatus]}</span><small className={`goals-report-deadline ${!tasks.length ? "none" : late.length ? "late" : "ok"}`}>{!tasks.length ? deadlineLabel.no_tasks : late.length ? deadlineLabel.overdue : deadlineLabel.on_time}</small></td></tr>{expanded && <tr className="goals-report-expanded-row"><td colSpan={8}><div className="goals-report-expanded-panel"><header><strong>المهام التابعة للهدف</strong><span>{number(done)} من {number(tasks.length)} منجزة · {number(tasks.length - done)} متبقية</span></header>{tasks.length ? <div className="goals-report-task-list">{tasks.map((task, taskIndex) => <div className={`goals-report-task ${task.is_completed ? "completed" : "pending"}`} key={task.id}><span className="goals-report-task-state">{task.is_completed ? "✓ منجزة" : "○ لم تنجز"}</span><span className="goals-report-task-title">{taskIndex + 1}. {task.title}</span><small>موعد التسليم: {dateLabel(task.due_date)}</small></div>)}</div> : <p>لا توجد مهام مضافة لهذا الهدف.</p>}</div></td></tr>}</Fragment>;
    })}</tbody></table>{!filtered.length && <p className="goals-report-empty">لا توجد أهداف مطابقة للفلاتر في هذا الشهر.</p>}</div><footer><span>حالة النتيجة مستقلة عن إنجاز المهام.</span><span>تاريخ التقرير: {dateLabel(today)}</span></footer></section>
    <p className="goals-report-note">التأخير يُحتسب عند وجود مهمة غير مكتملة تجاوز موعدها. تصدير PDF يفتح نافذة الطباعة؛ اختر «حفظ كملف PDF».</p>
  </section>;
}
