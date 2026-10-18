"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";
import EffectsReportExport from "./EffectsReportExport";
import EffectRequestPrintButton from "./EffectRequestPrintButton";

type Role = "admin" | "hr" | "branch_manager" | "employee" | "auditor" | "accountant";
type EventType = "new_hire" | "leave" | "termination" | "deduction" | "mission" | "late_permission" | "permission";
export type EffectEmployee = {
  id: string; employee_number: string; first_name: string; last_name: string | null; full_name: string | null;
  status: string; branch_id: string; manager_id?: string | null; salary_amount?: number | null; phone?: string | null; job_title: { name: string } | null; department?: { name: string } | null; branch: { name: string } | null;
};
export type HREvent = {
  id: string; employee_id: string; event_type: EventType; effective_date: string; end_date: string | null; reason: string | null;
  amount: number | null; amount_unit: string | null; status: "pending" | "approved" | "rejected";
  report_revision?: number; report_edit_reason?: string | null; report_edited_at?: string | null; report_edited_by?: string | null;
  decision_by?: string | null; approved_by?: string | null;
  decision_reason: string | null; decision_at: string | null; payroll_recorded_at: string | null; approved_at?: string | null;
  details: Record<string, unknown> | null; created_at: string;
  created_by?: string | null;
  requester?: { full_name: string | null; role: string | null; user_roles?: string[] | null; employee_id: string | null } | null;
  employee: { employee_number: string; first_name: string; last_name: string | null; full_name: string | null; manager_id?: string | null; branch: { name: string } | null } | null;
};
export type ApprovalStep = { id: string; event_id: string; step_order: number; approver_role: "branch_manager" | "auditor" | "hr" | "assigned_manager"; approver_profile_id?: string | null; approver_profile_ids?: string[]; status: "pending" | "approved" | "rejected" | "skipped"; decided_by: string | null; decided_at: string | null; reason: string | null };

const eventLabels: Record<EventType, string> = {
  new_hire: "تعيين جديد", leave: "إجازة", termination: "إنهاء خدمة", deduction: "خصم من الراتب",
  mission: "مأمورية", late_permission: "إذن تأخير", permission: "إذن خروج / استئذان",
};
const statusLabels = { pending: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض" } as const;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const employeeName = (employee: Pick<EffectEmployee, "full_name" | "first_name" | "last_name">) => employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ");
const whatsappNumber = (phone: string) => {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `218${digits.slice(1)}`;
  else if (digits.length === 9 && digits.startsWith("9")) digits = `218${digits}`;
  return digits;
};

export default function EffectsWorkspace({ role, userRoles, extraPermissions, userId, employeeId, branchId, employees, jobTitles, events, approvalSteps, approvalWorkflowAvailable, approvalNames }: {
  role: Role; userRoles: string[]; extraPermissions: string[]; userId: string; employeeId: string | null; branchId: string | null;
  employees: EffectEmployee[]; jobTitles: { id: string; name: string }[]; events: HREvent[]; approvalSteps: ApprovalStep[]; approvalWorkflowAvailable: boolean; approvalNames: Record<string, string>;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState<{ eventId: string; text: string; error: boolean } | null>(null);
  const decisionInputs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<"work" | "reports">("work");
  const [workBranchFilter, setWorkBranchFilter] = useState("all");
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
  const [selectedRequestEmployee, setSelectedRequestEmployee] = useState("");
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

  const hasRole = (...roles: string[]) => roles.some((item) => userRoles.includes(item));
  const hasPermission = (...permissions: string[]) => permissions.some((item) => extraPermissions.includes(item));
  const isHeadOffice = hasRole("admin", "hr");
  const isBranchManager = hasRole("branch_manager");
  const isEmployee = hasRole("employee");
  const isAuditor = hasRole("auditor");
  const canManageDeductions = isHeadOffice || isAuditor || hasPermission("effects.manage_deductions");
  const canApproveRequests = isHeadOffice || hasPermission("effects.approve");
  const canExportReports = isHeadOffice || isAuditor || hasPermission("reports.export");
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const pendingCount = events.filter((event) => event.status === "pending").length;
  const workBranches = useMemo(() => [...new Set(events.map((event) => event.employee?.branch?.name).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, "ar")), [events]);
  const workEvents = useMemo(() => events
    .filter((event) => workBranchFilter === "all" || event.employee?.branch?.name === workBranchFilter)
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.created_at.localeCompare(a.created_at)), [events, workBranchFilter]);

  function currentRequestStep(eventId: string) {
    const pending = approvalSteps.filter((step) => step.event_id === eventId && step.status === "pending").sort((a, b) => a.step_order - b.step_order);
    return hasRole("admin") ? pending[0] ?? null : pending.find((step) => step.approver_profile_id === userId) ?? null;
  }
  function approverLabel(step: ApprovalStep) {
    return step.approver_role === "assigned_manager" ? (approvalNames[step.approver_profile_id ?? ""] || `المسؤول ${step.step_order}`) : step.approver_role === "branch_manager" ? "مدير الفرع" : step.approver_role === "auditor" ? "مراجع الحسابات" : "الموارد البشرية";
  }

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
    if ((!employeeId && !isBranchManager) || !branchId) return fail("حسابك غير مربوط بملف موظف أو فرع. تواصل مع الموارد البشرية لربط الحساب.");
    const targetEmployeeId = isBranchManager ? selectedRequestEmployee : employeeId;
    if (!targetEmployeeId) return fail("اختر الموظف المطلوب تقديم الطلب نيابةً عنه.");
    if (!requestReason.trim()) return fail("اكتب سبب الطلب قبل الإرسال.");
    if (requestType === "leave" && requestEnd && requestEnd < requestStart) return fail("تاريخ نهاية الإجازة لازم يكون بعد بدايتها.");
    setBusy(true);
    const { error } = await supabase.from("hr_events").insert({
      employee_id: targetEmployeeId, branch_id: branchId, event_type: requestType,
      effective_date: requestStart, end_date: requestType === "leave" && requestEnd ? requestEnd : null,
      reason: requestReason.trim(), details: requestTime ? { requested_time: requestTime } : {},
      created_by: userId, status: "pending",
    });
    if (error) return fail(error.message.includes("عيّن مسؤولاً") ? "لا يمكن إرسال الطلب قبل أن تعيّن الموارد البشرية مسؤولًا مرتبطًا بحساب دخول لهذا الموظف." : error.message.includes("row-level security") ? "ما قدرتش نرسل الطلب. تأكد من ربط حسابك بملف الموظف في Supabase." : `تعذر إرسال الطلب: ${error.message}`);
    setRequestReason(""); setRequestEnd(""); setRequestTime("");
    await finish(isBranchManager ? "تم إرسال الطلب نيابةً عن الموظف إلى مسار المراجعة والاعتماد." : "تم إرسال الطلب إلى المسؤول المعيّن للمراجعة والاعتماد.");
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
    await finish("تم إرسال طلب التعيين للإدارة الرئيسية، ويبقى ملف الموظف غير نشط حتى الموافقة.");
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
    setDecisionFeedback(null);
    const decisionFail = (text: string) => {
      setDecisionFeedback({ eventId: item.id, text, error: true });
      setBusy(false);
      setDecidingId(null);
    };
    const decisionFinish = (text: string) => {
      setDecisionFeedback({ eventId: item.id, text, error: false });
      setBusy(false);
      setDecidingId(null);
      router.refresh();
    };
    const reason = decisionReasons[item.id]?.trim();
    if (!reason) {
      decisionFail("اكتب ملاحظة الموافقة أو سبب الرفض في الخانة قبل حفظ القرار.");
      decisionInputs.current[item.id]?.focus();
      decisionInputs.current[item.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const isEmployeeRequest = ["leave", "permission", "late_permission"].includes(item.event_type);
    const activeLeaveStep = isEmployeeRequest ? currentRequestStep(item.id) : null;
    const isAdmin = hasRole("admin");
    if (isEmployeeRequest && !approvalWorkflowAvailable) return decisionFail("مسار موافقات المسؤولين غير متاح. راجع إعدادات قاعدة البيانات.");
    if (isEmployeeRequest && !isAdmin && !activeLeaveStep) return decisionFail("لا توجد موافقة معلقة مسندة لحسابك على هذا الطلب.");
    const pendingSteps = approvalSteps.filter((step) => step.event_id === item.id && step.status === "pending");
    const isFinalLeaveStep = isAdmin || pendingSteps.length === 1;
    let discountAmount: number | null = null;
    let discountType: "none" | "fixed" | "days" | "half_day" | "quarter_day" = "none";
    let discountDays = 0;
    if (status === "approved" && item.event_type === "leave" && isFinalLeaveStep) {
      discountType = leaveDiscountTypes[item.id] ?? "none";
      const employee = employees.find((row) => row.id === item.employee_id);
      const monthlySalary = Number(employee?.salary_amount);
      if (discountType !== "none") {
        if (discountType === "fixed") {
          discountAmount = Number(leaveDiscountValues[item.id]);
          if (!Number.isFinite(discountAmount) || discountAmount <= 0) return decisionFail("أدخل مبلغ خصم صحيحًا أكبر من صفر.");
        } else {
          if (!isAuditor && !isAdmin && (!Number.isFinite(monthlySalary) || monthlySalary <= 0)) return decisionFail("راتب الموظف غير مسجل، حدّث بيانات الراتب قبل احتساب خصم الإجازة.");
          discountDays = discountType === "days" ? Number(leaveDiscountValues[item.id]) : discountType === "half_day" ? 0.5 : 0.25;
          if (!Number.isFinite(discountDays) || discountDays <= 0) return decisionFail("أدخل عدد أيام صحيحًا أكبر من صفر.");
          if (Number.isFinite(monthlySalary) && monthlySalary > 0) discountAmount = Math.round((monthlySalary / 30) * discountDays * 100) / 100;
        }
      }
    }
    setBusy(true);
    setDecidingId(item.id);
    try {
    if (isEmployeeRequest) {
      const { data: resultingStatus, error } = await supabase.rpc("decide_employee_request", {
        p_event_id: item.id, p_status: status, p_reason: reason,
        p_discount_type: item.event_type === "leave" && status === "approved" && isFinalLeaveStep ? discountType : "none",
        p_discount_value: item.event_type === "leave" && status === "approved" && isFinalLeaveStep && (discountType === "fixed" || discountType === "days") ? Number(leaveDiscountValues[item.id]) : null,
      });
      if (error) return decisionFail(`تعذر حفظ القرار: ${error.message}`);
      setDecisionReasons((current) => ({ ...current, [item.id]: "" }));
      decisionFinish(status === "rejected" ? "تم رفض الطلب وتسجيل السبب." : resultingStatus === "pending" ? "تم تسجيل موافقتك. الطلب ما زال معلقًا بانتظار بقية المسؤولين." : isAdmin ? "اعتمد مدير النظام الطلب نهائيًا مع تجاوز الموافقات المتبقية." : discountAmount !== null ? `اكتملت جميع الموافقات واحتُسب خصم ${discountAmount.toFixed(2)} د.ل.` : "اكتملت جميع موافقات المسؤولين واعتمد الطلب نهائيًا.");
      return;
    }
    const { data, error } = await supabase.from("hr_events")
      .update({ status, decision_reason: reason })
      .eq("id", item.id).eq("status", "pending").select("id").maybeSingle();
    if (error) return decisionFail(`تعذر حفظ القرار: ${error.message}`);
    if (!data) return decisionFail("الطلب لم يعد قيد المراجعة. حدّث الصفحة.");
    setDecisionReasons((current) => ({ ...current, [item.id]: "" }));
    decisionFinish(status === "approved" ? (item.event_type === "deduction" ? "تم اعتماد الخصم وتسجيله ضمن خصومات الرواتب." : "تم اعتماد الطلب وتسجيل القرار.") : "تم رفض الطلب وتسجيل السبب.");
    } catch {
      decisionFail("تعذر الاتصال لحفظ القرار. تحقق من الاتصال ثم حاول مرة أخرى.");
    }
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
    <div className="effects-workspace-tabs" role="tablist" aria-label="أقسام المؤثرات الأسبوعية">
      <button type="button" role="tab" aria-selected={activeTab === "work"} className={activeTab === "work" ? "active" : ""} onClick={() => setActiveTab("work")}><span aria-hidden="true">◷</span>الشغل<span className="effects-tab-count">{toWesternDigits(pendingCount)}</span></button>
      <button type="button" role="tab" aria-selected={activeTab === "reports"} className={activeTab === "reports" ? "active" : ""} onClick={() => setActiveTab("reports")}><span aria-hidden="true">▦</span>التقارير</button>
    </div>
    {activeTab === "reports" ? <EffectsReportExport events={events} canExport={canExportReports} canEdit={hasRole("admin")} approvalSteps={approvalSteps} approvalNames={approvalNames} /> : <>
    {message && <p className={`effects-message${message.error ? " error" : ""}`} role="status">{message.text}</p>}
    {!approvalWorkflowAvailable && events.some((event) => event.event_type === "leave" && event.status === "pending") && <p className="effects-approval-warning" role="status">مسار موافقات المسؤولين يحتاج تطبيق تحديث قاعدة البيانات <b>20261105_individual_request_approvals.sql</b>. لا يمكن اعتماد الإجازات المعلقة قبل تطبيقه.</p>}

    {isEmployee && <section className="panel effects-form-panel"><div className="effects-panel-heading"><div><h2>تقديم طلب</h2><p>تُرسل الإجازات وأذونات الخروج والتأخير إلى المسؤول المعيّن على ملفك. ويستطيع مدير النظام اعتمادها أو رفضها.</p></div><span className="effects-role-badge">موظف</span></div>
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
      <section className="panel effects-form-panel"><div className="effects-panel-heading"><div><h2>طلب تعيين موظف جديد</h2><p>يُرسل الطلب للإدارة الرئيسية؛ يبقى الموظف غير نشط إلى أن توافق الإدارة.</p></div><span className="effects-role-badge">مدير الفرع</span></div>
        <form className="effects-form-grid" onSubmit={addHire}><label>الكود الوظيفي<input required value={hireNumber} onChange={(event) => setHireNumber(event.target.value)} /></label><label>اسم الموظف بالكامل<input required value={hireName} onChange={(event) => setHireName(event.target.value)} /></label><label>المسمى الوظيفي<select value={hireTitle} onChange={(event) => setHireTitle(event.target.value)}><option value="">غير محدد</option>{jobTitles.map((title) => <option value={title.id} key={title.id}>{title.name}</option>)}</select></label><label>تاريخ التعيين<input type="date" required value={hireDate} onChange={(event) => setHireDate(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>إرسال طلب التعيين</button></form>
      </section>
      <section className="panel effects-form-panel"><div className="effects-panel-heading"><div><h2>إنهاء خدمة أو طلب خصم</h2><p>إنهاء الخدمة يسجل فورًا. الخصم ينتظر اعتماد الإدارة الرئيسية.</p></div></div>
        <form className="effects-form-grid" onSubmit={submitBranchAction}><label className="wide">الموظف{employeeSelect(selectedEmployee, setSelectedEmployee)}</label><label>الإجراء<select value={branchActionType} onChange={(event) => setBranchActionType(event.target.value as "deduction" | "termination")}><option value="deduction">طلب خصم من الراتب</option><option value="termination">إنهاء خدمة</option></select></label><label>التاريخ<input type="date" required value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label>{branchActionType === "deduction" && <label>مبلغ الخصم بالدينار الليبي<input type="number" min="0.01" step="0.01" required value={deductionAmount} onChange={(event) => setDeductionAmount(event.target.value)} /></label>}<label className="wide">السبب<textarea required rows={3} value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{branchActionType === "deduction" ? "رفع الخصم للإدارة" : "تسجيل إنهاء الخدمة"}</button></form>
      </section>
      <section className="panel effects-form-panel"><div className="effects-panel-heading"><div><h2>طلب إجازة أو إذن لموظف الفرع</h2><p>قدّم إجازة أو إذنًا أو بلاغ تأخير نيابةً عن الموظف، وسيُسجّل الطلب باسمك كمقدّم عنه.</p></div><span className="effects-role-badge">ضمن فرعك</span></div><form className="effects-form-grid" onSubmit={submitRequest}>
      <label className="wide">الموظف{employeeSelect(selectedRequestEmployee, setSelectedRequestEmployee)}</label>
      <label>نوع الطلب<select value={requestType} onChange={(event) => setRequestType(event.target.value as EventType)}><option value="leave">إجازة</option><option value="late_permission">إذن تأخير</option><option value="permission">إذن خروج / استئذان</option><option value="mission">مأمورية</option></select></label>
      <label>تاريخ الطلب<input type="date" required value={requestStart} onChange={(event) => setRequestStart(event.target.value)} /></label>
      {requestType === "leave" && <label>إلى تاريخ<input type="date" min={requestStart} required value={requestEnd} onChange={(event) => setRequestEnd(event.target.value)} /></label>}
      {requestType === "late_permission" && <label>وقت الوصول المتوقع<input type="time" value={requestTime} onChange={(event) => setRequestTime(event.target.value)} /></label>}
      {requestType === "permission" && <label>الوقت المتوقع<input type="time" value={requestTime} onChange={(event) => setRequestTime(event.target.value)} /></label>}
      <label className="wide">السبب والتفاصيل<textarea required rows={3} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} placeholder="اكتب سبب الطلب وأي تفاصيل يحتاجها المسؤول" /></label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "جارٍ الإرسال…" : "إرسال الطلب للمراجعة"}</button>
      </form></section>
    </div>}

    {canManageDeductions && <section className="panel effects-form-panel"><div className="effects-panel-heading"><div><h2>تسجيل خصم على الراتب</h2><p>الخصم يُحفظ مع المبلغ والسبب والموظف كإجراء معتمد ومرحّل للراتب.</p></div><span className="effects-role-badge head-office">{isAuditor ? "مراجع حسابات" : isHeadOffice ? "الإدارة الرئيسية" : "صلاحية خصومات"}</span></div>
      <form className="effects-form-grid" onSubmit={recordDirectDeduction}><label className="wide">الموظف{employeeSelect(directEmployee, setDirectEmployee)}</label><label>تاريخ الخصم<input type="date" required value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label><label>المبلغ بالدينار الليبي<input type="number" min="0.01" step="0.01" required value={directAmount} onChange={(event) => setDirectAmount(event.target.value)} /></label><label className="wide">سبب الخصم<textarea required rows={2} value={directReason} onChange={(event) => setDirectReason(event.target.value)} placeholder="السبب الذي سيظهر في سجل الموظف" /></label><button className="primary-button" type="submit" disabled={busy}>اعتماد وتسجيل الخصم</button></form>
    </section>}

    <section className="panel effects-list-panel"><div className="effects-panel-heading"><div><h2>{isHeadOffice || isAuditor || hasPermission("effects.view_all") ? "طلبات وقرارات الفروع" : isBranchManager ? "سجل مؤثرات الفرع" : "طلباتي"}</h2><p>{isAuditor ? "سجّل الخصومات واعتمد طلبات الخصم وإجازات موظفي الحسابات بعد موافقة مدير الفرع." : isHeadOffice || hasPermission("effects.approve") ? "اعتمد طلبات الإجازة المحالة من مدير الفرع وأذونات التأخير، وسجّل سبب كل قرار." : "كل طلب أو إجراء يظهر بحالته وتاريخه وسببه."}</p></div><div className="effects-work-list-tools">{(isHeadOffice || isAuditor || hasPermission("effects.approve", "effects.manage_deductions")) && <span className="effects-pending-badge">{toWesternDigits(pendingCount)} معلّق</span>}<label className="effects-branch-filter">الفرع<select value={workBranchFilter} onChange={(event) => setWorkBranchFilter(event.target.value)}><option value="all">كل الفروع</option>{workBranches.map((name) => <option value={name} key={name}>{name}</option>)}</select></label></div></div>
      {workEvents.length ? <div className="effects-event-list">{workEvents.map((item) => {
        const person = item.employee ? employeeName(item.employee) : "موظف";
        const time = typeof item.details?.requested_time === "string" ? item.details.requested_time : null;
        const leaveSteps = approvalSteps.filter((step) => step.event_id === item.id).sort((a, b) => a.step_order - b.step_order);
        const isEmployeeRequest = ["leave", "permission", "late_permission"].includes(item.event_type);
        const activeLeaveStep = isEmployeeRequest ? currentRequestStep(item.id) : null;
        const isFinalLeaveStep = hasRole("admin") || leaveSteps.filter((step) => step.status === "pending").length === 1;
        const assignedProfiles = Array.isArray(item.details?.responsible_profile_ids) ? item.details.responsible_profile_ids as string[] : [];
        const canDecide = item.status === "pending" && (isEmployeeRequest
          ? approvalWorkflowAvailable && (hasRole("admin") || Boolean(activeLeaveStep))
          : canApproveRequests || (canManageDeductions && item.event_type === "deduction"));
        const leaveDiscount = leaveDiscountTypes[item.id] ?? "none";
        const employeeSalary = Number(employees.find((row) => row.id === item.employee_id)?.salary_amount);
        const employeeRecord = employees.find((row) => row.id === item.employee_id);
        const requesterRoles = [item.requester?.role, ...(item.requester?.user_roles ?? [])];
        const requesterName = item.requester?.full_name?.trim() || (item.created_by === userId ? "أنت" : null);
        const requesterRole = item.requester?.employee_id === item.employee_id
          ? "الموظف نفسه"
          : requesterRoles.includes("branch_manager")
            ? "مدير الفرع"
            : requesterRoles.includes("admin")
              ? "مدير النظام"
              : requesterRoles.includes("hr")
                ? "الموارد البشرية"
                : requesterRoles.includes("auditor")
                  ? "مراجع الحسابات"
                  : requesterRoles.includes("accountant")
                    ? "المحاسب"
                    : requesterRoles.includes("employee")
                      ? "الموظف"
                      : "مستخدم النظام";
        const phone = employeeRecord?.phone?.trim();
        const canSendDeductionNotice = canManageDeductions && item.status === "approved" && item.amount != null && item.amount > 0 && (item.event_type === "deduction" || (isHeadOffice && item.event_type === "leave"));
        const waNumber = phone ? whatsappNumber(phone) : "";
        const messageText = `السلام عليكم ${person}، نحيطكم علمًا بأنه تم تسجيل ${item.event_type === "leave" ? "خصم إجازة" : "خصم على الراتب"} بقيمة ${Number(item.amount ?? 0).toFixed(2)} د.ل. السبب: ${item.decision_reason || item.reason || "يرجى التواصل مع الموارد البشرية"}. تاريخ الإجراء: ${item.effective_date}. للاستفسار يرجى التواصل مع الموارد البشرية. شركة قرارة للرخام والجرانيت.`;
        const whatsappHref = waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(messageText)}` : "";
        const leaveDailyRate = Number.isFinite(employeeSalary) ? employeeSalary / 30 : null;
        const leaveDiscountPreview = leaveDiscount === "fixed" ? Number(leaveDiscountValues[item.id]) : leaveDiscount === "days" ? (leaveDailyRate ?? 0) * Number(leaveDiscountValues[item.id]) : leaveDiscount === "half_day" ? (leaveDailyRate ?? 0) * 0.5 : leaveDiscount === "quarter_day" ? (leaveDailyRate ?? 0) * 0.25 : 0;
        return <article className="effects-event-card" key={item.id}>
          <div className="effects-event-top"><div><span className="effects-event-type">{eventLabels[item.event_type] ?? item.event_type}</span><h3>{person}<small> · {toWesternDigits(item.employee?.employee_number ?? "—")}</small></h3></div><span className={`effects-status ${item.status}`}>{statusLabels[item.status]}</span></div>
          <div className="effects-event-meta"><span>التاريخ: {toWesternDigits(item.effective_date)}{item.end_date ? ` – ${toWesternDigits(item.end_date)}` : ""}</span>{time && <span>الوقت: {toWesternDigits(time)}</span>}{item.amount != null && <strong>المبلغ: {toWesternDigits(Number(item.amount).toFixed(2))} د.ل</strong>}{item.employee?.branch?.name && <span>{item.employee.branch.name}</span>}</div>
          {(["leave", "permission", "late_permission"] as const).includes(item.event_type as "leave" | "permission" | "late_permission") && <EffectRequestPrintButton kind={item.event_type as "leave" | "permission" | "late_permission"} employeeName={person} employeeNumber={toWesternDigits(item.employee?.employee_number ?? "—")} submittedBy={requesterName || "غير مسجل"} submitterRole={requesterName ? requesterRole : "غير محددة"} startDate={toWesternDigits(item.effective_date)} endDate={item.end_date ? toWesternDigits(item.end_date) : null} requestedTime={time ? toWesternDigits(time) : null} reason={item.reason ?? ""} deductionAmount={item.amount} deductionUnit={item.amount_unit} requestId={item.id} requestStatus={item.status} responsibleIds={assignedProfiles.length ? assignedProfiles : typeof item.details?.responsible_profile_id === "string" ? [item.details.responsible_profile_id] : []} adminOverride={Boolean(item.details?.admin_override)} approvalSteps={leaveSteps} approvalNames={approvalNames} decisionBy={item.decision_by || item.approved_by || null} decisionAt={item.decision_at || item.approved_at || null} decisionReason={item.decision_reason} />}
          {item.event_type === "deduction" && <p className="effects-requester"><b>مقدّم طلب الخصم:</b> {requesterName ? <>{requesterName} <span>({requesterRole})</span></> : "بيانات مقدّم الطلب غير متوفرة في السجل"}</p>}
          {isEmployeeRequest && <div className="effects-approval-flow" aria-label="موافقات المسؤولين">{leaveSteps.length ? leaveSteps.map((step) => <div key={step.id} className={`effects-approval-step ${step.status}${activeLeaveStep?.id === step.id ? " current" : ""}`}><span>{approverLabel(step)}</span><strong>{step.status === "approved" ? "تمت الموافقة" : step.status === "rejected" ? "مرفوض" : step.status === "skipped" ? "لم يعتمد — تم تجاوز المرحلة" : "بانتظار الموافقة"}</strong></div>) : <div className="effects-approval-step pending"><span>مسار الموافقات</span><strong>{approvalWorkflowAvailable ? "بانتظار التهيئة" : "يتطلب تحديث قاعدة البيانات"}</strong></div>}</div>}
          {item.reason && <p className="effects-event-reason"><b>السبب:</b> {item.reason}</p>}
          {item.decision_reason && <p className="effects-decision-reason"><b>{item.status === "rejected" ? "سبب الرفض:" : "قرار الإدارة:"}</b> {item.decision_reason}</p>}
          {item.amount != null && item.event_type === "leave" && <span className="effects-payroll-note">خصم الإجازة: {toWesternDigits(Number(item.amount).toFixed(2))} د.ل</span>}
          {item.payroll_recorded_at && <span className="effects-payroll-note">تم تسجيله ضمن خصومات الراتب بتاريخ {toWesternDigits(item.payroll_recorded_at.slice(0, 10))}</span>}
          {canSendDeductionNotice && (waNumber ? <a className="whatsapp-notice-button" href={whatsappHref} target="_blank" rel="noopener noreferrer">إرسال إشعار واتساب</a> : <span className="effects-no-phone-note">لا يمكن تجهيز الرسالة: رقم هاتف الموظف غير مسجل.</span>)}
          {decisionFeedback?.eventId === item.id && <p id={`decision-feedback-${item.id}`} role={decisionFeedback.error ? "alert" : "status"} className={`effects-message ${decisionFeedback.error ? "error" : "success"}`}>{decisionFeedback.text}</p>}
          {canDecide && <div className="effects-decision"><label>ملاحظة الموافقة أو سبب الرفض (مطلوب)<textarea ref={(element) => { decisionInputs.current[item.id] = element; }} rows={2} required placeholder="اكتب ملاحظتك، مثل: موافق على الطلب" aria-invalid={decisionFeedback?.eventId === item.id && decisionFeedback.error && !decisionReasons[item.id]?.trim() ? true : undefined} aria-describedby={decisionFeedback?.eventId === item.id ? `decision-feedback-${item.id}` : undefined} value={decisionReasons[item.id] ?? ""} onChange={(event) => setDecisionReasons((current) => ({ ...current, [item.id]: event.target.value }))} /></label>{item.event_type === "leave" && isFinalLeaveStep && <div className="effects-leave-discount"><p>{hasRole("admin") ? "بصفتك مدير النظام، يمكنك اعتماد الطلب نهائيًا وتجاوز الموافقات المتبقية. ويمكن تحديد الخصم إذا لزم." : "هذه آخر مرحلة اعتماد. يمكن تحديد خصم الإجازة إذا لزم."}</p><label>طريقة خصم الإجازة<select value={leaveDiscount} onChange={(event) => setLeaveDiscountTypes((current) => ({ ...current, [item.id]: event.target.value as typeof leaveDiscount }))}><option value="none">بدون خصم</option><option value="fixed">خصم مبلغ ثابت</option><option value="days">خصم بعدد الأيام</option><option value="half_day">خصم نصف يوم</option><option value="quarter_day">خصم ربع يوم</option></select></label>{leaveDiscount !== "none" && <>{isAuditor && !employeeSalary ? <small>سيتم حساب الخصم من بيانات الراتب المحمية عند الاعتماد النهائي.</small> : <small>الراتب الشهري: {Number.isFinite(employeeSalary) && employeeSalary > 0 ? `${toWesternDigits(employeeSalary.toFixed(2))} د.ل` : "غير مسجل"} · أجر اليوم = الراتب ÷ 30 = {leaveDailyRate ? `${toWesternDigits(leaveDailyRate.toFixed(2))} د.ل` : "—"}</small>}{(leaveDiscount === "fixed" || leaveDiscount === "days") && <label>{leaveDiscount === "fixed" ? "مبلغ الخصم بالدينار" : "عدد أيام الخصم"}<input type="number" min="0.01" step="0.01" required value={leaveDiscountValues[item.id] ?? ""} onChange={(event) => setLeaveDiscountValues((current) => ({ ...current, [item.id]: event.target.value }))} /></label>}{(!isAuditor || employeeSalary) && <small>قيمة الخصم المتوقعة: {Number.isFinite(leaveDiscountPreview) && leaveDiscountPreview > 0 ? `${toWesternDigits(leaveDiscountPreview.toFixed(2))} د.ل` : "أدخل القيمة لحساب الخصم"}</small>}</>}</div>}<div>{item.event_type === "deduction" && <small>اعتماد الخصم يسجله ضمن خصومات الرواتب.</small>}<button type="button" className="primary-button" disabled={busy} onClick={() => decide(item, "approved")}>{decidingId === item.id ? "جارٍ حفظ القرار…" : item.event_type === "deduction" ? "اعتماد وتسجيل الخصم" : isEmployeeRequest && hasRole("admin") ? "اعتماد نهائي وتجاوز الموافقات" : isEmployeeRequest ? "تسجيل موافقتي" : "اعتماد الطلب"}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => decide(item, "rejected")}>رفض الطلب</button></div></div>}
        </article>;
      })}</div> : <p className="effects-empty-note">ما فيش طلبات أو مؤثرات مسجلة لحد الآن.</p>}
    </section>
    {canManageDeductions && <p className="effects-footnote">تسجيل الخصم هنا يحفظ مبلغ الخصم وسببه واعتماده في سجل الموارد البشرية؛ حساب صافي المرتب يحتاج ربطه بوحدة مسير الرواتب عند تجهيزها.</p>}
    </>}
  </div>;
}
