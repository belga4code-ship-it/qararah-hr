"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { lateMinutesAfter915 } from "@/lib/attendance";
import { toWesternDigits } from "@/lib/digits";
import GoalActions from "./goals/GoalActions";

type Employee = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string | null;
  full_name?: string | null;
  status: string;
  hired_on?: string | null;
  job_title: { name: string } | null;
  branch?: { name: string } | null;
  department?: { name: string } | null;
};
type GoalTask = { id: string; goal_id: string; title: string; sort_order: number; is_completed: boolean; due_date: string | null; employee_note: string | null; review_status: string };
type Goal = { id: string; period_month: string; title: string; description: string | null; target_value: number | null; actual_value: number | null; target_unit: string | null; goal_revision?: number; tasks?: GoalTask[] };
type EvaluationItem = { criterion: string; score: number; max_score: number; evidence: string | null };
type Evaluation = { id: string; period_month: string; evaluator_id: string | null; total_score: number | null; max_score: number; status: string; notes: string | null; evaluation_items?: EvaluationItem[] };
type Report = { id: string; category: string; subject: string; message: string; status: string; hr_response: string | null; created_at: string };
type RequestEvent = { id: string; event_type: string; effective_date: string; end_date: string | null; status: string; reason: string | null; decision_reason: string | null };
type Attendance = { id: string; attendance_date: string; status: string; first_in: string | null; exception_note: string | null };
type DetailData = { goals: Goal[]; evaluations: Evaluation[]; reports: Report[]; requests: RequestEvent[]; attendance: Attendance[]; errors: Record<string, boolean>; goalProgressAvailable: boolean; goalTasksAvailable: boolean };

const tabs = [
  { id: "summary", label: "ملخص" },
  { id: "goals", label: "الأهداف" },
  { id: "evaluations", label: "التقييم" },
  { id: "requests", label: "الطلبات" },
  { id: "reports", label: "البلاغات" },
] as const;
type Tab = (typeof tabs)[number]["id"];

const requestLabels: Record<string, string> = { leave: "إجازة", late_permission: "استئذان تأخير", permission: "استئذان", mission: "مأمورية" };
const requestStatus: Record<string, string> = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
const reportStatus: Record<string, string> = { pending: "جديد", in_progress: "قيد المعالجة", resolved: "تمت المعالجة" };
const reportCategory: Record<string, string> = { workplace: "بيئة العمل", safety: "السلامة", suggestion: "اقتراح", other: "أخرى" };
const eventStatusClass: Record<string, string> = { pending: "pending", approved: "approved", rejected: "rejected" };
const statusLabels: Record<string, string> = { active: "نشط", on_leave: "في إجازة", suspended: "موقوف", terminated: "منتهي الخدمة", needs_review: "يحتاج مراجعة" };
const number = (value: number) => toWesternDigits(new Intl.NumberFormat("ar-LY", { maximumFractionDigits: 1 }).format(value));
const date = (value: string) => toWesternDigits(new Intl.DateTimeFormat("ar-LY", { dateStyle: "medium", timeZone: "Africa/Tripoli" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)));
const month = (value: string) => toWesternDigits(new Intl.DateTimeFormat("ar-LY", { month: "long", year: "numeric", timeZone: "Africa/Tripoli" }).format(new Date(`${value.slice(0, 7)}-15T12:00:00Z`)));
const employeeName = (employee: Employee) => employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ");
const currentMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit" }).format(new Date());
const defaultTaskDueDate = (value: string) => { const [year, monthValue] = value.split("-").map(Number); return new Date(Date.UTC(year, monthValue, 10)).toISOString().slice(0, 10); };
function criteriaFor(title: string) {
  if (/محاسب/.test(title)) return ["الالتزام بالحضور وإدارة الوقت وإنجاز المهام", "العمل الجماعي والتعاون وتحمل المسؤولية", "إدارة السلف ومطابقتها مع الفرع", "دقة فواتير البيع والشراء بين الفروع", "متابعة مديونيات الزبائن ورفع التقرير المالي", "إدخال إيصالات القبض والتحويلات ومراجعة المرفقات", "إتمام المطابقة الشهرية مع الإدارة المالية في موعدها", "إدارة مصروفات الفرع وإضافة مستنداتها يوميًا", "إدارة حركة الخزينة اليومية وإرفاق المستندات"];
  if (/مبيعات|مندوب/.test(title)) return ["الالتزام بالحضور وإدارة الوقت وإنجاز المهام", "تحقيق نسبة المبيعات المستهدفة خلال الشهر", "استقطاب زبائن جدد بالتسويق الخارجي", "تسويق المنتجات التي بها ركود", "متابعة الزبائن بعد البيع وعرض المنتجات الجديدة", "متابعة سداد مديونيات الزبائن", "المظهر ومهارات التواصل والتسويق والإقناع", "حل مشاكل الزبائن والمحافظة على استمرارية التعامل", "دقة الفواتير ومدخلات المنظومة", "رفع تقرير شهري باحتياجات الزبائن والسوق"];
  return ["الالتزام بالحضور وإدارة الوقت وإنجاز المهام", "جودة العمل ودقة النتائج", "الالتزام بالإجراءات والتعليمات المعتمدة", "إنجاز المهام في المواعيد المحددة", "العمل الجماعي والتعاون مع الفريق", "تحمل المسؤولية والمحافظة على ممتلكات الشركة", "التواصل المهني وخدمة الزملاء والعملاء", "التعامل مع المشكلات وإيجاد الحلول المناسبة", "رفع التقارير وتحديث المعلومات المطلوبة"];
}

export default function WorkforceEmployeeModal({ employee, onClose, canManage, canAuditEvaluate }: { employee: Employee; onClose: () => void; canManage: boolean; canAuditEvaluate: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [activeTab, setActiveTab] = useState<Tab>("summary");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DetailData>({ goals: [], evaluations: [], reports: [], requests: [], attendance: [], errors: {}, goalProgressAvailable: false, goalTasksAvailable: false });
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalUnit, setGoalUnit] = useState("");
  const [goalTaskTitles, setGoalTaskTitles] = useState([""]);
  const [actualValues, setActualValues] = useState<Record<string, string>>({});
  const [evaluationMonth, setEvaluationMonth] = useState(currentMonth);
  const [evaluationNotes, setEvaluationNotes] = useState("");
  const [evaluationScores, setEvaluationScores] = useState<Record<string, number>>({});
  const [evaluationEvidence, setEvaluationEvidence] = useState<Record<string, string>>({});
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const criteria = useMemo(() => criteriaFor(employee.job_title?.name ?? ""), [employee.job_title?.name]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [authResult, goalResult, evaluationResult, requestResult, reportResult, attendanceResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("employee_goals").select("id,period_month,title,description,target_value,actual_value,target_unit,goal_revision").is("deleted_at", null).eq("employee_id", employee.id).eq("period_month", `${currentMonth()}-01`).order("period_month", { ascending: false }),
        supabase.from("evaluations").select("id,period_month,evaluator_id,total_score,max_score,status,notes,evaluation_items(criterion,score,max_score,evidence)").eq("employee_id", employee.id).order("period_month", { ascending: false }).limit(12),
        supabase.from("hr_events").select("id,event_type,effective_date,end_date,status,reason,decision_reason").eq("employee_id", employee.id).in("event_type", ["leave", "late_permission", "permission", "mission"]).order("effective_date", { ascending: false }).limit(30),
        supabase.from("employee_reports").select("id,category,subject,message,status,hr_response,created_at").eq("employee_id", employee.id).order("created_at", { ascending: false }).limit(20),
        supabase.from("attendance_records").select("id,attendance_date,status,first_in,exception_note").eq("employee_id", employee.id).order("attendance_date", { ascending: false }).limit(30),
      ]);
      let goalRows = goalResult.data as Goal[] | null;
      let goalFailed = Boolean(goalResult.error);
      let goalProgressAvailable = !goalResult.error;
      if (goalResult.error && /actual_value|column/i.test(goalResult.error.message)) {
        const fallback = await supabase.from("employee_goals").select("id,period_month,title,description,target_value,target_unit,goal_revision").is("deleted_at", null).eq("employee_id", employee.id).eq("period_month", `${currentMonth()}-01`).order("period_month", { ascending: false });
        goalFailed = Boolean(fallback.error);
        goalProgressAvailable = false;
        goalRows = ((fallback.data ?? []) as Omit<Goal, "actual_value">[]).map((goal) => ({ ...goal, actual_value: null }));
      }
      const goalIds = (goalRows ?? []).map((goal) => goal.id);
      const goalTaskResult = goalIds.length
        ? await supabase.from("employee_goal_tasks").select("id,goal_id,title,sort_order,is_completed,due_date,employee_note,review_status").in("goal_id", goalIds).order("sort_order")
        : { data: [] as GoalTask[], error: null };
      const tasksByGoal = new Map<string, GoalTask[]>();
      for (const task of (goalTaskResult.data ?? []) as GoalTask[]) {
        const tasks = tasksByGoal.get(task.goal_id) ?? [];
        tasks.push(task);
        tasksByGoal.set(task.goal_id, tasks);
      }
      if (cancelled) return;
      setUserId(authResult.data.user?.id ?? "");
      setData({
        goals: (goalRows ?? []).map((goal) => ({ ...goal, tasks: tasksByGoal.get(goal.id) ?? [] })),
        evaluations: (evaluationResult.data ?? []) as Evaluation[],
        requests: (requestResult.data ?? []) as RequestEvent[],
        reports: (reportResult.data ?? []) as Report[],
        attendance: (attendanceResult.data ?? []) as Attendance[],
        errors: { goals: goalFailed, evaluations: Boolean(evaluationResult.error), requests: Boolean(requestResult.error), reports: Boolean(reportResult.error), attendance: Boolean(attendanceResult.error) },
        goalProgressAvailable,
        goalTasksAvailable: !goalTaskResult.error,
      });
      setActualValues(Object.fromEntries((goalRows ?? []).map((goal) => [goal.id, goal.actual_value === null ? "" : String(goal.actual_value)])));
      const ownEvaluation = ((evaluationResult.data ?? []) as Evaluation[]).find((evaluation) => evaluation.evaluator_id === authResult.data.user?.id && evaluation.period_month.slice(0, 7) === evaluationMonth);
      if (ownEvaluation) {
        setEvaluationNotes(ownEvaluation.notes ?? "");
        setEvaluationScores(Object.fromEntries((ownEvaluation.evaluation_items ?? []).map((item) => [item.criterion, item.score])));
        setEvaluationEvidence(Object.fromEntries((ownEvaluation.evaluation_items ?? []).map((item) => [item.criterion, item.evidence ?? ""])));
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [employee.id, supabase]);

  const lateCount = data.attendance.filter((row) => lateMinutesAfter915(row.first_in) !== null || row.status === "late").length;
  const pendingRequests = data.requests.filter((request) => request.status === "pending").length;
  const openReports = data.reports.filter((report) => report.status !== "resolved").length;
  const latestEvaluation = data.evaluations[0];
  const name = employeeName(employee);
  const thisMonth = currentMonth();
  const monthlyGoals = data.goals.filter((goal) => goal.period_month.slice(0, 7) === thisMonth).slice(0, 3);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Tripoli" });

  function sectionError(key: keyof DetailData["errors"], title: string) {
    if (loading) return <p className="workforce-modal-state">جارٍ تحميل {title}…</p>;
    if (data.errors[key]) return <p className="workforce-modal-state error">تعذر تحميل {title}. قد لا يملك حسابك صلاحية عرض هذا القسم.</p>;
    return null;
  }

  async function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goalTitle.trim() || !userId) return setMessage({ text: "تعذر تحديد حساب المستخدم أو بيانات الهدف.", error: true });
    const taskTitles = goalTaskTitles.map((task) => task.trim()).filter(Boolean);
    if (!taskTitles.length) return setMessage({ text: "أضف مهمة واحدة على الأقل للهدف.", error: true });
    setBusy(true); setMessage(null);
    const { data: created, error } = await supabase.from("employee_goals").insert({ employee_id: employee.id, period_month: `${thisMonth}-01`, title: goalTitle.trim(), description: goalDescription.trim() || null, target_value: goalTarget ? Number(goalTarget) : null, target_unit: goalUnit.trim() || null, created_by: userId }).select("id,period_month,title,description,target_value,actual_value,target_unit,goal_revision").single();
    if (error) { setBusy(false); return setMessage({ text: `تعذر إضافة الهدف: ${error.message}`, error: true }); }
    const dueDate = defaultTaskDueDate(thisMonth);
    const { data: createdTasks, error: taskError } = await supabase.from("employee_goal_tasks").insert(taskTitles.map((title, sort_order) => ({ goal_id: created.id, title, sort_order, due_date: dueDate, created_by: userId }))).select("id,goal_id,title,sort_order,is_completed,due_date,employee_note,review_status");
    setBusy(false);
    const savedGoal = { ...created, tasks: (createdTasks ?? []) as GoalTask[] } as Goal;
    setData((current) => ({ ...current, goals: [savedGoal, ...current.goals].sort((a, b) => b.period_month.localeCompare(a.period_month)) }));
    setActualValues((current) => ({ ...current, [created.id]: "" }));
    setGoalTitle(""); setGoalDescription(""); setGoalTarget(""); setGoalUnit(""); setGoalTaskTitles([""]); setShowGoalForm(false);
    if (taskError) return setMessage({ text: `تم إنشاء الهدف لكن تعذر حفظ مهامه: ${taskError.message}`, error: true });
    setMessage({ text: "تمت إضافة الهدف للموظف." });
  }

  async function saveGoalProgress(event: FormEvent<HTMLFormElement>, goal: Goal) {
    event.preventDefault();
    const raw = actualValues[goal.id] ?? "";
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return setMessage({ text: "أدخل قيمة إنجاز صحيحة غير سالبة.", error: true });
    setBusy(true); setMessage(null);
    const { data: updated, error } = await supabase.from("employee_goals").update({ actual_value: value }).eq("id", goal.id).is("deleted_at", null).select("id,goal_revision").maybeSingle();
    setBusy(false);
    if (error) return setMessage({ text: `تعذر حفظ تقييم الهدف: ${error.message}`, error: true });
    if (!updated) return setMessage({ text: "لم يُحفظ الإنجاز؛ ربما حُذف الهدف أو تغيرت صلاحيتك. حدّث البيانات.", error: true });
    setData((current) => ({ ...current, goals: current.goals.map((row) => row.id === goal.id ? { ...row, actual_value: value, goal_revision: updated.goal_revision } : row) }));
    setMessage({ text: "تم حفظ تقييم إنجاز الهدف." });
  }

  async function saveEmployeeEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) return setMessage({ text: "تعذر تحديد حساب المقيّم.", error: true });
    setBusy(true); setMessage(null);
    const items = criteria.map((criterion) => ({ criterion, score: evaluationScores[criterion] ?? 3, max_score: 4, evidence: evaluationEvidence[criterion] ?? "" }));
    const total = items.reduce((sum, item) => sum + item.score, 0);
    const { data: evaluationId, error } = await supabase.rpc("submit_employee_evaluation", { p_employee_id: employee.id, p_period_month: `${evaluationMonth}-01`, p_notes: evaluationNotes, p_items: items });
    setBusy(false);
    if (error) return setMessage({ text: `تعذر حفظ التقييم: ${error.message}`, error: true });
    const saved: Evaluation = { id: evaluationId, period_month: `${evaluationMonth}-01`, evaluator_id: userId, total_score: total, max_score: items.length * 4, status: "submitted", notes: evaluationNotes, evaluation_items: items.map((item) => ({ ...item, evidence: item.evidence || null })) };
    setData((current) => ({ ...current, evaluations: [saved, ...current.evaluations.filter((row) => row.id !== saved.id && !(row.evaluator_id === userId && row.period_month === saved.period_month))].sort((a, b) => b.period_month.localeCompare(a.period_month)) }));
    setMessage({ text: `تم حفظ تقييم الموظف لشهر ${month(saved.period_month)}.` });
  }

  async function decideRequest(request: RequestEvent, status: "approved" | "rejected") {
    const reason = decisionReasons[request.id]?.trim();
    if (!reason) return setMessage({ text: "اكتب رد الإدارة وسبب القرار أولًا.", error: true });
    setBusy(true); setMessage(null);
    let error: { message: string } | null = null;
    if (request.event_type === "leave") {
      const result = await supabase.rpc("decide_hr_event_approval", { p_event_id: request.id, p_status: status, p_reason: reason, p_discount_type: "none", p_discount_value: null });
      error = result.error;
    } else {
      const result = await supabase.from("hr_events").update({ status, decision_reason: reason }).eq("id", request.id).eq("status", "pending").select("id").maybeSingle();
      error = result.error;
      if (!result.data && !error) {
        setBusy(false);
        return setMessage({ text: "الطلب لم يعد قيد المراجعة. حدّث بيانات الموظف.", error: true });
      }
    }
    setBusy(false);
    if (error) return setMessage({ text: `تعذر حفظ الرد: ${error.message}`, error: true });
    setData((current) => ({ ...current, requests: current.requests.map((row) => row.id === request.id ? { ...row, status, decision_reason: reason } : row) }));
    setMessage({ text: status === "approved" ? "تم اعتماد الطلب وإرسال رد الإدارة." : "تم رفض الطلب وحفظ رد الإدارة." });
  }

  return <div className="workforce-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="workforce-employee-modal" role="dialog" aria-modal="true" aria-labelledby="workforce-modal-title" dir="rtl">
      <header className="workforce-modal-header">
        <span className="workforce-modal-avatar" aria-hidden="true">{name.charAt(0) || "م"}</span>
        <div className="workforce-modal-identity"><span className="workforce-modal-eyebrow">الملف المختصر</span><h2 id="workforce-modal-title">{name}</h2><p>{employee.job_title?.name || "بدون صفة"} · {employee.branch?.name || "فرع غير محدد"}</p></div>
        <button type="button" className="workforce-modal-close" onClick={onClose} aria-label="إغلاق نافذة الموظف" autoFocus>×</button>
      </header>
      <div className="workforce-modal-profile"><span>الكود <b>{toWesternDigits(employee.employee_number)}</b></span><span>القسم <b>{employee.department?.name || "—"}</b></span><span>الحالة <b>{employee.status === "active" ? "نشط" : employee.status}</b></span>{employee.hired_on && <span>تاريخ التعيين <b>{date(employee.hired_on)}</b></span>}</div>
      <nav className="workforce-modal-tabs" aria-label="أقسام ملف الموظف">{tabs.map((tab) => { const count = tab.id === "goals" ? (data.errors.goals ? null : data.goals.length) : tab.id === "requests" ? (data.errors.requests ? null : pendingRequests) : tab.id === "reports" ? (data.errors.reports ? null : openReports) : null; return <button type="button" key={tab.id} className={activeTab === tab.id ? "active" : ""} aria-pressed={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>{tab.label}{count !== null && count !== 0 && <span className="workforce-modal-tab-count">{number(count)}</span>}</button>; })}</nav>
      {message && <p className={`workforce-modal-message${message.error ? " error" : ""}`} role="status">{message.text}</p>}
      <div className="workforce-modal-content">
        {activeTab === "summary" && <>
          <div className="workforce-modal-stats">
            <article><span>أهداف الشهر</span><strong>{loading ? "—" : data.errors.goals ? "—" : number(data.goals.length)}</strong></article>
            <article><span>آخر تقييم</span><strong>{loading ? "—" : latestEvaluation && latestEvaluation.max_score ? `${number((Number(latestEvaluation.total_score ?? 0) / Number(latestEvaluation.max_score)) * 100)}٪` : "—"}</strong></article>
            <article><span>تأخيرات آخر ٣٠ سجلًا</span><strong>{loading || data.errors.attendance ? "—" : number(lateCount)}</strong></article>
            <article><span>طلبات معلقة</span><strong>{loading || data.errors.requests ? "—" : number(pendingRequests)}</strong></article>
          </div>
          <div className="workforce-modal-summary-grid"><section><h3>آخر الحضور</h3>{sectionError("attendance", "سجل الحضور")}{!loading && !data.errors.attendance && (data.attendance.length ? <ul>{data.attendance.slice(0, 5).map((row) => <li key={row.id}><span>{date(row.attendance_date)}</span><b className={`workforce-data-tag ${lateMinutesAfter915(row.first_in) !== null || row.status === "late" ? "warning" : ""}`}>{lateMinutesAfter915(row.first_in) !== null || row.status === "late" ? "تأخير" : row.status === "present" ? "حضور" : row.status}</b></li>)}</ul> : <p className="workforce-modal-state">لا توجد سجلات حضور.</p>)}</section>
            <section><h3>آخر تقييم</h3>{sectionError("evaluations", "التقييمات")}{!loading && !data.errors.evaluations && (latestEvaluation ? <div className="workforce-modal-latest"><strong>{latestEvaluation.max_score ? `${number(latestEvaluation.total_score ?? 0)} / ${number(latestEvaluation.max_score)}` : "لم تُسجل نتيجة"}</strong><span>{month(latestEvaluation.period_month)} · {latestEvaluation.status === "submitted" || latestEvaluation.status === "approved" ? "مرسل" : "مسودة"}</span></div> : <p className="workforce-modal-state">لا يوجد تقييم مسجل.</p>)}</section>
            <section className="workforce-modal-goal-overview"><header><div><h3>أهداف الشهر</h3><p>النتيجة الفعلية والمهام تُتابع كلٌ على حدة.</p></div><button type="button" onClick={() => setActiveTab("goals")}>عرض الكل</button></header>{sectionError("goals", "الأهداف")}{!loading && !data.errors.goals && !data.goalTasksAvailable && <p className="workforce-modal-state">تعذر تحميل مهام الأهداف.</p>}{!loading && !data.errors.goals && data.goalTasksAvailable && (monthlyGoals.length ? <div className="workforce-modal-goal-overview-list">{monthlyGoals.map((goal) => { const tasks = goal.tasks ?? []; const done = tasks.filter((task) => task.is_completed).length; const taskPercent = tasks.length ? Math.round(done / tasks.length * 100) : 0; const outcomePercent = goal.target_value && goal.target_value > 0 && goal.actual_value !== null ? Math.round(Number(goal.actual_value) / Number(goal.target_value) * 100) : null; const nextTask = tasks.filter((task) => !task.is_completed).sort((a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31"))[0]; const overdue = nextTask?.due_date ? nextTask.due_date < today : false; return <article key={goal.id}><div className="workforce-modal-goal-overview-heading"><strong>{goal.title}</strong><span>{outcomePercent === null ? "النتيجة لم تُسجل" : `تحقق الهدف ${number(outcomePercent)}٪`}</span></div><div className="workforce-modal-goal-overview-task"><span>تنفيذ المهام</span><b>{number(done)} / {number(tasks.length)}</b><div className="workforce-modal-progress"><span style={{ width: `${taskPercent}%` }}/></div></div>{nextTask && <small className={overdue ? "overdue" : ""}>{overdue ? "متأخرة" : "القادمة"}: {nextTask.title}{nextTask.due_date ? ` · ${date(nextTask.due_date)}` : ""}</small>}</article>; })}</div> : <p className="workforce-modal-state">لا توجد أهداف مسجلة لهذا الشهر.</p>)}</section></div>
        </>}
        {activeTab === "goals" && <section className="workforce-modal-section"><div className="workforce-modal-section-heading"><div><h3>أهداف {month(`${thisMonth}-01`)}</h3><small className="workforce-goal-section-note">النتيجة تقيس تحقق الهدف، والمهام تقيس خطوات التنفيذ.</small></div>{canManage && <button type="button" className="workforce-modal-action" onClick={() => setShowGoalForm((current) => !current)}>{showGoalForm ? "إغلاق النموذج" : "+ إضافة هدف"}</button>}</div>{sectionError("goals", "الأهداف")}{showGoalForm && canManage && <form className="workforce-goal-form" onSubmit={addGoal}><label>اسم الهدف<input required value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder="مثال: مطابقة الحسابات المصرفية" /></label><div className="workforce-goal-current-month">شهر الهدف<strong>{month(`${thisMonth}-01`)}</strong></div><label>القيمة المستهدفة<input type="number" min="0" step="0.01" value={goalTarget} onChange={(event) => setGoalTarget(event.target.value)} placeholder="اختياري" /></label><label>وحدة القياس<input value={goalUnit} onChange={(event) => setGoalUnit(event.target.value)} placeholder="د.ل، زيارة، حساب مطابق..." /></label><label className="wide">تفاصيل الهدف<textarea rows={2} value={goalDescription} onChange={(event) => setGoalDescription(event.target.value)} /></label><fieldset className="workforce-goal-task-drafts"><legend>مهام الهدف</legend>{goalTaskTitles.map((task, index) => <div key={index}><input aria-label={`المهمة ${index + 1}`} required={index === 0} value={task} onChange={(event) => setGoalTaskTitles((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="اكتب خطوة قابلة للتنفيذ"/><small>موعد التسليم الافتراضي: {date(defaultTaskDueDate(thisMonth))}</small>{goalTaskTitles.length > 1 && <button type="button" aria-label={`حذف المهمة ${index + 1}`} onClick={() => setGoalTaskTitles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</div>)}<button type="button" className="workforce-modal-action" onClick={() => setGoalTaskTitles((current) => [...current, ""])}>＋ إضافة مهمة</button></fieldset><button type="submit" className="workforce-modal-primary" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ الهدف ومهامه"}</button></form>}{!loading && !data.errors.goals && (data.goals.length ? <div className="workforce-modal-record-list">{data.goals.map((goal) => {
          const outcomePercent = goal.target_value && goal.target_value > 0 && goal.actual_value !== null ? Math.round((Number(goal.actual_value) / Number(goal.target_value)) * 100) : null;
          const goalTasks = goal.tasks ?? [];
          const completedTasks = goalTasks.filter((task) => task.is_completed).length;
          const taskPercent = goalTasks.length ? Math.round((completedTasks / goalTasks.length) * 100) : null;
          return <article key={goal.id} className="workforce-goal-card"><div className="workforce-goal-card-heading"><div><strong>{goal.title}</strong><span>{month(goal.period_month)} · المستهدف: {goal.target_value === null ? "غير محدد" : `${number(Number(goal.target_value))} ${goal.target_unit || ""}`}</span></div><b className={`workforce-data-tag ${outcomePercent !== null ? "approved" : "pending"}`}>{outcomePercent !== null ? `النتيجة ${number(outcomePercent)}٪` : "لم تسجل النتيجة"}</b></div>
            {goal.target_value && <div className="workforce-goal-progress-row"><span>تحقق النتيجة</span><strong>{goal.actual_value === null ? "بانتظار النتيجة الفعلية" : `${number(Number(goal.actual_value))} / ${number(Number(goal.target_value))} ${goal.target_unit || ""}`}</strong><div className="workforce-modal-progress"><span style={{ width: `${Math.min(100, outcomePercent ?? 0)}%` }} /></div></div>}
            {goalTasks.length > 0 && <div className="workforce-goal-progress-row task-progress"><span>تنفيذ المهام</span><strong>{number(completedTasks)} من {number(goalTasks.length)} · {number(taskPercent ?? 0)}٪</strong><div className="workforce-modal-progress"><span style={{ width: `${taskPercent ?? 0}%` }} /></div></div>}
            {goal.description && <p>{goal.description}</p>}
            {goalTasks.length > 0 && <details className="workforce-goal-task-details"><summary>عرض المهام ومواعيدها</summary><ul>{goalTasks.map((task) => <li key={task.id} className={task.is_completed ? "complete" : ""}><span className="workforce-goal-task-state" aria-hidden="true">{task.is_completed ? "✓" : "•"}</span><div><strong>{task.title}</strong>{task.due_date && <small>موعد التسليم: {date(task.due_date)}</small>}{task.employee_note && <p>ملاحظة الإنجاز: {task.employee_note}</p>}</div><small className={`workforce-goal-task-review ${task.review_status}`}>{task.review_status === "approved" ? "معتمدة" : task.review_status === "changes_requested" ? "تحتاج توضيح" : task.is_completed ? "منجزة" : "قيد التنفيذ"}</small></li>)}</ul></details>}
            {data.goalTasksAvailable && goalTasks.length === 0 && <small className="workforce-modal-db-note">لم تُضف مهام لهذا الهدف بعد.</small>}
            {!data.goalTasksAvailable && <small className="workforce-modal-db-note">تعذر تحميل مهام الهدف.</small>}
            {canManage && <GoalActions goal={goal} onChanged={(updated) => { setData(current=>({...current, goals: updated ? current.goals.map(row=>row.id===goal.id ? {...row,...updated} : row).sort((a,b)=>b.period_month.localeCompare(a.period_month)) : current.goals.filter(row=>row.id!==goal.id)})); setMessage({text:updated ? "تم تعديل الهدف مع الحفاظ على الإنجاز المسجل." : "تم حذف الهدف من القوائم وحفظه في سجل التدقيق."}); }} />}{canManage && data.goalProgressAvailable && <form className="workforce-goal-result-form" onSubmit={(event) => saveGoalProgress(event, goal)}><label>النتيجة الفعلية<input type="number" min="0" step="0.01" value={actualValues[goal.id] ?? ""} onChange={(event) => setActualValues((current) => ({ ...current, [goal.id]: event.target.value }))} placeholder="أدخل القيمة المحققة" /></label><span>{goal.target_unit || "قيمة الإنجاز"}</span><button type="submit" className="workforce-modal-action" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ النتيجة"}</button></form>}{canManage && !data.goalProgressAvailable && <small className="workforce-modal-db-note">فعّل تحديثات تقدم الأهداف في قاعدة البيانات لتسجيل الإنجاز.</small>}</article>;
        })}</div> : <p className="workforce-modal-state">لا توجد أهداف مسجلة.</p>)}</section>}
        {activeTab === "evaluations" && <section className="workforce-modal-section"><div className="workforce-modal-section-heading"><h3>التقييمات</h3></div>{sectionError("evaluations", "التقييمات")}{!loading && !data.errors.evaluations && <>
          {(canManage || canAuditEvaluate) && <form className="workforce-evaluation-form" onSubmit={saveEmployeeEvaluation}><div className="workforce-evaluation-form-heading"><div><strong>تقييم الموظف</strong><span>قيّم كل معيار من ١ إلى ٤</span></div><label>الشهر<input type="month" required value={evaluationMonth} onChange={(event) => setEvaluationMonth(event.target.value)} /></label></div><div className="workforce-evaluation-criteria">{criteria.map((criterion, index) => <label key={criterion}><span>{number(index + 1)}. {criterion}</span><select value={evaluationScores[criterion] ?? 3} onChange={(event) => setEvaluationScores((current) => ({ ...current, [criterion]: Number(event.target.value) }))}><option value={4}>٤ · ممتاز</option><option value={3}>٣ · جيد</option><option value={2}>٢ · متوسط</option><option value={1}>١ · ضعيف</option></select><input aria-label={`شاهد أو ملاحظة ${criterion}`} value={evaluationEvidence[criterion] ?? ""} onChange={(event) => setEvaluationEvidence((current) => ({ ...current, [criterion]: event.target.value }))} placeholder="شاهد اختياري" /></label>)}</div><label className="workforce-evaluation-notes">ملاحظات عامة<textarea rows={2} value={evaluationNotes} onChange={(event) => setEvaluationNotes(event.target.value)} placeholder="ملاحظات تدعم التقييم" /></label><button type="submit" className="workforce-modal-primary" disabled={busy}>{busy ? "جارٍ حفظ التقييم…" : "حفظ تقييم الموظف"}</button></form>}
          {data.evaluations.length ? <div className="workforce-modal-record-list workforce-evaluation-history">{data.evaluations.map((evaluation) => <article key={evaluation.id}><div><strong>{month(evaluation.period_month)}</strong><span>{evaluation.status === "submitted" || evaluation.status === "approved" ? "تقييم مرسل" : "مسودة"}</span></div><b>{evaluation.total_score === null ? "بانتظار التقييم" : `${number(evaluation.total_score)} / ${number(evaluation.max_score)} · ${number((Number(evaluation.total_score) / Number(evaluation.max_score || 1)) * 100)}٪`}</b>{evaluation.notes && <p>{evaluation.notes}</p>}</article>)}</div> : <p className="workforce-modal-state">لا توجد تقييمات مسجلة.</p>}
        </>}</section>}
        {activeTab === "requests" && <section className="workforce-modal-section"><div className="workforce-modal-section-heading"><h3>طلبات الإجازة والاستئذان</h3></div>{sectionError("requests", "الطلبات")}{!loading && !data.errors.requests && (data.requests.length ? <div className="workforce-modal-record-list">{data.requests.map((request) => <article key={request.id}><div><strong>{requestLabels[request.event_type] ?? request.event_type}</strong><span>{date(request.effective_date)}{request.end_date ? ` — ${date(request.end_date)}` : ""}</span></div><b className={`workforce-data-tag ${eventStatusClass[request.status] || ""}`}>{requestStatus[request.status] ?? request.status}</b>{request.reason && <p>{request.reason}</p>}{request.decision_reason && <small>رد الإدارة: {request.decision_reason}</small>}{request.status === "pending" && canManage && <form className="workforce-request-reply" onSubmit={(event) => { event.preventDefault(); void decideRequest(request, "approved"); }}><label>رد الإدارة وسبب القرار<textarea required rows={2} value={decisionReasons[request.id] ?? ""} onChange={(event) => setDecisionReasons((current) => ({ ...current, [request.id]: event.target.value }))} /></label><div><button type="submit" className="workforce-modal-primary" disabled={busy}>اعتماد الطلب والرد</button><button type="button" className="workforce-modal-danger" disabled={busy} onClick={() => void decideRequest(request, "rejected")}>رفض الطلب</button></div><small>اعتماد الإجازة من هنا بدون خصم إضافي على الراتب.</small></form>}</article>)}</div> : <p className="workforce-modal-state">لا توجد طلبات إجازة أو استئذان.</p>)}</section>}
        {activeTab === "reports" && <section className="workforce-modal-section"><h3>بلاغات الموظف</h3>{sectionError("reports", "البلاغات")}{!loading && !data.errors.reports && (data.reports.length ? <div className="workforce-modal-record-list">{data.reports.map((report) => <article key={report.id}><div><strong>{report.subject}</strong><span>{reportCategory[report.category] ?? report.category} · {date(report.created_at)}</span></div><b className={`workforce-data-tag ${report.status === "resolved" ? "approved" : report.status === "pending" ? "pending" : ""}`}>{reportStatus[report.status] ?? report.status}</b><p>{report.message}</p>{report.hr_response && <small>رد الموارد البشرية: {report.hr_response}</small>}</article>)}</div> : <p className="workforce-modal-state">لا توجد بلاغات.</p>)}</section>}
      </div>
    </section>
  </div>;
}
