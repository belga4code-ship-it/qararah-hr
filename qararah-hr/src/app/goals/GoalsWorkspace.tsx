"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";
import GoalActions from "./GoalActions";
import GoalCreateDialog, { type GoalEmployeeOption } from "./GoalCreateDialog";
import GoalIcon from "./GoalIcon";
import GoalTasks, { type GoalTask } from "./GoalTasks";
import GoalsReport from "./GoalsReport";
import "./GoalsWorkspace.css";

type EmployeeOption = GoalEmployeeOption;
export type Goal = { id: string; employee_id: string; period_month: string; title: string; description: string | null; target_value: number | null; actual_value: number | null; target_unit: string | null; goal_revision?: number; tasks?: GoalTask[]; employee?: { full_name: string | null; first_name: string; last_name: string | null; employee_number: string; branch?: { name: string } | null } | null };
type GoalState = "waiting" | "progress" | "complete" | "recorded";
const monthNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit" }).format(new Date());
const formatValue = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const normalize = (value: string) => toWesternDigits(value).normalize("NFKD").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").toLocaleLowerCase("ar");
function progressFor(goal: Goal) {
  if (goal.target_value === null || goal.target_value <= 0 || goal.actual_value === null) return null;
  const percentage = goal.actual_value / goal.target_value * 100;
  const rounded = Math.round(percentage * 10) / 10;
  return percentage < 100 ? Math.min(99.9, rounded) : rounded;
}
function taskProgressFor(goal: Goal) { return goal.tasks?.length ? Math.round(goal.tasks.filter(task => task.is_completed).length / goal.tasks.length * 100) : null; }
const stateFor = (goal: Goal): GoalState => goal.actual_value === null ? "waiting" : goal.target_value === null || goal.target_value <= 0 ? "recorded" : goal.actual_value >= goal.target_value ? "complete" : "progress";
const stateLabels: Record<GoalState,string> = { waiting:"بانتظار النتيجة الفعلية",progress:"النتيجة دون المستهدف",complete:"تم تحقيق الهدف",recorded:"إنجاز مسجل دون مستهدف رقمي" };

export default function GoalsWorkspace({ role, employeeId, employees, goals, progressAvailable, tasksAvailable, recurrenceAvailable, canViewAllGoals, canManageGoals, canEditGoals }: { role: "admin" | "hr" | "employee" | "branch_manager" | "accountant" | "auditor"; employeeId: string | null; userId: string; employees: EmployeeOption[]; goals: Goal[]; progressAvailable: boolean; tasksAvailable: boolean; recurrenceAvailable: boolean; canViewAllGoals: boolean; canManageGoals: boolean; canEditGoals: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(monthNow);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("all");
  const [status, setStatus] = useState<"all" | GoalState>("all");
  const [activeSection, setActiveSection] = useState<"work" | "reports">("work");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const details = useRef<HTMLDialogElement>(null);
  const actualDialog = useRef<HTMLDialogElement>(null);
  const [actualId, setActualId] = useState<string | null>(null);
  const [actualDraft, setActualDraft] = useState("");
  const [actualRevision, setActualRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actualMessage, setActualMessage] = useState("");
  const canViewAll = ["admin","hr"].includes(role) || canViewAllGoals || canManageGoals;
  const canManage = ["admin","hr"].includes(role) || canManageGoals;
  const nameFor = (goal: Goal) => goal.employee?.full_name || [goal.employee?.first_name,goal.employee?.last_name].filter(Boolean).join(" ") || employees.find(person=>person.id===goal.employee_id)?.full_name || "موظف";
  const branchFor = (goal: Goal) => goal.employee?.branch?.name || employees.find(person=>person.id===goal.employee_id)?.branch_name || "—";
  const monthGoals = goals.filter(goal=>goal.period_month.slice(0,7)===month && (canViewAll || goal.employee_id===employeeId));
  const branches = [...new Set(monthGoals.map(branchFor).filter(name=>name!=="—"))].sort((a,b)=>a.localeCompare(b,"ar"));
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
  const matching = monthGoals.filter(goal=>(!selectedEmployee || goal.employee_id===selectedEmployee) && (branch==="all" || branchFor(goal)===branch) && words.every(word=>normalize([goal.title,goal.description,nameFor(goal),goal.employee?.employee_number,branchFor(goal)].filter(Boolean).join(" ")).includes(word)));
  const filtered = matching.filter(goal=>status==="all" || stateFor(goal)===status).sort((a,b)=>nameFor(a).localeCompare(nameFor(b),"ar") || a.title.localeCompare(b.title,"ar") || a.id.localeCompare(b.id));
  const tracked = matching.filter(goal=>progressFor(goal)!==null);
  const average = tracked.length ? Math.round(tracked.reduce((sum,goal)=>sum+(progressFor(goal) ?? 0),0)/tracked.length) : null;
  const completed = matching.filter(goal=>stateFor(goal)==="complete").length;
  const awaiting = matching.filter(goal=>stateFor(goal)==="waiting").length;
  const totalPages = Math.max(1,Math.ceil(filtered.length/10));
  const currentPage = Math.min(page,totalPages);
  const visible = filtered.slice((currentPage-1)*10,currentPage*10);
  const detailGoal = goals.find(goal=>goal.id===detailId);
  const actualGoal = goals.find(goal=>goal.id===actualId);
  const actualDraftValue = actualDraft.trim() ? Number(actualDraft) : null;
  const validActualDraft = actualDraftValue !== null && Number.isFinite(actualDraftValue) && actualDraftValue >= 0 && actualDraftValue <= 9999999999.99;
  const actualPreviewHasTarget = actualGoal?.target_value != null && actualGoal.target_value > 0;
  const actualPreviewRatio = actualGoal && validActualDraft ? progressFor({ ...actualGoal, actual_value: actualDraftValue }) : null;
  const employeeFilterName = goals.find(goal=>goal.employee_id===selectedEmployee);
  const monthLabel = month ? new Intl.DateTimeFormat("ar-LY",{timeZone:"Africa/Tripoli",month:"long",year:"numeric"}).format(new Date(`${month}-15T12:00:00Z`)) : "اختر الشهر";

  function reset(){setQuery("");setBranch("all");setSelectedEmployee("");setStatus("all");setPage(1);}
  function openActual(goal: Goal){setActualId(goal.id);setActualRevision(goal.goal_revision ?? 0);setActualDraft(goal.actual_value?.toString() ?? "");setActualMessage("");details.current?.close();actualDialog.current?.showModal();}
  async function saveActual(event: FormEvent<HTMLFormElement>){
    event.preventDefault();if(!actualGoal || busy)return;
    const value=actualDraft.trim() ? Number(actualDraft) : null;
    if(value!==null && (!Number.isFinite(value)||value<0||value>9999999999.99)){setActualMessage("أدخل قيمة إنجاز صحيحة من صفر فما فوق.");return;}
    setBusy(true);setActualMessage("");
    try{
      const {data,error}=await supabase.from("employee_goals").update({actual_value:value}).eq("id",actualGoal.id).eq("goal_revision",actualRevision).is("deleted_at",null).select("id,goal_revision").maybeSingle();
      if(error){setActualMessage(`تعذر حفظ الإنجاز: ${error.message}`);return;}
      if(!data){setActualMessage("تغير الهدف أو حُذف بعد فتح النافذة. أغلقها وحدّث البيانات ثم حاول مجددًا.");return;}
      setNotice(`تم حفظ الإنجاز الفعلي للهدف «${actualGoal.title}».`);actualDialog.current?.close();router.refresh();
    }catch{setActualMessage("تعذر الاتصال لحفظ الإنجاز. حاول مرة أخرى.");}finally{setBusy(false);}
  }

  return <section className="goals-board" dir="rtl">
    <header className="goals-board-hero"><div><span>الموارد البشرية / متابعة الأداء</span><h1>{activeSection === "reports" ? "تقارير أهداف الموظفين" : canViewAll ? "سجل أهداف الموظفين" : "أهدافي الشهرية"}</h1><p>{activeSection === "reports" ? "تابع النتائج الفعلية والمهام والمواعيد في تقرير واحد." : canManage ? "حدد المستهدف، تابع الإنجاز، وصحح الأهداف من مكان واحد." : "أهدافك المحددة للشهر والإنجاز المسجل لكل هدف."}</p></div><div className="goals-hero-tools">{canManage && activeSection === "work" && <GoalCreateDialog employees={employees} defaultEmployeeId={selectedEmployee} defaultMonth={month} tasksAvailable={tasksAvailable} onCreated={result=>{setMonth(result.month);reset();setSelectedEmployee(result.employeeId);setNotice(result.warning ?? "تمت إضافة الهدف ومهامه. تظهر أدناه أهداف الموظف في الشهر المحدد.");router.refresh();}}/>}<small>{canEditGoals ? "التعديل والحذف: مدير النظام ومدير الموارد البشرية" : canManage ? "إضافة الأهداف وتسجيل الإنجاز حسب صلاحيتك" : "متابعة الأهداف حسب صلاحيتك"}</small></div></header>
    <div className="goals-board-body">
      <div className="goals-workspace-tabs" role="tablist" aria-label="أقسام الأهداف"><button type="button" role="tab" aria-selected={activeSection === "work"} className={activeSection === "work" ? "active" : ""} onClick={() => setActiveSection("work")}>◷ الشغل <span>{monthGoals.length}</span></button><button type="button" role="tab" aria-selected={activeSection === "reports"} className={activeSection === "reports" ? "active" : ""} onClick={() => setActiveSection("reports")}>▦ التقارير <span>{monthGoals.length}</span></button></div>
      {activeSection === "reports" ? <GoalsReport goals={goals.filter(goal => canViewAll || goal.employee_id === employeeId)} employees={employees} defaultMonth={month} canViewAll={canViewAll} /> : <>
      <div className="goals-metrics"><article><span>أهداف الشهر</span><strong>{matching.length}<small>هدف</small></strong><p>{monthLabel}</p></article><article className="complete"><span>أهداف محققة</span><strong>{completed}<small>هدف</small></strong><p>وصلت نتائجها الفعلية إلى المستهدف</p></article><article className="waiting"><span>بانتظار النتيجة</span><strong>{awaiting}<small>هدف</small></strong><p>لم تُسجل لها نتيجة فعلية بعد</p></article><article><span>متوسط تحقيق النتائج</span><strong>{average===null ? "—" : `${average}٪`}</strong><p>{tracked.length ? `من ${tracked.length} هدف له مستهدف ونتيجة رقمية` : "يظهر بعد تسجيل النتائج الفعلية"}</p></article></div>
      {notice && <p className="goals-notice" role="status">{notice}<button type="button" aria-label="إغلاق رسالة الأهداف" onClick={()=>setNotice("")}>×</button></p>}
      {!tasksAvailable && <p className="goals-warning" role="status">لتمكين المهام ومواعيد تسليمها، طبّق ملف التحديث <bdi>supabase/migrations/20261109_employee_goal_recurrence_and_deadlines.sql</bdi> في قاعدة بيانات Supabase.</p>}
      {canManage && tasksAvailable && !recurrenceAvailable && <p className="goals-warning" role="status">لإنشاء الأهداف الشهرية المتكررة، طبّق ملف التحديث <bdi>supabase/migrations/20261109_employee_goal_recurrence_and_deadlines.sql</bdi> في قاعدة بيانات Supabase.</p>}
      <div className="goals-filter-heading"><div><h2>تصفية الأهداف</h2><p>ابحث عن الهدف أو الموظف، واختر الشهر المطلوب.</p></div>{(query || branch!=="all" || selectedEmployee || status!=="all") && <button type="button" onClick={reset}>مسح الفلاتر ×</button>}</div>
      <div className="goals-filters"><label className="goals-search"><span>البحث</span><input type="search" value={query} placeholder={canViewAll ? "اسم الهدف، الموظف، أو الكود الوظيفي…" : "اسم الهدف أو تفاصيله…"} onChange={event=>{setQuery(event.target.value);setPage(1);}}/></label><label><span>الشهر</span><input type="month" required value={month} onChange={event=>{setMonth(event.target.value);setBranch("all");setPage(1);}}/></label>{canViewAll && <label><span>الفرع</span><select value={branch} onChange={event=>{setBranch(event.target.value);setPage(1);}}><option value="all">كل الفروع</option>{branches.map(name=><option key={name} value={name}>{name}</option>)}</select></label>}</div>
      {selectedEmployee && <button type="button" className="goals-employee-filter" onClick={()=>{setSelectedEmployee("");setPage(1);}}>أهداف {employeeFilterName ? nameFor(employeeFilterName) : employees.find(person=>person.id===selectedEmployee)?.full_name || "الموظف المحدد"} <span>×</span></button>}
      <div className="goals-status-tabs" aria-label="حالة الهدف">{(["all","waiting","progress","complete","recorded"] as const).map(key=><button type="button" key={key} aria-pressed={status===key} onClick={()=>{setStatus(key);setPage(1);}}>{key==="all" ? "كل الأهداف" : stateLabels[key]}<span>{key==="all" ? matching.length : matching.filter(goal=>stateFor(goal)===key).length}</span></button>)}</div>
      <div className="goals-list-heading"><div><h2>{canViewAll ? "الأهداف المسجلة" : "قائمة أهدافي"}<span>{filtered.length}</span></h2><p>{monthLabel} · اضغط «التفاصيل» لعرض الهدف كاملًا.</p></div></div>
      <div className="goals-table-wrap"><table className={`goals-table ${canViewAll ? "all-employees" : "own-goals"}`}><thead><tr><th>الهدف</th>{canViewAll && <th>الموظف</th>}<th>المستهدف</th><th>الإنجاز ونسبة التحقيق</th><th>الإجراءات</th></tr></thead><tbody>{visible.map(goal=>{
        const ratio=progressFor(goal),taskRatio=taskProgressFor(goal),state=stateFor(goal);
        return <tr key={goal.id} className={`goals-record ${state}`}>
          <td data-label="الهدف"><strong className="goals-row-title">{goal.title}</strong>{goal.description && <p className="goals-row-description">{goal.description}</p>}</td>
          {canViewAll && <td data-label="الموظف"><div className="goals-person"><span aria-hidden="true">{nameFor(goal).charAt(0)}</span><div><strong>{nameFor(goal)}</strong><small>{branchFor(goal)}</small><small dir="ltr">{goal.employee?.employee_number}</small></div></div></td>}
          <td data-label="المستهدف"><strong className="goals-value" dir="ltr">{goal.target_value===null ? "—" : formatValue(goal.target_value)}</strong><small className="goals-unit">{goal.target_value===null ? "غير محدد" : goal.target_unit || "قيمة مستهدفة"}</small></td>
          <td data-label="تحقيق الهدف وإنجاز المهام">
            <div className={`goals-achievement ${state}`}>
              <div className="goals-outcome-progress"><small>تحقيق الهدف من النتيجة الفعلية</small><div className="goals-achievement-numbers">{goal.actual_value===null ? <span className="goals-unrecorded">لم تسجّل النتيجة بعد</span> : <strong className="goals-value actual" dir="ltr">{formatValue(goal.actual_value)}{goal.target_unit ? ` ${goal.target_unit}` : ""}</strong>}{ratio!==null && <b className="goals-percentage" dir="ltr">{formatValue(ratio)}<small>%</small></b>}</div>{ratio!==null && <div className="goals-row-progress" role="progressbar" aria-label={`نسبة تحقيق نتيجة ${goal.title}`} aria-valuetext={`${formatValue(ratio)} بالمئة من المستهدف`} aria-valuenow={Math.min(100,ratio)} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${Math.min(100,Math.max(0,ratio))}%`}}/></div>}</div>
              {goal.tasks?.length ? <div className="goals-task-progress-summary"><small>تنفيذ المهام</small><div className="goals-achievement-numbers"><strong className="goals-value actual">{goal.tasks.filter(task => task.is_completed).length} من {goal.tasks.length} مهام</strong><b className="goals-percentage" dir="ltr">{taskRatio}<small>%</small></b></div><div className="goals-row-progress" role="progressbar" aria-label={`نسبة إنجاز المهام للهدف ${goal.title}`} aria-valuenow={taskRatio ?? 0} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${taskRatio ?? 0}%`}}/></div></div> : <span className="goals-unrecorded">لم تُضف مهامًا للهدف</span>}
              <span className={`goals-state ${state}`}><i/>{state==="complete" ? "تم تحقيق الهدف" : stateLabels[state]}</span>
              {goal.actual_value!==null && ratio===null && <small className="goals-unit">النسبة تحتاج مستهدفًا رقميًا أكبر من صفر</small>}
            </div>
            {progressAvailable && canManage && <button type="button" className="goals-actual-trigger" onClick={()=>openActual(goal)} aria-label={`تسجيل النتيجة الفعلية للهدف: ${goal.title}`}><GoalIcon name="achievement"/>{goal.actual_value===null ? "تسجيل النتيجة الفعلية" : "تحديث النتيجة الفعلية"}</button>}
          </td>
          <td data-label="الإجراءات"><div className="goals-row-actions"><button type="button" className="goals-detail-trigger" aria-label={`تفاصيل الهدف: ${goal.title}`} onClick={()=>{setDetailId(goal.id);details.current?.showModal();}}><GoalIcon name="details"/>عرض التفاصيل</button>{canEditGoals && <GoalActions compact goal={goal} onChanged={updated=>{if(updated){setMonth(updated.period_month.slice(0,7));setNotice("تم تعديل الهدف وحفظ التغيير في سجل التدقيق.");}else{setNotice("تم حذف الهدف من القوائم مع الاحتفاظ بسجله.");}router.refresh();}}/>}</div></td>
        </tr>;
      })}</tbody></table>{!filtered.length && <div className="goals-empty"><span aria-hidden="true">◎</span><h3>{monthGoals.length ? "لا توجد أهداف تطابق البحث" : "لا توجد أهداف لهذا الشهر"}</h3><p>{canManage ? "يمكنك إضافة هدف جديد، أو تغيير الشهر والفلاتر لعرض الأهداف المسجلة." : "جرّب شهرًا آخر أو راجع الأهداف مع مدير الموارد البشرية."}</p>{monthGoals.length>0 && <button type="button" onClick={reset}>عرض أهداف الشهر</button>}</div>}</div>
      <footer className="goals-list-footer"><span>{filtered.length ? `${(currentPage-1)*10+1}–${Math.min(currentPage*10,filtered.length)} من ${filtered.length} هدف` : "0 هدف"}</span><nav aria-label="صفحات الأهداف"><button type="button" disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>السابق</button><span>{currentPage} / {totalPages}</span><button type="button" disabled={currentPage>=totalPages} onClick={()=>setPage(currentPage+1)}>التالي</button></nav></footer>
      {!progressAvailable && <p className="goals-warning" role="status">تسجيل الإنجاز غير متاح حاليًا. راجع إعدادات الأهداف في قاعدة البيانات.</p>}
      </>}
    </div>
    <dialog ref={details} className="goals-info-dialog" aria-label="تفاصيل الهدف"><div dir="rtl"><header><div><small>تفاصيل الهدف</small><h2>{detailGoal?.title}</h2><p>{detailGoal ? nameFor(detailGoal) : ""}</p></div><button type="button" aria-label="إغلاق تفاصيل الهدف" onClick={()=>details.current?.close()}>×</button></header>{detailGoal && <><dl><div><dt>الشهر</dt><dd>{detailGoal.period_month.slice(0,7)}</dd></div><div><dt>حالة النتيجة</dt><dd>{stateLabels[stateFor(detailGoal)]}</dd></div><div><dt>المستهدف</dt><dd>{detailGoal.target_value===null ? "غير محدد" : `${formatValue(detailGoal.target_value)} ${detailGoal.target_unit || ""}`}</dd></div><div><dt>النتيجة الفعلية</dt><dd>{detailGoal.actual_value===null ? "لم تسجل بعد" : `${formatValue(detailGoal.actual_value)} ${detailGoal.target_unit || ""}`}{progressFor(detailGoal)!==null && <strong className="goal-outcome-ratio">{formatValue(progressFor(detailGoal)!)}٪ من المستهدف</strong>}</dd></div><div className="wide"><dt>تفاصيل الهدف</dt><dd>{detailGoal.description || "لم تُضف تفاصيل لهذا الهدف."}</dd></div></dl>{tasksAvailable ? <GoalTasks key={detailGoal.id} goalId={detailGoal.id} periodMonth={detailGoal.period_month} tasks={detailGoal.tasks ?? []} canManage={canManage} canComplete={canManage || detailGoal.employee_id === employeeId} canAddNote={detailGoal.employee_id === employeeId}/> : <p className="goals-warning">تحديث قاعدة البيانات غير مطبق، لا يمكن إدارة المهام حاليًا.</p>}<footer><button type="button" className="secondary-button" onClick={()=>details.current?.close()}>إغلاق</button>{canManage && progressAvailable && <button type="button" className="primary-button" onClick={()=>openActual(detailGoal)}>تسجيل النتيجة الفعلية</button>}</footer></>}</div></dialog>
    <dialog ref={actualDialog} className="goals-info-dialog" aria-label="تسجيل الإنجاز الفعلي" onCancel={event=>{if(busy)event.preventDefault();}}><form onSubmit={saveActual} dir="rtl"><header><div><small>متابعة الإنجاز</small><h2>تسجيل الإنجاز الفعلي</h2><p>{actualGoal?.title}</p></div><button type="button" disabled={busy} aria-label="إغلاق تسجيل الإنجاز" onClick={()=>actualDialog.current?.close()}>×</button></header><p className="goals-actual-context">{actualGoal ? nameFor(actualGoal) : ""} · المستهدف: {actualGoal?.target_value==null ? "غير محدد" : `${formatValue(actualGoal.target_value)} ${actualGoal.target_unit || ""}`}</p><label className="goals-actual-field">القيمة المحققة<input autoFocus type="number" min="0" max="9999999999.99" step="0.01" value={actualDraft} onChange={event=>setActualDraft(event.target.value)} placeholder="أدخل الإنجاز الفعلي" disabled={busy}/><small>{actualGoal?.target_unit || "وحدة الإنجاز"} · ترك الحقل فارغًا يلغي القيمة المسجلة.</small></label>
      <div className={`goals-achievement-preview${actualPreviewRatio !== null && actualPreviewRatio >= 100 ? " complete" : ""}`} aria-live="polite" aria-atomic="true">
        <div className="goals-achievement-preview-heading"><span>نسبة تحقيق الهدف</span><strong dir="ltr">{actualPreviewRatio === null ? "—" : `${formatValue(actualPreviewRatio)}%`}</strong></div>
        {actualPreviewRatio !== null && <div className="goals-achievement-preview-bar" role="progressbar" aria-label="نسبة تحقيق الهدف" aria-valuenow={Math.min(100, actualPreviewRatio)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${formatValue(actualPreviewRatio)} بالمائة`}><span style={{ width: `${Math.min(100, actualPreviewRatio)}%` }}/></div>}
        {validActualDraft && actualPreviewHasTarget && <p><b dir="ltr">{formatValue(actualDraftValue!)}</b> من أصل <b dir="ltr">{formatValue(actualGoal!.target_value!)}</b> {actualGoal?.target_unit || ""}</p>}
        <small className="goals-achievement-preview-note">{!actualPreviewHasTarget ? "يلزم مستهدف أكبر من صفر لحساب النسبة. يمكنك حفظ قيمة الإنجاز دون نسبة." : !validActualDraft ? "أدخل القيمة المحققة لتظهر نسبة الإنجاز مباشرة قبل الحفظ." : actualPreviewRatio !== null && actualPreviewRatio >= 100 ? "تم تحقيق المستهدف بالكامل." : `المتبقي لتحقيق الهدف: ${formatValue(actualGoal!.target_value! - actualDraftValue!)} ${actualGoal?.target_unit || ""}`}</small>
      </div>
      {actualMessage && <p className="goals-warning" role="alert">{actualMessage}</p>}<footer><button type="button" className="secondary-button" disabled={busy} onClick={()=>actualDialog.current?.close()}>إلغاء</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ الإنجاز"}</button></footer></form></dialog>
  </section>;
}
