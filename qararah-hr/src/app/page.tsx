import Link from "next/link";
import { connection } from "next/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { toWesternDigits } from "@/lib/digits";
import WorkforceDistribution from "./WorkforceDistribution";

export const instant = false;

type Employee = { id: string; employee_number: string; first_name: string; last_name: string | null; full_name: string | null; branch_id: string; status: string; attendance_required: boolean; hired_on: string | null; job_title: { name: string } | null; branch: { name: string } | null; department: { name: string } | null };
type Attendance = { employee_id: string; status: string; first_in: string | null; last_out: string | null; attendance_date: string; exception_note: string | null; employee: { employee_number: string; first_name: string; last_name: string | null } | null; branch: { name: string } | null };
type Branch = { id: string; name: string };
type PendingRequest = { id: string; event_type: string; details: Record<string, unknown> | null; created_at: string; employee: { full_name: string | null; first_name: string; last_name: string | null; employee_number: string } | null };
type GoalReminder = { id: string; title: string; due_date: string | null; goal: { title: string; employee: { full_name: string | null; first_name: string; last_name: string | null; employee_number: string } | null } | null };

function formatClock(value: string | null) {
  if (!value) return "—";
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return toWesternDigits(value);
  return `${String(hour % 12 || 12).padStart(2, "0")}:${minute} ${hour >= 12 ? "م" : "ص"}`;
}

export default async function Home() {
  await connection();
  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const user = claims?.sub ? { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null } : null;
  if (authError || !user) redirect("/login");

  const { data: profile } = await loadAccessProfile<{full_name:string | null;role:string;branch_id:string | null;employee_id:string | null}>(supabase,user.id,"full_name,role,branch_id,employee_id,user_roles,additional_permissions","full_name,role,branch_id,employee_id");
  if (!profile) redirect("/setup-required");
  const roles = [...new Set([profile.role,...((profile.user_roles as string[] | null) ?? [])])];
  const permissions = (profile.additional_permissions as string[] | null) ?? [];
  const isBranchManager = roles.includes("branch_manager");
  const isHeadOffice = roles.some((role) => ["admin", "hr"].includes(role));
  const canReviewRequests = roles.some((role) => ["admin", "hr", "branch_manager", "accountant", "auditor"].includes(role)) || permissions.some((permission) => ["effects.approve", "effects.manage_deductions"].includes(permission));
  const canEvaluateAssigned = roles.some((role) => ["admin", "hr", "branch_manager", "accountant", "auditor"].includes(role)) || permissions.includes("evaluations.evaluate");

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekStartDate = new Date(now);
  weekStartDate.setDate(weekStartDate.getDate() - 6);
  const weekStart = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(weekStartDate);
  const [{ data: employeeData }, { data: branchData }, { data: todayData }, { data: weekData }] = await Promise.all([
    supabase.from("employees").select("id,employee_number,first_name,last_name,full_name,branch_id,status,attendance_required,hired_on,job_title:job_titles(name),branch:branches(name),department:departments(name)").eq("status", "active"),
    supabase.from("branches").select("id,name").eq("is_active", true).order("name"),
    supabase.from("attendance_records").select("employee_id,status,first_in,last_out,attendance_date,exception_note,employee:employees(employee_number,first_name,last_name),branch:branches(name)").eq("attendance_date", today),
    supabase.from("attendance_records").select("employee_id,attendance_date,status").gte("attendance_date", weekStart).lte("attendance_date", today),
  ]);

  const reminderEndDate = new Date(`${today}T12:00:00Z`);
  reminderEndDate.setUTCDate(reminderEndDate.getUTCDate() + 7);
  const reminderEnd = reminderEndDate.toISOString().slice(0, 10);

  const requestSummary = async () => {
    if (!canReviewRequests) return { requests: [] as PendingRequest[], count: 0 };
    const [{ data: directSteps }, { data: sharedSteps }] = await Promise.all([
      supabase.from("hr_event_approval_steps").select("event_id").eq("status", "pending").eq("approver_profile_id", user.id),
      supabase.from("hr_event_approval_steps").select("event_id").eq("status", "pending").contains("approver_profile_ids", [user.id]),
    ]);
    const activeRequestIds = [...new Set([...(directSteps ?? []), ...(sharedSteps ?? [])].map((step) => step.event_id))];
    if (!activeRequestIds.length) return { requests: [] as PendingRequest[], count: 0 };
    let requestQuery = supabase.from("hr_events").select("id,event_type,details,created_at,employee:employees!inner(full_name,first_name,last_name,employee_number,branch_id)", { count: "exact" }).in("id", activeRequestIds).eq("status", "pending").order("created_at", { ascending: false });
    if (isBranchManager && !isHeadOffice && !permissions.includes("effects.view_all")) requestQuery = requestQuery.eq("branch_id", profile.branch_id ?? "00000000-0000-0000-0000-000000000000");
    const { data, count } = await requestQuery.limit(12);
    const requests = (data ?? []) as unknown as PendingRequest[];
    return { requests, count: count ?? requests.length };
  };

  const evaluationSummary = async () => {
    if (!canEvaluateAssigned) return { evaluations: [] as Array<{ id: string; name: string; employeeNumber: string }>, count: 0 };
    const monthStart = `${new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit" }).format(now)}-01`;
    const { data: assignmentData } = await supabase.from("employee_evaluators")
      .select("employee_id,evaluator_profile_id,evaluator_employee_id")
      .or(`evaluator_profile_id.eq.${user.id}${profile.employee_id ? `,evaluator_employee_id.eq.${profile.employee_id}` : ""}`);
    const ownAssignments = (assignmentData ?? []).filter((row) => row.evaluator_profile_id === user.id || row.evaluator_employee_id === profile.employee_id);
    const assignedIds = [...new Set(ownAssignments.map((row) => row.employee_id))];
    if (!assignedIds.length) return { evaluations: [] as Array<{ id: string; name: string; employeeNumber: string }>, count: 0 };
    const [{ data: assignedEmployees }, { data: submittedEvaluations }] = await Promise.all([
      supabase.from("employees").select("id,full_name,first_name,last_name,employee_number").in("id", assignedIds).eq("status", "active").order("employee_number").limit(100),
      supabase.from("evaluations").select("employee_id").eq("period_month", monthStart).eq("evaluator_id", user.id).eq("status", "submitted").in("employee_id", assignedIds),
    ]);
    const evaluatedIds = new Set((submittedEvaluations ?? []).map((row) => row.employee_id));
    const pendingEvaluations = (assignedEmployees ?? []).filter((employee) => !evaluatedIds.has(employee.id));
    return {
      count: pendingEvaluations.length,
      evaluations: pendingEvaluations.slice(0, 5).map((employee) => ({ id: employee.id, name: employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" "), employeeNumber: employee.employee_number })),
    };
  };

  const [{ data: reminderData }, { count: overdueCount }, requestResult, evaluationResult] = await Promise.all([
    supabase.from("employee_goal_tasks")
      .select("id,title,due_date,goal:employee_goals!inner(title,employee:employees!inner(full_name,first_name,last_name,employee_number))")
      .eq("is_completed", false).not("due_date", "is", null).lte("due_date", reminderEnd).order("due_date").limit(12),
    isHeadOffice
      ? supabase.from("employee_goal_tasks").select("id", { count: "exact", head: true }).eq("is_completed", false).not("due_date", "is", null).lt("due_date", today)
      : Promise.resolve({ count: 0 }),
    requestSummary(),
    evaluationSummary(),
  ]);
  const managerRequests = requestResult.requests;
  const managerRequestCount = requestResult.count;
  const managerEvaluations = evaluationResult.evaluations;
  const managerEvaluationCount = evaluationResult.count;
  const overdueManagementTasks = overdueCount ?? 0;
  const goalReminders = ((reminderData ?? []) as unknown as GoalReminder[]).filter((task): task is GoalReminder & { due_date: string } => Boolean(task.due_date)).map((task) => {
    const goal = Array.isArray(task.goal) ? task.goal[0] : task.goal;
    const employee = goal && Array.isArray(goal.employee) ? goal.employee[0] : goal?.employee;
    return { id: task.id, task: task.title, goal: goal?.title ?? "هدف", employee: employee?.full_name || [employee?.first_name, employee?.last_name].filter(Boolean).join(" ") || "موظف", employeeNumber: employee?.employee_number ?? "", dueDate: task.due_date, overdue: task.due_date < today };
  });
  const employees = ((employeeData ?? []) as unknown as Array<Omit<Employee, "job_title" | "branch" | "department"> & { job_title: { name: string } | { name: string }[] | null; branch: { name: string } | { name: string }[] | null; department: { name: string } | { name: string }[] | null }>).map((employee) => ({
    ...employee,
    job_title: Array.isArray(employee.job_title) ? employee.job_title[0] ?? null : employee.job_title,
    branch: Array.isArray(employee.branch) ? employee.branch[0] ?? null : employee.branch,
    department: Array.isArray(employee.department) ? employee.department[0] ?? null : employee.department,
  })) as Employee[];
  const branches = ((branchData ?? []) as Branch[]).filter((branch) => ["admin", "hr", "auditor"].includes(profile.role) || branch.id === profile.branch_id);
  const attendance = (todayData ?? []) as unknown as Attendance[];
  const attendanceRequiredEmployees = employees.filter((employee) => employee.attendance_required);
  const attendanceRequiredIds = new Set(attendanceRequiredEmployees.map((employee) => employee.id));
  const requiredAttendance = attendance.filter((row) => attendanceRequiredIds.has(row.employee_id));
  const week = (weekData ?? []).filter((row) => attendanceRequiredIds.has(row.employee_id));
  const presentCount = requiredAttendance.filter((row) => ["present", "late", "on_mission"].includes(row.status)).length;
  const lateCount = requiredAttendance.filter((row) => row.status === "late").length;
  const reviewCount = requiredAttendance.filter((row) => ["needs_review", "incomplete", "absent"].includes(row.status)).length;
  const presentPercent = attendanceRequiredEmployees.length ? Math.round((presentCount / attendanceRequiredEmployees.length) * 100) : 0;
  const exceptions = requiredAttendance.filter((row) => ["needs_review", "incomplete", "absent"].includes(row.status)).slice(0, 8);
  const inboxTasks: Array<{ id: string; kind: "request" | "evaluation" | "goal" | "attendance"; title: string; detail: string; href: string; label: string; urgent: boolean }> = [];
  for (const request of managerRequests.slice(0, 5)) {
    const employee = Array.isArray(request.employee) ? request.employee[0] : request.employee;
    const eventLabel: Record<string, string> = { leave: "إجازة", permission: "إذن خروج", late_permission: "إذن تأخير", deduction: "خصم", mission: "مأمورية", new_hire: "تعيين جديد", termination: "إنهاء خدمة" };
    const employeeName = employee?.full_name || [employee?.first_name, employee?.last_name].filter(Boolean).join(" ") || "موظف";
    inboxTasks.push({ id: `request-${request.id}`, kind: "request", title: `${eventLabel[request.event_type] ?? "طلب موارد بشرية"} · ${employeeName}`, detail: `${employee?.employee_number ?? ""} · ينتظر قرارك`, href: "/effects", label: "اتخاذ قرار", urgent: true });
  }
  for (const employee of managerEvaluations.slice(0, 4)) {
    inboxTasks.push({ id: `evaluation-${employee.id}`, kind: "evaluation", title: `تقييم ${employee.name}`, detail: `${employee.employeeNumber} · تقييم هذا الشهر لم يُرسل بعد`, href: "/evaluations", label: "بدء التقييم", urgent: true });
  }
  for (const task of goalReminders.slice(0, 4)) {
    inboxTasks.push({ id: `goal-${task.id}`, kind: "goal", title: task.task, detail: `${task.employee} · ${task.goal}`, href: "/goals", label: task.overdue ? "متأخرة" : `موعدها ${toWesternDigits(task.dueDate)}`, urgent: task.overdue });
  }
  if (isHeadOffice && overdueManagementTasks > goalReminders.filter((task) => task.overdue).length) {
    inboxTasks.push({ id: "goals-overdue-summary", kind: "goal", title: "مهام أهداف متأخرة أخرى", detail: "توجد مهام تجاوزت موعدها وتحتاج متابعة", href: "/goals", label: `${toWesternDigits(overdueManagementTasks)} مهمة`, urgent: true });
  }
  if (reviewCount > 0 && roles.some((role) => ["admin", "hr", "branch_manager", "auditor", "accountant"].includes(role))) {
    inboxTasks.push({ id: "attendance-review", kind: "attendance", title: "حالات حضور تحتاج مراجعة", detail: "غياب أو بصمة ناقصة ضمن السجلات المتاحة لحسابك", href: "/attendance", label: `${toWesternDigits(reviewCount)} حالة`, urgent: true });
  }
  const inboxTaskCount = Math.max(inboxTasks.length, managerRequestCount + managerEvaluationCount + goalReminders.length + Number(reviewCount > 0));
  const hasMoreInboxTasks = managerRequests.length > 5 || managerRequestCount > managerRequests.length || managerEvaluationCount > managerEvaluations.length || goalReminders.length > 4 || inboxTasks.length > 9;
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStartDate);
    date.setDate(date.getDate() + index);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    return {
      key,
      label: new Intl.DateTimeFormat("ar-LY", { timeZone: "Africa/Tripoli", weekday: "short" }).format(date),
      present: week.filter((row) => row.attendance_date === key && ["present", "on_mission"].includes(row.status)).length,
      late: week.filter((row) => row.attendance_date === key && row.status === "late").length,
    };
  });
  const largestDay = Math.max(1, ...weekDays.map((day) => day.present + day.late));
  const todayLabel = new Intl.DateTimeFormat("ar-LY-u-nu-latn", { dateStyle: "full", timeZone: "Africa/Tripoli" }).format(now);
  const displayName = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "مدير الموارد البشرية" : profile.role === "auditor" ? "مراجع حسابات" : profile.role === "branch_manager" ? "مدير الفرع" : profile.role === "accountant" ? "محاسب" : "موظف";

  return (
    <EmployeeWorkspace userName={displayName} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="الرئيسية" initialAccessProfile={profile}>
        <div className="page-content">
          <div className="welcome-row"><div><p className="eyebrow">{todayLabel}</p><h1>الرئيسية</h1><p className="welcome-copy">نظرة عامة على شؤون الموظفين والحضور في الفروع المصرح بها لحسابك.</p></div>{profile.role !== "employee" && <Link className="primary-button" href="/employees"><span>♙</span> إدارة الموظفين</Link>}</div>

          <section className="work-inbox" aria-label="صندوق مهامك">
            <div className="work-inbox-heading"><div><span className="work-inbox-icon">✓</span><span><h2>صندوق مهامك</h2><small>الطلبات والتقييمات ومواعيد المهام التي تحتاج متابعتك</small></span></div><span className="work-inbox-count">{toWesternDigits(inboxTaskCount)} مهمة</span></div>
            {inboxTasks.length ? <div className="work-inbox-list">{inboxTasks.slice(0, 9).map((task) => <article className={`work-inbox-item ${task.kind}${task.urgent ? " urgent" : ""}`} key={task.id}>
              <span className="work-inbox-item-icon" aria-hidden="true">{task.kind === "request" ? "◷" : task.kind === "evaluation" ? "☆" : task.kind === "goal" ? "◎" : "◉"}</span>
              <span className="work-inbox-item-copy"><b>{task.title}</b><small>{task.detail}</small></span>
              <span className="work-inbox-item-label">{task.label}</span>
              <Link href={task.href} aria-label={`${task.label}: ${task.title}`}>فتح <span aria-hidden="true">←</span></Link>
            </article>)}</div> : <p className="work-inbox-empty">ما عندكش مهام مستحقة الآن. ستظهر هنا الطلبات والتقييمات ومواعيد المهام عند الحاجة.</p>}
            {hasMoreInboxTasks && <div className="work-inbox-footer">{managerRequestCount > 5 && <Link href="/effects">عرض الطلبات <span aria-hidden="true">←</span></Link>}{managerEvaluationCount > managerEvaluations.length && <Link href="/evaluations">عرض التقييمات <span aria-hidden="true">←</span></Link>}{goalReminders.length > 4 && <Link href="/goals">عرض مهام الأهداف <span aria-hidden="true">←</span></Link>}{reviewCount > 0 && <Link href="/attendance">فتح الحضور <span aria-hidden="true">←</span></Link>}</div>}
          </section>

          <div className="stats-grid">
            <article className="stat-card"><div className="stat-top"><span className="stat-label">الموظفون النشطون</span><span className="stat-icon blue">♙</span></div><div className="stat-value">{employees.length}</div><div className="stat-foot"><span>حسب بيانات قاعدة الشركة</span></div></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-label">حاضرون اليوم</span><span className="stat-icon green">✓</span></div><div className="stat-value">{presentCount} <small>موظف</small></div><div className="stat-foot"><span>من {attendanceRequiredEmployees.length} مطلوب منهم البصم</span><span className="rate">{presentPercent}%</span></div><div className="progress"><span style={{ width: `${presentPercent}%` }} /></div></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-label">تأخروا عن الدوام</span><span className="stat-icon amber">◷</span></div><div className="stat-value">{lateCount} <small>موظف</small></div><div className="stat-foot"><span>في {new Set(attendance.filter((row) => row.status === "late").map((row) => row.branch?.name).filter(Boolean)).size} فروع</span></div></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-label">حالات تحتاج مراجعة</span><span className="stat-icon rose">!</span></div><div className="stat-value">{reviewCount} <small>حالة</small></div><div className="stat-foot"><span>حسب سجلات البصمة المعتمدة</span></div></article>
          </div>

          <section className="panel workforce-panel"><div className="panel-heading"><div><h2>توزيع الموظفين حسب الصفة</h2><p>اضغط على الصفة لعرض الموظفين النشطين بها</p></div><span className="workforce-total">الإجمالي: {toWesternDigits(employees.length)}</span></div><WorkforceDistribution employees={employees} canManage={roles.some(role=>["admin","hr"].includes(role))} canAuditEvaluate={roles.includes("auditor")} /></section>

          <div className="content-grid">
            <section className="panel attendance-panel">
              <div className="panel-heading"><div><h2>ملخص الحضور</h2><p>سجلات آخر سبعة أيام</p></div><span className="select-button">هذا الأسبوع</span></div>
              <div className="chart-area"><div className="chart-y"><span>{largestDay}</span><span>{Math.ceil(largestDay * .8)}</span><span>{Math.ceil(largestDay * .6)}</span><span>{Math.ceil(largestDay * .4)}</span><span>{Math.ceil(largestDay * .2)}</span><span>0</span></div><div className="chart-main"><div className="chart-gridlines"><i/><i/><i/><i/><i/><i/></div><div className="bars">{weekDays.map((day) => <div className="bar-group" key={day.key}><div className="bar-pair"><span className="bar present" style={{ height: `${(day.present / largestDay) * 100}%` }} /><span className="bar late" style={{ height: `${(day.late / largestDay) * 100}%` }} /></div><span className="day-label">{day.label}</span></div>)}</div></div></div>
              <div className="chart-legend"><span><i className="legend-present"/> حضور</span><span><i className="legend-late"/> تأخير</span><span className="chart-note">{week.length ? "من بيانات البصمة المسجلة" : "لا توجد سجلات حضور للفترة"}</span></div>
            </section>

            <section className="panel branch-panel"><div className="panel-heading"><div><h2>الحضور حسب الفرع</h2><p>نسبة الحضور للموظفين المطلوب منهم البصم</p></div></div><div className="branch-list">{branches.length ? branches.map((branch) => { const branchEmployees = attendanceRequiredEmployees.filter((employee) => employee.branch_id === branch.id); const branchRows = requiredAttendance.filter((row) => row.branch?.name === branch.name); const branchPresent = branchRows.filter((row) => ["present", "late", "on_mission"].includes(row.status)).length; const rate = branchEmployees.length ? Math.round((branchPresent / branchEmployees.length) * 100) : 0; return <div className="branch-row" key={branch.id}><div className="branch-meta"><strong>{branch.name}</strong><span>{branchPresent} / {branchEmployees.length} مطلوب منهم البصم</span></div><div className="branch-progress"><div><span style={{ width: `${rate}%` }} /></div><b>{rate}%</b></div></div>; }) : <p className="empty-message">لا توجد فروع مسجلة أو متاحة لهذا الحساب.</p>}</div></section>
          </div>

            <section className="panel exceptions-panel"><div className="panel-heading"><div><h2>حالات البصمة التي تحتاج مراجعة</h2><p>راجع الحالات قبل اعتماد الحضور أو تسجيل أي خصم</p></div></div><div className="table-wrap"><table><thead><tr><th>الموظف</th><th>الرقم الوظيفي</th><th>الفرع</th><th>نوع الحالة</th><th>وقت الدخول</th><th>الحالة</th></tr></thead><tbody>{exceptions.length ? exceptions.map((row) => { const name = [row.employee?.first_name, row.employee?.last_name].filter(Boolean).join(" ") || "موظف"; const issue = row.exception_note || (row.status === "absent" ? "غياب مسجل" : row.status === "incomplete" ? "بصمة ناقصة" : "تحتاج مراجعة"); return <tr key={`${row.employee_id}-${row.attendance_date}`}><td><div className="employee-cell"><span className="employee-avatar">{name.charAt(0)}</span><strong>{name}</strong></div></td><td className="code-cell">{toWesternDigits(row.employee?.employee_number ?? "—")}</td><td>{row.branch?.name ?? "—"}</td><td>{toWesternDigits(issue)}</td><td className="time-cell">{formatClock(row.first_in)}</td><td><span className={`status-pill ${row.status === "absent" ? "red" : "amber"}`}>{row.status === "absent" ? "غياب" : "مراجعة مطلوبة"}</span></td></tr>; }) : <tr><td colSpan={6} className="empty-table">لا توجد حالات مراجعة مسجلة اليوم.</td></tr>}</tbody></table></div></section>
          <footer className="page-footer"><span>© {now.getFullYear()} شركة قرارة للرخام والجرانيت</span><span>نظام الموارد البشرية <b>•</b> البيانات من Supabase</span></footer>
        </div>
    </EmployeeWorkspace>
  );
}
