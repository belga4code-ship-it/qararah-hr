"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";

type Role = "admin" | "hr" | "branch_manager" | "employee";
type EventType = "new_hire" | "leave" | "termination" | "deduction" | "mission" | "late_permission" | "permission";
export type EffectEmployee = {
  id: string; employee_number: string; first_name: string; last_name: string | null; full_name: string | null;
  status: string; branch_id: string; salary_amount?: number | null; job_title: { name: string } | null; branch: { name: string } | null;
};
export type HREvent = {
  id: string; employee_id: string; event_type: EventType; effective_date: string; end_date: string | null; reason: string | null;
  amount: number | null; amount_unit: string | null; status: "pending" | "approved" | "rejected";
  decision_reason: string | null; decision_at: string | null; payroll_recorded_at: string | null;
  details: Record<string, unknown> | null; created_at: string;
  employee: { employee_number: string; first_name: string; last_name: string | null; full_name: string | null; branch: { name: string } | null } | null;
};

const eventLabels: Record<EventType, string> = {
  new_hire: "تعيين جديد", leave: "إجازة", termination: "إنهاء خدمة", deduction: "خصم من الراتب",
  mission: "مأمورية", late_permission: "إذن تأخير", permission: "إذن خروج / استئذان",
};
const statusLabels = { pending: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض" } as const;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const employeeName = (employee: Pick<EffectEmployee, "full_name" | "first_name" | "last_name">) => employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ");

export default function EffectsWorkspace({ role, userId, employeeId, branchId, employees, jobTitles, events }: {
  role: Role; userId: string; employeeId: string | null; branchId: string | null;
  employees: EffectEmployee[]; jobTitles: { id: string; name: string }[]; events: HREvent[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [requestType, setRequestType] = useState<EventType>("leave");
  const [requestStart, setRequestStart] = useState(today);
  const [requestEnd, setRequestEnd] = useState("");
  const [requestTime, setRequestTime] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [hireNumber, setHireNumber] = useState("");
  const [hireName, setHireName] = useState("");
  const [hireTitle, setHireTitle] = useState("");
  const [hireDate, setHireDate] = useState(today);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [branchActionType, setBranchActionType] = useState<"deduction" | "termination">("deduction");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [actionReason, setActionReason] = useState("");
  const [deductionAmount, setDeductionAmount] = useState("");
  const [directEmployee, setDirectEmployee] = useState("");
  const [directAmount, setDirectAmount] = useState("");
  const [directReason, setDirectReason] = useState("");
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [leaveDiscountTypes, setLeaveDiscountTypes] = useState<Record<string, "none" | "fixed" | "days" | "half_day" | "quarter_day">>({});
  const [leaveDiscountValues, setLeaveDiscountValues] = useState<Record<string, string>>({});

  const isHeadOffice = role === "admin" || role === "hr";
  const isBranchManager = role === "branch_manager";
  const isEmployee = role === "employee";
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const pendingCount = events.filter((event) => event.status === "pending").length;

  async function finish(text: string) {
    setMessage({ text });
    setBusy(false);
    router.refresh();
  }
  function fail(text: string) {
    setMessage({ text, error: true });
    setBusy(false);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    if (!employeeId || !branchId) return fail("حسابك غير مربوط بملف موظف أو فرع. تواصل مع الموارد البشرية لربط الحساب.");
    if (!requestReason.trim()) return fail("اكتب سبب الطلب قبل الإرسال.");
    if (requestType === "leave" && requestEnd && requestEnd < requestStart) return fail("تاريخ نهاية الإجازة لازم يكون بعد بدايتها.");
    setBusy(true);
    const { error } = await supabase.from("hr_events").insert({
      employee_id: employeeId, branch_id: branchId, event_type: requestType,
      effective_date: requestStart, end_date: requestType === "leave" && requestEnd ? requestEnd : null,
      reason: requestReason.trim(), details: requestTime ? { requested_time: requestTime } : {},
      created_by: userId, status: "pending",
    });
    if (error) return fail(error.message.includes("row-level security") ? "ما قدرتش نرسل الطلب. تأكد من ربط حسابك بملف الموظف في Supabase." : `تعذر إرسال الطلب: ${error.message}`);
    setRequestReason(""); setRequestEnd(""); setRequestTime("");
    await finish("تم إرسال الطلب للإدارة الرئيسية للمراجعة.");
  }

  async function addHire(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    if (!hireNumber.trim() || !hireName.trim()) return fail("اكتب الكود الوظيفي واسم الموظف.");
    setBusy(true);
    const { error } = await supabase.rpc("manager_create_employee", {
      p_employee_number: hireNumber.trim(), p_full_name: hireName.trim(),
      p_job_title_id: hireTitle || null, p_hired_on: hireDate || null,
    });
    if (error) return fail(`تعذر تسجيل الموظف: ${error.message}`);
    setHireNumber(""); setHireName(""); setHireTitle("");
    await finish("تم تسجيل الموظف الجديد في فرعك.");
  }

  async function submitBranchAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    if (!selectedEmployee || !actionReason.trim()) return fail("اختر الموظف واكتب السبب.");
    if (branchActionType === "deduction" && (!Number.isFinite(Number(deductionAmount)) || Number(deductionAmount) <= 0)) return fail("قيمة الخصم لازم تكون أكبر من صفر.");
    setBusy(true);
    if (branchActionType === "deduction") {
      const { error } = await supabase.from("hr_events").insert({
        employee_id: selectedEmployee, branch_id: branchId, event_type: "deduction",
        effective_date: effectiveDate, reason: actionReason.trim(), amount: Number(deductionAmount), amount_unit: "LYD",
        created_by: userId, status: "pending",
      });
      if (error) return fail(`تعذر رفع طلب الخصم: ${error.message}`);
      setDeductionAmount(""); setActionReason("");
      return finish("تم رفع الخصم للإدارة الرئيسية لاعتماده وتسجيله ضمن خصومات الراتب.");
    }
    const { error } = await supabase.rpc("manager_terminate_employee", {
      p_employee_id: selectedEmployee, p_effective_date: effectiveDate, p_reason: actionReason.trim(),
    });
    if (error) return fail(`تعذر تسجيل إنهاء الخدمة: ${error.message}`);
    setSelectedEmployee(""); setActionReason("");
    await finish("تم تسجيل إنهاء الخدمة والسبب في سجل الموظف.");
  }

  async function recordDirectDeduction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const amount = Number(directAmount);
    if (!directEmployee || !directReason.trim() || !Number.isFinite(amount) || amount <= 0) return fail("حدد الموظف، واكتب سببًا، وأدخل مبلغ خصم صحيحًا.");
    setBusy(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from("hr_events").insert({
      employee_id: directEmployee, branch_id: employees.find((employee) => employee.id === directEmployee)?.branch_id,
      event_type: "deduction", effective_date: effectiveDate, reason: directReason.trim(), decision_reason: directReason.trim(),
      amount, amount_unit: "LYD", created_by: userId, approved_by: userId, approved_at: now,
      decision_by: userId, decision_at: now, payroll_recorded_by: userId, payroll_recorded_at: now, status: "approved",
    });
    if (error) return fail(`تعذر تسجيل الخصم: ${error.message}`);
    setDirectEmployee(""); setDirectAmount(""); setDirectReason("");
    await finish("تم اعتماد الخصم وتسجيله ضمن خصومات الراتب مع السبب.");
  }

  async function decide(item: HREvent, status: "approved" | "rejected") {
    setMessage(null);
    const reason = decisionReasons[item.id]?.trim();
    if (!reason) return fail("اكتب سبب الاعتماد أو الرفض قبل حفظ القرار.");
    let discountAmount: number | null = null;
    let discountType: "none" | "fixed" | "days" | "half_day" | "quarter_day" = "none";
    let discountDays = 0;
    if (status === "approved" && item.event_type === "leave") {
      discountType = leaveDiscountTypes[item.id] ?? "none";
      const employee = employees.find((row) => row.id === item.employee_id);
      const monthlySalary = Number(employee?.salary_amount);
      if (discountType !== "none") {
        if (!Number.isFinite(monthlySalary) || monthlySalary <= 0) return fail("راتب الموظف غير مسجل، حدّث بيانات الراتب قبل احتساب خصم الإجازة.");
        if (discountType === "fixed") {
          discountAmount = Number(leaveDiscountValues[item.id]);
          if (!Number.isFinite(discountAmount) || discountAmount <= 0) return fail("أدخل مبلغ خصم صحيحًا أكبر من صفر.");
        } else {
          discountDays = discountType === "days" ? Number(leaveDiscountValues[item.id]) : discountType === "half_day" ? 0.5 : 0.25;
          if (!Number.isFinite(discountDays) || discountDays <= 0) return fail("أدخل عدد أيام صحيحًا أكبر من صفر.");
          discountAmount = Math.round((monthlySalary / 30) * discountDays * 100) / 100;
        }
      }
    }
    setBusy(true);
    const decisionDetails = item.event_type === "leave" && status === "approved"
      ? { ...(item.details ?? {}), leave_discount_type: discountType, leave_discount_days: discountDays || null, monthly_salary: discountType === "none" ? null : Number(employees.find((row) => row.id === item.employee_id)?.salary_amount), daily_salary: discountType === "none" ? null : Math.round((Number(employees.find((row) => row.id === item.employee_id)?.salary_amount) / 30) * 100) / 100 }
      : item.details;
    const { data, error } = await supabase.from("hr_events")
      .update({ status, decision_reason: reason, ...(item.event_type === "leave" && status === "approved" ? { amount: discountAmount, amount_unit: discountAmount === null ? null : "LYD", details: decisionDetails } : {}) })
      .eq("id", item.id).eq("status", "pending").select("id").maybeSingle();
    if (error) return fail(`تعذر حفظ القرار: ${error.message}`);
    if (!data) return fail("الطلب لم يعد قيد المراجعة. حدّث الصفحة.");
    setDecisionReasons((current) => ({ ...current, [item.id]: "" }));
    await finish(status === "approved" ? (item.event_type === "leave" && discountAmount !== null ? `تم اعتماد الإجازة واحتساب خصم ${discountAmount.toFixed(2)} د.ل.` : "تم اعتماد الطلب وتسجيل القرار.") : "تم رفض الطلب وتسجيل السبب.");
  }

  function employeeSelect(value: string, setter: (value: string) => void) {
    return <select value={value} onChange={(event) => setter(event.target.value)} required><option value="">اختر الموظف</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employeeName(employee)} — {toWesternDigits(employee.employee_number)}{employee.branch?.name ? ` · ${employee.branch.name}` : ""}</option>)}</select>;
  }

  return <div className="effects-content">
    <div className="effects-summary-row">
      <article><span>طلبات قيد المراجعة</span><strong>{toWesternDigits(pendingCount)}</strong></article>
      <article><span>سجلات الفترة</span><strong>{toWesternDigits(events.length)}</strong></article>
      <article><span>الموظفون المتاحون للإجراء</span><strong>{toWesternDigits(activeEmployees.length)}</strong></article>
    </div>
    {message && <p className={`effects-message${message.error ? " error" : ""}`} role="status">{message.text}</p>}

    {isEmployee && <section className="panel effects-form-panel"><div className="effects-panel-heading"><div><h2>تقديم طلب</h2><p>الإجازة وأذونات التأخير والخروج والمأموريات تحتاج اعتماد الإدارة الرئيسية.</p></div><span className="effects-role-badge">موظف</span></div>
      {!employeeId ? <p className="effects-empty-note">حسابك غير مربوط بملف موظف. اطلب من الموارد البشرية ربط الحساب أولًا.</p> : <form className="effects-form-grid" onSubmit={submitRequest}>
        <label>نوع الطلب<select value={requestType} onChange={(event) => setRequestType(event.target.value as EventType)}><option value="leave">إجازة</option><option value="late_permission">إذن تأخير</option><option value="permission">إذن خروج / استئذان</option><option value="mission">مأمورية</option></select></label>
        <label>تاريخ الطلب<input type="date" required value={requestStart} onChange={(event) => setRequestStart(event.target.value)} /></label>
        {requestType === "leave" && <label>إلى تاريخ<input type="date" min={requestStart} required value={requestEnd} onChange={(event) => setRequestEnd(event.target.value)} /></label>}
        {requestType === "late_permission" && <label>وقت الوصول المتوقع<input type="time" value={requestTime} onChange={(event) => setRequestTime(event.target.value)} /></label>}
        {requestType === "permission" && <label>الوقت المتوقع<input type="time" value={requestTime} onChange={(event) => setRequestTime(event.target.value)} /></label>}
        <label className="wide">السبب والتفاصيل<textarea required rows={3} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} placeholder="اكتب سبب الطلب وأي تفاصيل يحتاجها المدير" /></label>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "جارٍ الإرسال…" : "إرسال الطلب للمراجعة"}</button>
      </form>}
    </section>}

    {isBranchManager && <div className="effects-manager-grid">
      <section className="panel effects-form-panel"><div className="effects-panel-heading"><div><h2>تسجيل موظف جديد</h2><p>يُضاف الموظف مباشرة إلى فرعك ويسجل حدث تعيين.</p></div><span className="effects-role-badge">مدير الفرع</span></div>
        <form className="effects-form-grid" onSubmit={addHire}><label>الكود الوظيفي<input required value={hireNumber} onChange={(event) => setHireNumber(event.target.value)} /></label><label>اسم الموظف بالكامل<input required value={hireName} onChange={(event) => setHireName(event.target.value)} /></label><label>المسمى الوظيفي<select value={hireTitle} onChange={(event) => setHireTitle(event.target.value)}><option value="">غير محدد</option>{jobTitles.map((title) => <option value={title.id} key={title.id}>{title.name}</option>)}</select></label><label>تاريخ التعيين<input type="date" required value={hireDate} onChange={(event) => setHireDate(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>تسجيل التعيين</button></form>
      </section>
      <section className="panel effects-form-panel"><div className="effects-panel-heading"><div><h2>إنهاء خدمة أو طلب خصم</h2><p>إنهاء الخدمة يسجل فورًا. الخصم ينتظر اعتماد الإدارة الرئيسية.</p></div></div>
        <form className="effects-form-grid" onSubmit={submitBranchAction}><label className="wide">الموظف{employeeSelect(selectedEmployee, setSelectedEmployee)}</label><label>الإجراء<select value={branchActionType} onChange={(event) => setBranchActionType(event.target.value as "deduction" | "termination")}><option value="deduction">طلب خصم من الراتب</option><option value="termination">إنهاء خدمة</option></select></label><label>التاريخ<input type="date" required value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label>{branchActionType === "deduction" && <label>مبلغ الخصم بالدينار الليبي<input type="number" min="0.01" step="0.01" required value={deductionAmount} onChange={(event) => setDeductionAmount(event.target.value)} /></label>}<label className="wide">السبب<textarea required rows={3} value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{branchActionType === "deduction" ? "رفع الخصم للإدارة" : "تسجيل إنهاء الخدمة"}</button></form>
      </section>
    </div>}

    {isHeadOffice && <section className="panel effects-form-panel"><div className="effects-panel-heading"><div><h2>تسجيل خصم على الراتب</h2><p>الخصم يُحفظ مع المبلغ والسبب والموظف كإجراء معتمد ومرحّل للراتب.</p></div><span className="effects-role-badge head-office">الإدارة الرئيسية</span></div>
      <form className="effects-form-grid" onSubmit={recordDirectDeduction}><label className="wide">الموظف{employeeSelect(directEmployee, setDirectEmployee)}</label><label>تاريخ الخصم<input type="date" required value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label><label>المبلغ بالدينار الليبي<input type="number" min="0.01" step="0.01" required value={directAmount} onChange={(event) => setDirectAmount(event.target.value)} /></label><label className="wide">سبب الخصم<textarea required rows={2} value={directReason} onChange={(event) => setDirectReason(event.target.value)} placeholder="السبب الذي سيظهر في سجل الموظف" /></label><button className="primary-button" type="submit" disabled={busy}>اعتماد وتسجيل الخصم</button></form>
    </section>}

    <section className="panel effects-list-panel"><div className="effects-panel-heading"><div><h2>{isHeadOffice ? "طلبات وقرارات الفروع" : isBranchManager ? "سجل مؤثرات الفرع" : "طلباتي"}</h2><p>{isHeadOffice ? "اعتمد الإجازات وأذونات التأخير، وسجّل سبب كل قرار. اعتماد الخصم يسجله ضمن خصومات الرواتب." : "كل طلب أو إجراء يظهر بحالته وتاريخه وسببه."}</p></div>{isHeadOffice && <span className="effects-pending-badge">{toWesternDigits(pendingCount)} معلّق</span>}</div>
      {events.length ? <div className="effects-event-list">{events.map((item) => {
        const person = item.employee ? employeeName(item.employee) : "موظف";
        const time = typeof item.details?.requested_time === "string" ? item.details.requested_time : null;
        const canDecide = isHeadOffice && item.status === "pending";
        const leaveDiscount = leaveDiscountTypes[item.id] ?? "none";
        const employeeSalary = Number(employees.find((row) => row.id === item.employee_id)?.salary_amount);
        const leaveDailyRate = Number.isFinite(employeeSalary) ? employeeSalary / 30 : null;
        const leaveDiscountPreview = leaveDiscount === "fixed" ? Number(leaveDiscountValues[item.id]) : leaveDiscount === "days" ? (leaveDailyRate ?? 0) * Number(leaveDiscountValues[item.id]) : leaveDiscount === "half_day" ? (leaveDailyRate ?? 0) * 0.5 : leaveDiscount === "quarter_day" ? (leaveDailyRate ?? 0) * 0.25 : 0;
        return <article className="effects-event-card" key={item.id}>
          <div className="effects-event-top"><div><span className="effects-event-type">{eventLabels[item.event_type] ?? item.event_type}</span><h3>{person}<small> · {toWesternDigits(item.employee?.employee_number ?? "—")}</small></h3></div><span className={`effects-status ${item.status}`}>{statusLabels[item.status]}</span></div>
          <div className="effects-event-meta"><span>التاريخ: {toWesternDigits(item.effective_date)}{item.end_date ? ` – ${toWesternDigits(item.end_date)}` : ""}</span>{time && <span>الوقت: {toWesternDigits(time)}</span>}{item.amount != null && <strong>المبلغ: {toWesternDigits(Number(item.amount).toFixed(2))} د.ل</strong>}{item.employee?.branch?.name && <span>{item.employee.branch.name}</span>}</div>
          {item.reason && <p className="effects-event-reason"><b>السبب:</b> {item.reason}</p>}
          {item.decision_reason && <p className="effects-decision-reason"><b>{item.status === "rejected" ? "سبب الرفض:" : "قرار الإدارة:"}</b> {item.decision_reason}</p>}
          {item.amount != null && item.event_type === "leave" && <span className="effects-payroll-note">خصم الإجازة: {toWesternDigits(Number(item.amount).toFixed(2))} د.ل</span>}
          {item.payroll_recorded_at && <span className="effects-payroll-note">تم تسجيله ضمن خصومات الراتب بتاريخ {toWesternDigits(item.payroll_recorded_at.slice(0, 10))}</span>}
          {canDecide && <div className="effects-decision"><label>سبب الاعتماد أو الرفض<textarea rows={2} required value={decisionReasons[item.id] ?? ""} onChange={(event) => setDecisionReasons((current) => ({ ...current, [item.id]: event.target.value }))} /></label>{item.event_type === "leave" && <div className="effects-leave-discount"><label>طريقة خصم الإجازة<select value={leaveDiscount} onChange={(event) => setLeaveDiscountTypes((current) => ({ ...current, [item.id]: event.target.value as typeof leaveDiscount }))}><option value="none">بدون خصم</option><option value="fixed">خصم مبلغ ثابت</option><option value="days">خصم بعدد الأيام</option><option value="half_day">خصم نصف يوم</option><option value="quarter_day">خصم ربع يوم</option></select></label>{leaveDiscount !== "none" && <><small>الراتب الشهري: {Number.isFinite(employeeSalary) && employeeSalary > 0 ? `${toWesternDigits(employeeSalary.toFixed(2))} د.ل` : "غير مسجل"} · أجر اليوم = الراتب ÷ 30 = {leaveDailyRate ? `${toWesternDigits(leaveDailyRate.toFixed(2))} د.ل` : "—"}</small>{(leaveDiscount === "fixed" || leaveDiscount === "days") && <label>{leaveDiscount === "fixed" ? "مبلغ الخصم بالدينار" : "عدد أيام الخصم"}<input type="number" min="0.01" step="0.01" required value={leaveDiscountValues[item.id] ?? ""} onChange={(event) => setLeaveDiscountValues((current) => ({ ...current, [item.id]: event.target.value }))} /></label>}<small>قيمة الخصم المتوقعة: {Number.isFinite(leaveDiscountPreview) && leaveDiscountPreview > 0 ? `${toWesternDigits(leaveDiscountPreview.toFixed(2))} د.ل` : "أدخل القيمة لحساب الخصم"}</small></>}</div>}<div>{item.event_type === "deduction" && <small>اعتماد الخصم يسجله ضمن خصومات الرواتب.</small>}<button type="button" className="primary-button" disabled={busy} onClick={() => decide(item, "approved")}>{item.event_type === "deduction" ? "اعتماد وتسجيل الخصم" : "اعتماد الطلب"}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => decide(item, "rejected")}>رفض الطلب</button></div></div>}
        </article>;
      })}</div> : <p className="effects-empty-note">ما فيش طلبات أو مؤثرات مسجلة لحد الآن.</p>}
    </section>
    {isHeadOffice && <p className="effects-footnote">تسجيل الخصم هنا يحفظ مبلغ الخصم وسببه واعتماده في سجل الموارد البشرية؛ حساب صافي المرتب يحتاج ربطه بوحدة مسير الرواتب عند تجهيزها.</p>}
  </div>;
}
