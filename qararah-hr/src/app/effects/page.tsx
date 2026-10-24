import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import EffectsWorkspace, { type ApprovalStep, type EffectEmployee, type HREvent } from "./EffectsWorkspace";

export const instant = false;

async function loadAllHREvents(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: unknown[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("hr_events")
      .select("id,employee_id,event_type,effective_date,end_date,reason,amount,amount_unit,status,report_revision,report_edit_reason,report_edited_at,report_edited_by,decision_reason,decision_by,decision_at,approved_by,approved_at,payroll_recorded_at,details,created_at,created_by,employee:employees(employee_number,first_name,last_name,full_name,manager_id,branch:branches(name))")
      .order("effective_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: rows };
}

export default async function EffectsPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await loadAccessProfile<{ full_name: string | null; role: string; branch_id: string | null; employee_id: string | null }>(supabase, user.id, "full_name,role,branch_id,employee_id,user_roles,additional_permissions", "full_name,role,branch_id,employee_id");
  if (!profile) redirect("/setup-required");
  const userRoles = [...new Set([profile.role, ...((profile.user_roles as string[] | null) ?? [])])];
  const extraPermissions = (profile.additional_permissions as string[] | null) ?? [];
  const hasRole = (...roles: string[]) => roles.some((role) => userRoles.includes(role));
  if (!hasRole("admin", "hr", "branch_manager", "employee", "auditor", "accountant", "yard_supervisor") && !extraPermissions.some((permission) => permission.startsWith("effects."))) redirect("/");

  let employeesQuery = supabase
    .from("employees")
    .select("id,employee_number,first_name,last_name,full_name,phone,status,branch_id,manager_id,job_title:job_titles(name),department:departments(name),branch:branches(name)")
    .order("employee_number");
  if (hasRole("branch_manager", "yard_supervisor") && !hasRole("admin", "hr", "auditor") && !extraPermissions.includes("employees.view_all")) employeesQuery = employeesQuery.eq("branch_id", profile.branch_id ?? "00000000-0000-0000-0000-000000000000");

  const [{ data: employeeData }, { data: eventData }, { data: titleData }, { data: branchData }, { data: privateData }, approvalResult] = await Promise.all([
    employeesQuery,
    loadAllHREvents(supabase),
    hasRole("branch_manager") ? supabase.from("job_titles").select("id,name").order("name") : Promise.resolve({ data: [] }),
    profile.branch_id ? supabase.from("branches").select("name").eq("id", profile.branch_id).maybeSingle() : Promise.resolve({ data: null }),
    hasRole("admin", "hr") || extraPermissions.includes("employees.view_sensitive") ? supabase.from("employee_private").select("employee_id,salary_amount,phone") : Promise.resolve({ data: [] }),
    supabase.from("hr_event_approval_steps").select("id,event_id,step_order,approver_role,approver_profile_id,approver_profile_ids,status,decided_by,decided_at,reason").order("step_order"),
  ]);
  const loadedEvents = (eventData ?? []) as unknown as HREvent[];
  const eventIds = loadedEvents.map((event) => event.id);
  const { data: requesterRows } = eventIds.length
    ? await supabase.rpc("get_hr_event_requesters", { p_event_ids: eventIds })
    : { data: [] };
  const requesterRecords = (requesterRows ?? []) as Array<{ event_id: string; full_name: string | null; role: string | null; user_roles: string[] | null; employee_id: string | null }>;
  const requestersByEvent = new Map(requesterRecords.map((requester) => [requester.event_id, requester] as const));
  const eventsWithRequesters = loadedEvents.map((event) => ({ ...event, requester: requestersByEvent.get(event.id) ?? null }));
  // Resolve only profiles referenced by requests already visible through RLS.
  const printProfileIds = [...new Set(loadedEvents.flatMap((event) => [
    ...(Array.isArray(event.details?.responsible_profile_ids) ? event.details.responsible_profile_ids.filter((id): id is string => typeof id === "string") : []),
    ...(typeof event.details?.responsible_profile_id === "string" ? [event.details.responsible_profile_id] : []),
    event.decision_by, event.approved_by, event.report_edited_by,
  ]).concat((approvalResult.data ?? []).flatMap((step) => [step.decided_by, step.approver_profile_id, ...(step.approver_profile_ids ?? [])])).filter((id): id is string => Boolean(id)))];
  const { data: printProfiles } = printProfileIds.length ? await supabase.from("profiles").select("id,full_name").in("id", printProfileIds) : { data: [] };
  const approvalNames = Object.fromEntries((printProfiles ?? []).map((row) => [row.id, row.full_name || "مسؤول غير مسمى"]));
  const privateEmployees = new Map((privateData ?? []).map((row) => [row.employee_id, row]));
  const employeesWithSalary = (employeeData ?? []).map((employee) => ({ ...employee, salary_amount: privateEmployees.get(employee.id)?.salary_amount ?? null, phone: privateEmployees.get(employee.id)?.phone ?? employee.phone ?? null }));

  const name = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "الإدارة الرئيسية" : profile.role === "hr" ? "مدير الموارد البشرية" : profile.role === "auditor" ? "مراجع حسابات" : profile.role === "branch_manager" ? "مدير الفرع" : profile.role === "accountant" ? "محاسب" : "موظف";

  return (
    <EmployeeWorkspace userName={name} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="الطلبات والقرارات" initialAccessProfile={profile}>
      <main className="effects-page page-content" dir="rtl">
        <section className="effects-welcome">
          <div><p className="eyebrow">متابعة الطلبات وإجراءات الفروع</p><h1>الطلبات والقرارات</h1><p className="welcome-copy">قدّم الطلب، راجعه حسب صلاحيتك، وسجّل القرار والسبب في سجل الموظف.</p></div>
          {branchData?.name && <span className="effects-branch">{branchData.name}</span>}
        </section>
        <EffectsWorkspace
          role={profile.role as "admin" | "hr" | "branch_manager" | "employee" | "auditor" | "accountant"}
          userRoles={userRoles}
          extraPermissions={extraPermissions}
          userId={user.id}
          employeeId={profile.employee_id}
          branchId={profile.branch_id}
          employees={employeesWithSalary as unknown as EffectEmployee[]}
          jobTitles={(titleData ?? []) as { id: string; name: string }[]}
          events={eventsWithRequesters as unknown as HREvent[]}
          approvalNames={approvalNames}
          approvalSteps={(approvalResult.data ?? []) as ApprovalStep[]}
          approvalWorkflowAvailable={!approvalResult.error}
        />
      </main>
    </EmployeeWorkspace>
  );
}
