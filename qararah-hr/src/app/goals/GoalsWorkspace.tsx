"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";

type EmployeeOption = { id: string; full_name: string; employee_number: string; branch_name: string };
type Goal = { id: string; employee_id: string; period_month: string; title: string; description: string | null; target_value: number | null; target_unit: string | null; employee?: { full_name: string | null; first_name: string; last_name: string | null; employee_number: string } | null };
const monthNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit" }).format(new Date());

export default function GoalsWorkspace({ role, employeeId, userId, employees, goals }: { role: "admin" | "hr" | "employee" | "branch_manager" | "accountant" | "auditor"; employeeId: string | null; userId: string; employees: EmployeeOption[]; goals: Goal[] }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(monthNow);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isHR = role === "admin" || role === "hr";
  const selectedMonthGoals = goals.filter((goal) => goal.period_month.slice(0, 7) === month && (isHR ? !selectedEmployee || goal.employee_id === selectedEmployee : goal.employee_id === employeeId));

  async function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const { error } = await supabase.from("employee_goals").insert({ employee_id: selectedEmployee, period_month: `${month}-01`, title: title.trim(), description: description.trim() || null, target_value: target ? Number(target) : null, target_unit: unit.trim() || null, created_by: userId });
    setBusy(false);
    if (error) { setMessage(`تعذر حفظ الهدف: ${error.message}`); return; }
    setTitle(""); setDescription(""); setTarget(""); setUnit(""); setMessage("تمت إضافة الهدف للموظف."); router.refresh();
  }

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
    <section className="panel app-list-card"><div className="app-section-heading app-list-heading"><div><h2>{isHR ? "أهداف الموظفين" : "أهدافي الشهرية"}</h2><p>أهداف شهر {toWesternDigits(month)}</p></div><label className="app-month-picker"><span className="sr-only">اختر الشهر</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label></div>
      {selectedMonthGoals.length ? <div className="app-card-list">{selectedMonthGoals.map((goal) => <article className="app-item-card" key={goal.id}><div><strong>{goal.title}</strong>{isHR && <small>{goal.employee?.full_name || [goal.employee?.first_name, goal.employee?.last_name].filter(Boolean).join(" ") || goal.employee?.employee_number}</small>}{goal.target_value !== null && <small>المطلوب: {toWesternDigits(goal.target_value)} {goal.target_unit || ""}</small>}</div>{goal.description && <p>{goal.description}</p>}</article>)}</div> : <p className="app-empty-state">{isHR ? "لا توجد أهداف لهذا الشهر والموظف المحدد." : "لم تُسجّل لك أهداف لهذا الشهر حتى الآن."}</p>}
    </section>
  </div>;
}
