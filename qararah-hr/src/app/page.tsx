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
  const isBranchManager = roles.includes("branch_manager");
  const isHeadOffice = roles.some((role) => ["admin", "hr"].includes(role));

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

  let managerRequests: PendingRequest[] = [];
  let managerEvaluations: Array<{ id: string; name: string; employeeNumber: string }> = [];
  let pendingManagementRequests = 0;
  let overdueManagementTasks = 0;
  let goalReminders: Array<{ id: string; task: string; goal: string; employee: string; employeeNumber: string; dueDate: string; overdue: boolean }> = [];
  const reminderEndDate = new Date(`${today}T12:00:00Z`);
  reminderEndDate.setUTCDate(reminderEndDate.getUTCDate() + 7);
  const reminderEnd = reminderEndDate.toISOString().slice(0, 10);
  const { data: reminderData } = await supabase.from("employee_goal_tasks")
    .select("id,title,due_date,goal:employee_goals!inner(title,employee:employees!inner(full_name,first_name,last_name,employee_number))")
    .eq("is_completed", false).not("due_date", "is", null).lte("due_date", reminderEnd).order("due_date").limit(12);
  goalReminders = ((reminderData ?? []) as unknown as GoalReminder[]).filter((task): task is GoalReminder & { due_date: string } => Boolean(task.due_date)).map((task) => {
    const goal = Array.isArray(task.goal) ? task.goal[0] : task.goal;
    const employee = goal && Array.isArray(goal.employee) ? goal.employee[0] : goal?.employee;
    return { id: task.id, task: task.title, goal: goal?.title ?? "هدف", employee: employee?.full_name || [employee?.first_name, employee?.last_name].filter(Boolean).join(" ") || "موظف", employeeNumber: employee?.employee_number ?? "", dueDate: task.due_date, overdue: task.due_date < today };
  });
  if (isHeadOffice) {
    const [{ count: pendingCount }, { count: overdueCount }] = await Promise.all([
      supabase.from("hr_events").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("employee_goal_tasks").select("id", { count: "exact", head: true }).eq("is_completed", false).not("due_date", "is", null).lt("due_date", today),
    ]);
    pendingManagementRequests = pendingCount ?? 0;
    overdueManagementTasks = overdueCount ?? 0;
  }
  if (isBranchManager && profile.branch_id) {
    const monthStart = `${new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit" }).format(now)}-01`;
    const [{ data: requestData }, { data: assignmentData }] = await Promise.all([
      supabase.from("hr_events").select("id,event_type,details,created_at,employee:employees!inner(full_name,first_name,last_name,employee_number,branch_id)").eq("branch_id", profile.branch_id).eq("status", "pending").in("event_type", ["leave", "permission", "late_permission"]).order("created_at", { ascending: false }).limit(30),
      supabase.from("employee_evaluators").select("employee_id,evaluator_profile_id,evaluator_employee_id").or(`evaluator_profile_id.eq.${user.id}${profile.employee_id ? `,evaluator_employee_id.eq.${profile.employee_id}` : ""}`),
    ]);
    const requests = (requestData ?? []) as unknown as PendingRequest[];
    if (requests.length) {
      const { data: approvalData } = await supabase.from("hr_event_approval_steps").select("event_id,step_order,status,approver_profile_id,approver_profile_ids").in("event_id", requests.map((request) => request.id)).eq("status", "pending");
      const activeRequestIds = new Set((approvalData ?? []).filter((step) => step.approver_profile_id === user.id || ((step.approver_profile_ids as string[] | null) ?? []).includes(user.id)).map((step) => step.event_id));
      managerRequests = requests.filter((request) => activeRequestIds.has(request.id)).slice(0, 5);
    }
    const ownAssignments = (assignmentData ?? []).filter((row) => row.evaluator_profile_id === user.id || (profile.employee_id && row.evaluator_employee_id === profile.employee_id));
    const assignedIds = [...new Set(ownAssignments.map((row) => row.employee_id))];
    if (assignedIds.length) {
      const [{ data: assignedEmployees }, { data: submittedEvaluations }] = await Promise.all([
        supabase.from("employees").select("id,full_name,first_name,last_name,employee_number").in("id", assignedIds).eq("branch_id", profile.branch_id).eq("status", "active").order("employee_number").limit(100),
        supabase.from("evaluations").select("employee_id").eq("period_month", monthStart).eq("evaluator_id", user.id).eq("status", "submitted").in("employee_id", assignedIds),
      ]);
      const evaluatedIds = new Set((submittedEvaluations ?? []).map((row) => row.employee_id));
      managerEvaluations = (assignedEmployees ?? []).filter((employee) => !evaluatedIds.has(employee.id)).slice(0, 5).map((employee) => ({ id: employee.id, name: employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" "), employeeNumber: employee.employee_number }));
    }
  }

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

          {isHeadOffice && <section className="management-priority-grid" aria-label="لوحة متابعة الإدارة">
            <Link href="/effects" className="management-priority-card"><span className="management-priority-icon amber">◷</span><span><b>طلبات معلّقة</b><small>افتح الطلبات واتخذ الإجراء</small></span><strong>{pendingManagementRequests}</strong><i>←</i></Link>
            <Link href="/goals" className="management-priority-card"><span className="management-priority-icon rose">!</span><span><b>مهام أهداف متأخرة</b><small>راجع المهام التي تجاوزت موعدها</small></span><strong>{overdueManagementTasks}</strong><i>←</i></Link>
            <Link href="/attendance" className="management-priority-card"><span className="management-priority-icon blue">◉</span><span><b>حالات حضور للمراجعة</b><small>غياب أو بصمة ناقصة اليوم</small></span><strong>{reviewCount}</strong><i>←</i></Link>
          </section>}

          {goalReminders.length > 0 && <section className="goal-reminders-panel" aria-label="تنبيهات مواعيد مهام الأهداف">
            <div className="goal-reminders-heading"><div><span className="goal-reminders-icon">◷</span><span><h2>تنبيهات مواعيد المهام</h2><small>المهام المتأخرة أو التي يحين موعدها خلال أسبوع</small></span></div><Link href="/goals">متابعة الأهداف ←</Link></div>
            <div className="goal-reminders-list">{goalReminders.slice(0, 5).map((task) => <article key={task.id} className={task.overdue ? "overdue" : "upcoming"}><span><b>{task.task}</b><small>{task.employee} · {task.goal}</small></span><strong>{task.overdue ? "متأخرة" : `موعدها ${toWesternDigits(task.dueDate)}`}</strong></article>)}</div>
          </section>}

          {isBranchManager && <section className="manager-priority-grid" aria-label="أولويات مدير الفرع">
            <article className="manager-priority-card manager-requests-card">
              <div className="manager-priority-heading"><div><span className="manager-priority-icon">◷</span><div><h2>طلبات تنتظر قرارك</h2><p>الإجازات والأذونات والتأخير في فرعك</p></div></div><strong>{managerRequests.length}</strong></div>
              {managerRequests.length ? <ul className="manager-priority-list">{managerRequests.map((request) => {
                const employee = Array.isArray(request.employee) ? request.employee[0] : request.employee;
                const label = request.event_type === "leave" ? "إجازة" : request.event_type === "permission" ? "إذن خروج" : "تأخير";
                const employeeName = employee?.full_name || [employee?.first_name, employee?.last_name].filter(Boolean).join(" ") || "موظف";
                return <li key={request.id}><span><b>{label}</b><small>{employeeName} · {employee?.employee_number ?? ""}</small></span><Link href="/effects">مراجعة <span aria-hidden="true">←</span></Link></li>;
              })}</ul> : <p className="manager-priority-empty">لا توجد طلبات معلّقة تحتاج قرارك الآن.</p>}
              <Link className="manager-priority-footer" href="/effects">فتح الطلبات والقرارات <span aria-hidden="true">←</span></Link>
            </article>
            <article className="manager-priority-card manager-evaluations-card">
              <div className="manager-priority-heading"><div><span className="manager-priority-icon">☆</span><div><h2>تقييمات هذا الشهر</h2><p>الموظفون المكلّف بتقييمهم في فرعك</p></div></div><strong>{managerEvaluations.length}</strong></div>
              {managerEvaluations.length ? <ul className="manager-priority-list">{managerEvaluations.map((employee) => <li key={employee.id}><span><b>{employee.name}</b><small>{employee.employeeNumber}</small></span><Link href="/evaluations">تقييم <span aria-hidden="true">←</span></Link></li>)}</ul> : <p className="manager-priority-empty">لا توجد تقييمات معلّقة لك هذا الشهر.</p>}
              <Link className="manager-priority-footer" href="/evaluations">فتح شاشة التقييمات <span aria-hidden="true">←</span></Link>
            </article>
          </section>}

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
