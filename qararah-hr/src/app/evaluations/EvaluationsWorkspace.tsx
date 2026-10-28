"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toWesternDigits } from "@/lib/digits";
import EvaluationDialog from "./EvaluationDialog";
import EvaluationAssignmentDialog from "./EvaluationAssignmentDialog";
import EvaluationReports from "./EvaluationReports";
import { employeeName, monthLabel, type Role, type EvaluatedEmployee, type EvaluationAssignment, type EvaluationRecord, type EvaluatorOption } from "./evaluation-model";
import "./EvaluationsWorkspace.css";

type Props = {
  role: Role;
  userId: string;
  profileEmployeeId: string | null;
  month: string;
  employees: EvaluatedEmployee[];
  assignments: EvaluationAssignment[];
  evaluators: EvaluatorOption[];
  evaluations: EvaluationRecord[];
  evaluatorNames: Record<string, string>;
  canAssignEvaluators: boolean;
  canEvaluateAll: boolean;
  isBranchManager: boolean;
  canViewReport: boolean;
};
type Filter = "all" | "mine_pending" | "mine_submitted" | "partial" | "complete" | "unassigned";
const filterLabels: Record<Filter, string> = { all: "كل الموظفين", mine_pending: "بانتظار تقييمي", mine_submitted: "تم تقييمي", partial: "تقييم غير مكتمل", complete: "اكتملت التقييمات", unassigned: "بدون مقيّم" };
const normalize = (value: string) => toWesternDigits(value).normalize("NFKD").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLocaleLowerCase("ar");
const percentage = (evaluation: EvaluationRecord) => evaluation.total_score !== null && evaluation.max_score > 0 ? evaluation.total_score / evaluation.max_score * 100 : null;
const format = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

function EvaluationIcon({ kind }: { kind: "star" | "people" | "search" }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "star" && <path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.3-.9L12 3Z"/>}
    {kind === "people" && <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-4-5.6"/></>}
    {kind === "search" && <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>}
  </svg>;
}

export default function EvaluationsWorkspace({ role, userId, profileEmployeeId, month, employees, assignments, evaluators, evaluations, evaluatorNames, canAssignEvaluators, canEvaluateAll, isBranchManager, canViewReport }: Props) {
  const router = useRouter();
  const canAssign = role === "admin" || role === "hr" || canAssignEvaluators;
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [department, setDepartment] = useState("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [evaluationEmployeeId, setEvaluationEmployeeId] = useState<string | null>(null);
  const [assignmentEmployeeId, setAssignmentEmployeeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"work" | "reports">("work");
  const [isPending, startTransition] = useTransition();
  const [pendingMonth, setPendingMonth] = useState(month);
  const branches = [...new Map(employees.map(employee => [employee.branch_id, employee.branch_name || "الفرع غير محدد"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  const departments = [...new Map(employees.filter(employee => branch === "all" || employee.branch_id === branch).map(employee => [employee.department_id ?? "unassigned", employee.department_name || "القسم غير محدد"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  const rows = employees.map(employee => {
    const employeeAssignments = assignments.filter(item => item.employee_id === employee.id).sort((a, b) => a.slot - b.slot);
    const submitted = evaluations.filter(item => item.employee_id === employee.id && item.period_month.slice(0, 7) === month && item.status === "submitted");
    const mine = evaluations.find(item => item.employee_id === employee.id && item.period_month.slice(0, 7) === month && item.evaluator_id === userId) ?? null;
    const assignedToMe = employeeAssignments.some(item => item.evaluator_profile_id === userId || (!!profileEmployeeId && item.evaluator_employee_id === profileEmployeeId));
    const canEvaluate = assignedToMe || role === "auditor" || canEvaluateAll;
    const received = employeeAssignments.filter(assignment => !!assignment.evaluator_profile_id && submitted.some(item => item.evaluator_id === assignment.evaluator_profile_id)).length;
    const complete = employeeAssignments.length > 0 && received === employeeAssignments.length;
    const scored = submitted.map(percentage).filter((value): value is number => value !== null);
    const average = scored.length ? scored.reduce((sum, value) => sum + value, 0) / scored.length : null;
    const state = complete ? "complete" : submitted.length ? "partial" : !employeeAssignments.length ? "unassigned" : "waiting";
    return { employee, assignments: employeeAssignments, submitted, mine, canEvaluate, received, average, state };
  });
  type Row = typeof rows[number];
  function matchesFilter(row: Row, state: Filter) {
    if (state === "mine_pending") return row.canEvaluate && row.mine?.status !== "submitted";
    if (state === "mine_submitted") return row.mine?.status === "submitted";
    return state === "all" || row.state === state;
  }
  const terms = normalize(search.trim()).split(/\s+/).filter(Boolean);
  const matching = rows.filter(({ employee }) => (branch === "all" || employee.branch_id === branch) && (department === "all" || (employee.department_id ?? "unassigned") === department) && terms.every(term => normalize([employeeName(employee), employee.employee_number, employee.branch_name, employee.department_name, employee.job_title_name].join(" ")).includes(term)));
  const filtered = matching.filter(row => matchesFilter(row, filter)).sort((a, b) => employeeName(a.employee).localeCompare(employeeName(b.employee), "ar") || a.employee.id.localeCompare(b.employee.id));
  const totalPages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const evaluationRow = rows.find(row => row.employee.id === evaluationEmployeeId && row.canEvaluate);
  const assignmentRow = rows.find(row => row.employee.id === assignmentEmployeeId);
  const hasFilters = !!search.trim() || branch !== "all" || department !== "all" || filter !== "all";
  const savedCount = matching.reduce((sum, row) => sum + row.submitted.length, 0);

  function resetFilters() { setSearch(""); setBranch("all"); setDepartment("all"); setFilter("all"); setPage(1); }
  function changeBranch(value: string) {
    setBranch(value); setPage(1);
    if (department !== "all" && !employees.some(employee => (value === "all" || employee.branch_id === value) && (employee.department_id ?? "unassigned") === department)) setDepartment("all");
  }
  function chooseMonth(value: string) {
    if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value) && value !== month) { setPage(1); setPendingMonth(value); startTransition(() => router.push(`/evaluations?month=${value}`)); }
  }
  function saved(text: string) { setMessage(text); setEvaluationEmployeeId(null); setAssignmentEmployeeId(null); setPendingMonth(month); startTransition(() => router.refresh()); }
  function evaluatorName(assignment: EvaluationAssignment) {
    return assignment.evaluator_employee?.full_name || [assignment.evaluator_employee?.first_name, assignment.evaluator_employee?.last_name].filter(Boolean).join(" ") || evaluators.find(candidate => candidate.employee_id === assignment.evaluator_employee_id)?.full_name || `المقيّم ${assignment.slot}`;
  }

  return <section className="evaluation-board" dir="rtl">
    <header className="evaluation-board-hero"><div><span>الموارد البشرية / متابعة الأداء</span><h1>{activeTab === "work" ? "التقييمات الشهرية" : "تقرير تقييم الأداء"}</h1><p>{activeTab === "work" ? "اختر الموظف وافتح نافذة التقييم، ثم سجّل إجاباتك وملاحظاتك." : "راجع النتائج وقارن الفروع والإدارات وصدّر التقرير حسب الفلاتر التي تحددها."}</p></div><div className="evaluation-period"><EvaluationIcon kind="star"/><div><small>فترة التقييم</small><strong>{monthLabel(month)}</strong></div></div></header>
    <nav className="evaluation-workspace-tabs" aria-label="تقييم الأداء"><button type="button" className={activeTab === "work" ? "active" : ""} aria-pressed={activeTab === "work"} onClick={() => setActiveTab("work")}>★ الشغل</button>{canViewReport && <button type="button" className={activeTab === "reports" ? "active" : ""} aria-pressed={activeTab === "reports"} onClick={() => setActiveTab("reports")}>▦ التقارير</button>}</nav>
    {activeTab === "reports" && canViewReport ? <EvaluationReports month={month} onMonthChange={chooseMonth} employees={employees} assignments={assignments} evaluations={evaluations} evaluatorNames={evaluatorNames}/> : <div className="evaluation-board-body">
      <div className="evaluation-board-metrics">
        <article><span>الموظفون المعروضون</span><strong>{matching.length}<small>موظف</small></strong><p>ضمن نطاق صلاحياتك والفلاتر المحددة</p></article>
        <article className="waiting"><span>بانتظار تقييمي</span><strong>{matching.filter(row => matchesFilter(row, "mine_pending")).length}<small>موظف</small></strong><p>موظفون متاحون لك ولم ترسل تقييمهم</p></article>
        <article className="submitted"><span>التقييمات المقدمة</span><strong>{savedCount}<small>تقييم</small></strong><p>نتيجة مستقلة لكل مسؤول في هذا الشهر</p></article>
        <article><span>اكتملت التقييمات</span><strong>{matching.filter(row => row.state === "complete").length}<small>موظف</small></strong><p>قدّم جميع المقيّمين المسندين تقييمهم</p></article>
      </div>
      {message && <p className="evaluation-board-notice" role="status">{message}<button type="button" aria-label="إغلاق رسالة التقييم" onClick={() => setMessage("")}>×</button></p>}
      <div className="evaluation-filter-heading"><div><h2>البحث عن الموظفين</h2><p>اختر الشهر والفرع والقسم للوصول إلى الموظف المطلوب.</p></div>{hasFilters && <button type="button" onClick={resetFilters}>مسح الفلاتر ×</button>}</div>
      <div className="evaluation-board-filters">
        <label className="evaluation-board-search"><span>اسم الموظف أو الرقم الوظيفي</span><div><EvaluationIcon kind="search"/><input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="ابحث بالاسم أو الرقم أو الصفة…"/></div></label>
        <label><span>شهر التقييم {isPending && <small className="evaluation-loading-hint" role="status">جارٍ تحديث البيانات…</small>}</span><input type="month" disabled={isPending} value={isPending ? pendingMonth : month} onChange={event => chooseMonth(event.target.value)}/></label>
        <label><span>الفرع</span><select value={branch} onChange={event => changeBranch(event.target.value)}><option value="all">كل الفروع</option>{branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>القسم</span><select value={department} onChange={event => { setDepartment(event.target.value); setPage(1); }}><option value="all">كل الأقسام</option>{departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      </div>
      <div className="evaluation-board-tabs" aria-label="تصفية حالة التقييم">{(Object.keys(filterLabels) as Filter[]).map(key => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1); }}>{filterLabels[key]}<span>{matching.filter(row => matchesFilter(row, key)).length}</span></button>)}</div>
      <div className="evaluation-register-heading"><div><h2>سجل تقييم الموظفين <span>{filtered.length}</span></h2><p>{monthLabel(month)} · يُحسب المتوسط من نسب التقييمات المقدمة.</p></div><span className="evaluation-register-hint">كل مسؤول يقيّم بشكل مستقل</span></div>
      <div className="evaluation-register-wrap"><table className="evaluation-register"><thead><tr><th>الموظف</th><th>المسؤولون عن التقييم</th><th>نتيجة الشهر</th><th>حالة التقييم</th><th>الإجراءات</th></tr></thead><tbody>{visible.map(row => {
        const { employee, mine, average, state } = row;
        return <tr key={employee.id}>
          <td data-label="الموظف"><div className="evaluation-register-person"><span aria-hidden="true">{employeeName(employee).charAt(0)}</span><div><strong>{employeeName(employee)}</strong><small>{employee.job_title_name || "موظف إداري"}</small><bdi>{employee.employee_number}</bdi><p>{[employee.branch_name, employee.department_name].filter(Boolean).join(" · ")}</p></div></div></td>
          <td data-label="المسؤولون عن التقييم">{row.assignments.length ? <div className="evaluation-register-evaluators">{row.assignments.map(assignment => {
            const result = assignment.evaluator_profile_id ? row.submitted.find(item => item.evaluator_id === assignment.evaluator_profile_id) : null;
            const resultPercentage = result ? percentage(result) : null;
            return <div key={assignment.slot}><i>{assignment.slot}</i><span>{evaluatorName(assignment)}<small className={result ? "done" : ""}>{resultPercentage === null ? "بانتظار التقييم" : `${format(resultPercentage)}% · تم التقييم`}</small></span></div>;
          })}{row.submitted.length > row.received && <small className="evaluation-extra-count">{row.submitted.length - row.received} تقييم إضافي مقدم</small>}</div> : <span className="evaluation-no-assignment">لم يحدد مقيّم بعد</span>}</td>
          <td data-label="نتيجة الشهر"><strong className={`evaluation-average ${state === "complete" ? "complete" : ""}`} dir="ltr">{average === null ? "—" : `${format(average)}%`}</strong><small className="evaluation-average-label">{average === null ? "لم يُقدّم تقييم بعد" : state === "complete" ? "المتوسط النهائي" : "المتوسط الحالي"}</small>{average !== null && <div className="evaluation-average-track" role="progressbar" aria-label={`متوسط تقييم ${employeeName(employee)}`} aria-valuenow={Math.min(100, average)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(0, average))}%` }}/></div>}</td>
          <td data-label="حالة التقييم"><span className={`evaluation-register-state ${state}`}><i/>{state === "complete" ? "مكتمل" : state === "partial" ? "تقييم مقدم" : state === "unassigned" ? "بانتظار الإسناد" : "بانتظار التقييم"}</span>{row.assignments.length > 0 && <small className="evaluation-assigned-progress">{row.received} من {row.assignments.length} مقيّم</small>}{mine?.status === "submitted" && <span className="evaluation-mine-submitted">✓ أرسلت تقييمك</span>}</td>
          <td data-label="الإجراءات"><div className="evaluation-register-actions">{row.canEvaluate ? <button type="button" disabled={isPending} className="evaluation-open-button" aria-label={`تقييم الموظف: ${employeeName(employee)}`} onClick={() => setEvaluationEmployeeId(employee.id)}><EvaluationIcon kind="star"/>{mine?.status === "submitted" ? "تحديث تقييمي" : "تقييم"}</button> : <span className="evaluation-readonly-hint">غير مسند إليك</span>}{canAssign && <button type="button" disabled={isPending} className="evaluation-assign-button" aria-label={`إسناد مقيّمي الموظف: ${employeeName(employee)}`} onClick={() => setAssignmentEmployeeId(employee.id)}><EvaluationIcon kind="people"/>{row.assignments.length ? "المقيّمون" : "إسناد المقيّمين"}</button>}</div></td>
        </tr>;
      })}</tbody></table>{!filtered.length && <div className="evaluation-register-empty"><span aria-hidden="true">☆</span><h3>{employees.length ? "لا يوجد موظفون يطابقون الفلاتر" : "لا يوجد موظفون مسندون للتقييم"}</h3><p>{employees.length ? "جرّب تغيير الفرع أو القسم أو حالة التقييم." : isBranchManager ? "سيظهر الموظفون هنا بعد إسناد مسؤولية تقييمهم إليك." : "تظهر هنا قائمة الموظفين المتاحين لحسابك حسب الصلاحيات والإسناد."}</p>{hasFilters && <button type="button" onClick={resetFilters}>عرض كل الموظفين</button>}</div>}</div>
      <footer className="evaluation-register-footer"><span>{filtered.length ? `${(currentPage - 1) * 10 + 1}–${Math.min(currentPage * 10, filtered.length)} من ${filtered.length} موظف` : "0 موظف"}</span><nav aria-label="صفحات سجل التقييم"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>السابق</button><span>{currentPage} / {totalPages}</span><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>التالي</button></nav></footer>
      <p className="evaluation-board-footnote">تُحفظ إجابات كل مسؤول باسمه. يظهر المتوسط الحالي إلى حين تقديم جميع المقيّمين المسندين لتقييماتهم.</p>
    </div>}
    {activeTab === "work" && evaluationRow && <EvaluationDialog key={`${evaluationRow.employee.id}:${month}`} employee={evaluationRow.employee} month={month} userId={userId} existing={evaluationRow.mine} onClose={() => setEvaluationEmployeeId(null)} onSaved={saved}/>}
    {activeTab === "work" && canAssign && assignmentRow && <EvaluationAssignmentDialog key={assignmentRow.employee.id} employee={assignmentRow.employee} assignments={assignmentRow.assignments} evaluators={evaluators} onClose={() => setAssignmentEmployeeId(null)} onSaved={saved}/>}
  </section>;
}
