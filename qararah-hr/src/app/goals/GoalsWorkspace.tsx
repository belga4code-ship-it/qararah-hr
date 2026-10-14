"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";

type EmployeeOption = { id: string; full_name: string; employee_number: string; branch_name: string };
export type Goal = { id: string; employee_id: string; period_month: string; title: string; description: string | null; target_value: number | null; actual_value: number | null; target_unit: string | null; employee?: { full_name: string | null; first_name: string; last_name: string | null; employee_number: string } | null };
const monthNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit" }).format(new Date());

export default function GoalsWorkspace({ role, employeeId, userId, employees, goals, progressAvailable }: { role: "admin" | "hr" | "employee" | "branch_manager" | "accountant" | "auditor"; employeeId: string | null; userId: string; employees: EmployeeOption[]; goals: Goal[]; progressAvailable: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(monthNow);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [actualValues, setActualValues] = useState<Record<string, string>>(() => Object.fromEntries(goals.map((goal) => [goal.id, goal.actual_value === null ? "" : String(goal.actual_value)])));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isHR = role === "admin" || role === "hr";
  const selectedMonthGoals = goals.filter((goal) => goal.period_month.slice(0, 7) === month && (isHR ? !selectedEmployee || goal.employee_id === selectedEmployee : goal.employee_id === employeeId));
  const trackedGoals = selectedMonthGoals.filter((goal) => goal.target_value !== null && goal.target_value > 0 && goal.actual_value !== null);
  const averageProgress = trackedGoals.length ? Math.round(trackedGoals.reduce((sum, goal) => sum + (goal.actual_value! / goal.target_value!) * 100, 0) / trackedGoals.length) : null;
  const completedGoals = trackedGoals.filter((goal) => goal.actual_value! >= goal.target_value!).length;

  async function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const { error } = await supabase.from("employee_goals").insert({ employee_id: selectedEmployee, period_month: `${month}-01`, title: title.trim(), description: description.trim() || null, target_value: target ? Number(target) : null, target_unit: unit.trim() || null, created_by: userId });
    setBusy(false);
    if (error) { setMessage(`تعذر حفظ الهدف: ${error.message}`); return; }
    setTitle(""); setDescription(""); setTarget(""); setUnit(""); setMessage("تمت إضافة الهدف للموظف."); router.refresh();
  }

  async function saveActual(event: FormEvent<HTMLFormElement>, goalId: string) {
    event.preventDefault(); setBusy(true); setMessage("");
    const value = actualValues[goalId];
    const { error } = await supabase.from("employee_goals").update({ actual_value: value === "" ? null : Number(value) }).eq("id", goalId);
    setBusy(false);
    if (error) { setMessage(`تعذر حفظ الإنجاز: ${error.message}`); return; }
    setMessage("تم تحديث الإنجاز الفعلي."); router.refresh();
  }

  const formatValue = (value: number) => toWesternDigits(new Intl.NumberFormat("ar-LY", { maximumFractionDigits: 2 }).format(value));

  return <div className="employee-app-content">
    {isHR && <section className="panel app-form-card"><div className="app-section-heading"><h2>إضافة هدف شهري لموظف</h2><p>الأهداف مخصصة لكل موظف ويمكن تحديدها حسب دوره.</p></div><form className="app-simple-form" onSubmit={addGoal}>
      <label>الموظف<select required value={selectedEmployee} onChange={(event) => setSelectedEmployee(event.target.value)}><option value="">اختر الموظف</option>{employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.full_name} · {employee.branch_name}</option>)}</select></label>
      <label>الشهر<input type="month" required value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      <label>الهدف<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: متابعة الزبائن" /></label>
      <label>القيمة المستهدفة (اختياري)<input type="number" min="0" step="0.01" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="مثال: 20" /></label>
      {target && <label>وحدة القياس<input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="زيارة، فاتورة، د.ل..." /></label>}
      <label className="wide">تفاصيل الهدف<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="وضح المطلوب من الموظف" /></label>
      <button className="primary-button" type="submit" disabled={busy || !selectedEmployee}>{busy ? "جارٍ الحفظ…" : "إضافة الهدف"}</button>
    </form>{message && <p className="app-inline-message" role="status">{message}</p>}</section>}
    <section className="panel app-list-card goal-list-panel"><div className="app-section-heading app-list-heading"><div><h2>{isHR ? "أهداف الموظفين" : "أهدافي الشهرية"}</h2><p>{isHR ? "قيّم الإنجاز الفعلي لكل هدف." : "تابع نسبة إنجازك؛ الإدارة تسجل التقييم."} · {toWesternDigits(month)}</p></div><label className="app-month-picker"><span className="sr-only">اختر الشهر</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label></div>
      {selectedMonthGoals.length ? <>
        <div className="goal-summary-grid"><article><span>أهداف الشهر</span><strong>{toWesternDigits(selectedMonthGoals.length)}</strong></article><article><span>مكتملة</span><strong>{toWesternDigits(completedGoals)}</strong></article><article><span>متوسط الإنجاز المسجل</span><strong>{averageProgress === null ? "—" : `${toWesternDigits(averageProgress)}٪`}</strong></article></div>
        <div className="app-card-list goal-card-list">{selectedMonthGoals.map((goal) => {
          const rawProgress = goal.target_value && goal.target_value > 0 && goal.actual_value !== null ? Math.round((goal.actual_value / goal.target_value) * 100) : null;
          const progress = rawProgress === null ? null : Math.min(100, rawProgress);
          const progressTone = rawProgress !== null && rawProgress >= 100 ? "complete" : rawProgress !== null && rawProgress >= 60 ? "moving" : "early";
          const employeeName = goal.employee?.full_name || [goal.employee?.first_name, goal.employee?.last_name].filter(Boolean).join(" ") || goal.employee?.employee_number;
          return <article className="app-item-card goal-card" key={goal.id}>
            <div className="goal-card-heading"><div><strong>{goal.title}</strong>{isHR && <small>{employeeName}</small>}</div>{rawProgress !== null ? <span className={`goal-progress-badge ${progressTone}`}>{toWesternDigits(rawProgress)}٪</span> : <span className="goal-progress-badge waiting">بانتظار تقييم الإدارة</span>}</div>
            <div className="goal-target-line"><span>الهدف</span><strong>{goal.target_value === null ? "غير محدد" : `${formatValue(goal.target_value)} ${goal.target_unit || ""}`}</strong>{goal.actual_value !== null && <><span>الإنجاز</span><strong>{formatValue(goal.actual_value)} {goal.target_unit || ""}</strong></>}</div>
            <div className={`goal-progress-track ${rawProgress === null ? "empty" : progressTone}`} role="progressbar" aria-label={`نسبة إنجاز ${goal.title}`} aria-valuenow={progress ?? 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress ?? 0}%` }} /></div>
            {goal.description && <p className="goal-description">{goal.description}</p>}
            {progressAvailable && isHR && <form className="goal-actual-form" onSubmit={(event) => saveActual(event, goal.id)}><label>تقييم الإنجاز من الإدارة<span><input type="number" min="0" step="0.01" value={actualValues[goal.id] ?? ""} onChange={(event) => setActualValues((values) => ({ ...values, [goal.id]: event.target.value }))} placeholder="أدخل القيمة المحققة" /><em>{goal.target_unit || "قيمة الإنجاز"}</em></span></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ التقييم"}</button></form>}
          </article>;
        })}</div>
      </> : <p className="app-empty-state">{isHR ? "لا توجد أهداف لهذا الشهر والموظف المحدد." : "لم تُسجّل لك أهداف لهذا الشهر حتى الآن."}</p>}
      {message && <p className="app-inline-message" role="status">{message}</p>}
      {!progressAvailable && <p className="goal-migration-note" role="status">ستظهر نسبة الإنجاز بعد تفعيل تحديثات الأهداف في قاعدة البيانات.</p>}
    </section>
  </div>;
}
