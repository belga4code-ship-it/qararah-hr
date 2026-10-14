"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";

type Role = "admin" | "hr" | "branch_manager" | "accountant" | "employee" | "auditor";
type Criterion = { name: string; score: number; evidence: string };
export type EvaluatedEmployee = { id: string; employee_number: string; first_name: string; last_name: string | null; full_name: string | null; status: string; branch_id: string; job_title_name: string; branch_name: string };
export type EvaluatorOption = { employee_id: string; full_name: string; job_title_name: string; branch_name: string; has_system_account: boolean };
export type EvaluationAssignment = { employee_id: string; slot: number; evaluator_profile_id: string; evaluator_employee_id: string | null; evaluator_employee: { id: string; employee_number: string; first_name: string; last_name: string | null; full_name: string | null; job_title: { name: string } | null; branch: { name: string } | null } | null };
export type EvaluationRecord = { id: string; employee_id: string; period_month: string; evaluator_id: string | null; total_score: number | null; max_score: number; status: string; notes: string | null; evaluation_items: { criterion: string; score: number; max_score: number; evidence: string | null }[] };

const criterionNames = {
  accountant: [
    "الالتزام بالحضور وإدارة الوقت وإنجاز المهام",
    "العمل الجماعي والتعاون وتحمل المسؤولية",
    "إدارة السلف ومطابقتها مع الفرع",
    "دقة فواتير البيع والشراء بين الفروع",
    "متابعة مديونيات الزبائن ورفع التقرير المالي",
    "إدخال إيصالات القبض والتحويلات ومراجعة المرفقات",
    "إتمام المطابقة الشهرية مع الإدارة المالية في موعدها",
    "إدارة مصروفات الفرع وإضافة مستنداتها يوميًا",
    "إدارة حركة الخزينة اليومية وإرفاق المستندات",
  ],
  sales: [
    "الالتزام بالحضور وإدارة الوقت وإنجاز المهام",
    "تحقيق نسبة المبيعات المستهدفة خلال الشهر",
    "استقطاب زبائن جدد بالتسويق الخارجي",
    "تسويق المنتجات التي بها ركود",
    "متابعة الزبائن بعد البيع وعرض المنتجات الجديدة",
    "متابعة سداد مديونيات الزبائن",
    "المظهر ومهارات التواصل والتسويق والإقناع",
    "حل مشاكل الزبائن والمحافظة على استمرارية التعامل",
    "دقة الفواتير ومدخلات المنظومة",
    "رفع تقرير شهري باحتياجات الزبائن والسوق",
  ],
  general: [
    "الالتزام بالحضور وإدارة الوقت وإنجاز المهام",
    "جودة العمل ودقة النتائج",
    "الالتزام بالإجراءات والتعليمات المعتمدة",
    "إنجاز المهام في المواعيد المحددة",
    "العمل الجماعي والتعاون مع الفريق",
    "تحمل المسؤولية والمحافظة على ممتلكات الشركة",
    "التواصل المهني وخدمة الزملاء والعملاء",
    "التعامل مع المشكلات وإيجاد الحلول المناسبة",
    "رفع التقارير وتحديث المعلومات المطلوبة",
  ],
};

const employeeName = (employee: EvaluatedEmployee) => employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ");
const templateFor = (title: string) => /محاسب/.test(title) ? "accountant" : /مبيعات|مندوب/.test(title) ? "sales" : "general";
const currentCriteria = (title: string): string[] => criterionNames[templateFor(title)];
const seedScores = (title: string): Criterion[] => currentCriteria(title).map((name) => ({ name, score: 3, evidence: "" }));
const monthLabel = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-LY", { month: "long", year: "numeric", timeZone: "Africa/Tripoli" }).format(new Date(Date.UTC(year, number - 1, 15)));
};

export default function EvaluationsWorkspace({ role, userId, profileEmployeeId, month, employees, assignments, evaluators, evaluations }: {
  role: Role; userId: string; profileEmployeeId: string | null; month: string; employees: EvaluatedEmployee[]; assignments: EvaluationAssignment[]; evaluators: EvaluatorOption[]; evaluations: EvaluationRecord[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const isHR = role === "admin" || role === "hr";
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [assignmentChoices, setAssignmentChoices] = useState<Record<string, [string, string]>>(() => Object.fromEntries(employees.map((employee) => {
    const rows = assignments.filter((item) => item.employee_id === employee.id).sort((a, b) => a.slot - b.slot);
    return [employee.id, [rows.find((row) => row.slot === 1)?.evaluator_employee_id ?? "", rows.find((row) => row.slot === 2)?.evaluator_employee_id ?? ""]];
  })));
  const [scores, setScores] = useState<Record<string, Criterion[]>>(() => Object.fromEntries(employees.map((employee) => {
    const existing = evaluations.find((row) => row.employee_id === employee.id && row.evaluator_id === userId);
    const defaults = seedScores(employee.job_title_name);
    if (existing?.evaluation_items?.length) {
      const byName = new Map(existing.evaluation_items.map((item) => [item.criterion, item]));
      return [employee.id, defaults.map((item) => ({ ...item, score: byName.get(item.name)?.score ?? item.score, evidence: byName.get(item.name)?.evidence ?? "" }))];
    }
    return [employee.id, defaults];
  })));
  const [notes, setNotes] = useState<Record<string, string>>(() => Object.fromEntries(employees.map((employee) => [employee.id, evaluations.find((row) => row.employee_id === employee.id && row.evaluator_id === userId)?.notes ?? ""])));
  const assignedEmployeeIds = new Set(assignments.filter((item) => item.evaluator_profile_id === userId || (profileEmployeeId && item.evaluator_employee_id === profileEmployeeId)).map((item) => item.employee_id));
  const submittedCount = evaluations.filter((item) => item.status === "submitted").length;
  const normalizedSearch = search.trim().toLocaleLowerCase("ar");
  const filteredEmployees = normalizedSearch
    ? employees.filter((employee) => [employeeName(employee), employee.branch_name, employee.job_title_name, employee.employee_number]
      .some((value) => value?.toLocaleLowerCase("ar").includes(normalizedSearch)))
    : employees;

  async function saveAssignment(employeeId: string) {
    const [primary, secondary] = assignmentChoices[employeeId] ?? ["", ""];
    if (primary && primary === secondary) { setMessage({ text: "اختار مسؤولين مختلفين للتقييم الأول والثاني.", error: true }); return; }
    setBusyId(employeeId); setMessage(null);
    const { error } = await supabase.rpc("set_employee_evaluators", { p_employee_id: employeeId, p_primary_evaluator_employee_id: primary, p_secondary_evaluator_employee_id: secondary || null });
    if (error) { setMessage({ text: `تعذر حفظ المقيّمين: ${error.message}`, error: true }); setBusyId(null); return; }
    setMessage({ text: "تم حفظ المقيّمين للموظف." }); setBusyId(null); router.refresh();
  }

  async function submitEvaluation(event: FormEvent<HTMLFormElement>, employee: EvaluatedEmployee) {
    event.preventDefault(); setBusyId(employee.id); setMessage(null);
    const items = scores[employee.id] ?? seedScores(employee.job_title_name);
    const { error } = await supabase.rpc("submit_employee_evaluation", {
      p_employee_id: employee.id,
      p_period_month: `${month}-01`,
      p_notes: notes[employee.id] ?? "",
      p_items: items.map((item) => ({ criterion: item.name, score: item.score, max_score: 4, evidence: item.evidence })),
    });
    if (error) { setMessage({ text: `تعذر حفظ التقييم: ${error.message}`, error: true }); setBusyId(null); return; }
    setMessage({ text: `تم حفظ تقييم ${employeeName(employee)} لشهر ${monthLabel(month)}.` }); setBusyId(null); router.refresh();
  }

  function chooseMonth(value: string) {
    if (/^\d{4}-\d{2}$/.test(value)) router.push(`/evaluations?month=${value}`);
  }

  return <div className="evaluations-content">
    <div className="evaluations-toolbar"><div><span>فترة التقييم</span><strong>{monthLabel(month)}</strong></div><label><span className="sr-only">اختر شهر التقييم</span><input type="month" value={month} onChange={(event) => chooseMonth(event.target.value)} /></label><label className="evaluations-search"><span className="sr-only">ابحث بالاسم أو الفرع أو الصفة</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الفرع أو الصفة" /></label><span className="evaluations-counter">{toWesternDigits(submittedCount)} تقييم محفوظ</span></div>
    {message && <p className={`evaluations-message${message.error ? " error" : ""}`} role="status">{message.text}</p>}
    {filteredEmployees.length ? <div className="evaluations-list">{filteredEmployees.map((employee) => {
      const employeeAssignments = assignments.filter((item) => item.employee_id === employee.id).sort((a, b) => a.slot - b.slot);
      const employeeEvals = evaluations.filter((item) => item.employee_id === employee.id && item.status === "submitted");
      const expected = employeeAssignments.length;
      const average = employeeEvals.length ? employeeEvals.reduce((sum, item) => sum + (Number(item.total_score ?? 0) / Number(item.max_score || 1)) * 100, 0) / employeeEvals.length : null;
      const pendingOther = expected > employeeEvals.length;
      const choices = assignmentChoices[employee.id] ?? ["", ""];
      const canEvaluate = assignedEmployeeIds.has(employee.id) || role === "auditor";
      const myEvaluation = evaluations.find((item) => item.employee_id === employee.id && item.evaluator_id === userId);
      const employeeScores = scores[employee.id] ?? seedScores(employee.job_title_name);
      const rawTotal = employeeScores.reduce((sum, item) => sum + item.score, 0);
      const template = templateFor(employee.job_title_name);
      const passLine = template === "accountant" ? 26 : template === "sales" ? 29 : null;
      return <article className="panel evaluation-employee-card" key={employee.id}>
        <div className="evaluation-employee-heading"><div><span className="evaluation-job">{employee.job_title_name || "موظف إداري"}</span><h2>{employeeName(employee)} <small>· {toWesternDigits(employee.employee_number)}</small></h2><p>{employee.branch_name}</p></div><div className="evaluation-result"><span>المتوسط النهائي</span><strong>{average === null ? "—" : `${toWesternDigits(average.toFixed(1))}%`}</strong><small>{average === null ? "لم يُقدّم تقييم بعد" : pendingOther ? "بانتظار التقييم الآخر" : "اكتملت التقييمات"}</small></div></div>
        {isHR && <section className="evaluation-assignments"><div><h3>المسؤولون عن التقييم</h3><p>اختار المسؤولين من قائمة الموظفين المسجلين، ويمكن إضافة مسؤول ثانٍ.</p></div><div className="evaluation-assignment-fields">{([0, 1] as const).map((slot) => <label key={slot}><span>{slot === 0 ? "المقيّم الأول" : "المقيّم الثاني"}</span><select required={slot === 0} value={choices[slot]} onChange={(event) => setAssignmentChoices((current) => ({ ...current, [employee.id]: slot === 0 ? [event.target.value, choices[1]] : [choices[0], event.target.value] }))}><option value="">{slot === 0 ? "اختر الموظف المسؤول" : "بدون مسؤول ثانٍ"}</option>{evaluators.filter((candidate) => candidate.employee_id !== employee.id && candidate.employee_id !== choices[slot === 0 ? 1 : 0]).map((candidate) => <option key={candidate.employee_id} value={candidate.employee_id}>{candidate.full_name}{candidate.job_title_name ? ` · ${candidate.job_title_name}` : ""}{candidate.branch_name ? ` · ${candidate.branch_name}` : ""}{candidate.has_system_account ? "" : " · حساب النظام غير مربوط"}</option>)}</select></label>)}<button type="button" className="primary-button" disabled={busyId === employee.id || !choices[0]} onClick={() => saveAssignment(employee.id)}>{busyId === employee.id ? "جارٍ الحفظ…" : "حفظ الإسناد"}</button></div><p className="evaluation-assignment-note">يمكنك إسناد أي موظف بالاسم. الموظف الذي لا يملك حسابًا مربوطًا بملفه لن يتمكن من إرسال تقييمه إلا بعد ربط الحساب.</p>{employeeAssignments.length > 0 && <div className="evaluation-assigned-names">{employeeAssignments.map((item) => <span key={item.slot}>المقيّم {toWesternDigits(item.slot)}: {item.evaluator_employee?.full_name || [item.evaluator_employee?.first_name, item.evaluator_employee?.last_name].filter(Boolean).join(" ") || evaluators.find((candidate) => candidate.employee_id === item.evaluator_employee_id)?.full_name || "مقيّم بالاسم من سجل الموظفين"}</span>)}</div>}</section>}
        {employeeAssignments.length > 0 && <div className="evaluation-score-summary">{employeeAssignments.map((assignment) => {
          const row = employeeEvals.find((item) => item.evaluator_id === assignment.evaluator_profile_id);
          const evaluatorEmployee = assignment.evaluator_employee;
          const evaluatorName = evaluatorEmployee?.full_name || [evaluatorEmployee?.first_name, evaluatorEmployee?.last_name].filter(Boolean).join(" ") || evaluators.find((candidate) => candidate.employee_id === assignment.evaluator_employee_id)?.full_name || (assignment.evaluator_profile_id === userId || (profileEmployeeId && assignment.evaluator_employee_id === profileEmployeeId) ? "تقييمي" : `المقيّم ${toWesternDigits(assignment.slot)}`);
          return <span key={assignment.slot}><b>{evaluatorName}</b>{row ? `${toWesternDigits(Number(row.total_score ?? 0))} / ${toWesternDigits(Number(row.max_score))} (${toWesternDigits(((Number(row.total_score ?? 0) / Number(row.max_score || 1)) * 100).toFixed(1))}%)` : "بانتظار التقييم"}</span>;
        })}{average !== null && passLine !== null && <strong className={average >= (passLine / (template === "accountant" ? 36 : 40)) * 100 ? "pass" : "fail"}>{average >= (passLine / (template === "accountant" ? 36 : 40)) * 100 ? "أداء مقبول" : "أداء ضعيف"} · الحد {toWesternDigits(passLine)} نقطة</strong>}</div>}
        {canEvaluate && <details className="evaluation-form-details" open={!myEvaluation}>
          <summary>{myEvaluation ? "فتح أو تحديث تقييمي لهذا الشهر" : "ابدأ تقييم الموظف لهذا الشهر"}</summary>
          <form onSubmit={(event) => submitEvaluation(event, employee)}><div className="evaluation-scale">4 ممتاز · 3 جيد · 2 متوسط · 1 ضعيف</div><div className="evaluation-criteria">{employeeScores.map((item, index) => <label className="evaluation-criterion" key={item.name}><span><b>{toWesternDigits(index + 1)}. {item.name}</b><small>النقاط من 4</small></span><select aria-label={`تقييم ${item.name}`} value={item.score} onChange={(event) => setScores((current) => ({ ...current, [employee.id]: employeeScores.map((score, scoreIndex) => scoreIndex === index ? { ...score, score: Number(event.target.value) } : score) }))}>{[4, 3, 2, 1].map((score) => <option value={score} key={score}>{score} · {score === 4 ? "ممتاز" : score === 3 ? "جيد" : score === 2 ? "متوسط" : "ضعيف"}</option>)}</select></label>)}</div><label className="evaluation-notes"><span>ملاحظات المقيّم</span><textarea rows={3} value={notes[employee.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [employee.id]: event.target.value }))} placeholder="اكتب ملاحظات أو أمثلة تدعم التقييم" /></label><div className="evaluation-submit-row"><strong>مجموع نقاطي: {toWesternDigits(rawTotal)} / {toWesternDigits(employeeScores.length * 4)}</strong>{passLine !== null && <span>حد الأداء المقبول: {toWesternDigits(passLine)} نقطة</span>}<button className="primary-button" type="submit" disabled={busyId === employee.id}>{busyId === employee.id ? "جارٍ الحفظ…" : myEvaluation ? "تحديث التقييم" : "إرسال التقييم"}</button></div></form>
        </details>}
        {isHR && employeeAssignments.length === 0 && <p className="evaluation-empty-hint">عيّن مسؤولًا واحدًا على الأقل قبل بدء تقييم هذا الموظف.</p>}
      </article>;
    })}</div> : <p className="evaluation-empty-hint">{employees.length ? "ما لقيناش موظف يطابق البحث. جرّب الاسم أو الفرع أو الصفة." : "ما فيش موظفون مسندون للتقييم لهذا الحساب، أو لم تُسند له مسؤولية تقييم بعد."}</p>}
    <p className="evaluation-footnote">تُحفظ نتيجة كل مسؤول منفصلة باسمه. المتوسط النهائي هو متوسط نسب التقييمات المقدمة؛ وإذا كان للموظف مسؤولان، يظهر تنبيه إلى حين اكتمال التقييم الثاني. معايير المحاسب ومسؤول المبيعات مأخوذة من نماذج الشركة؛ الوظائف الأخرى تستخدم معايير إدارية عامة.</p>
  </div>;
}
