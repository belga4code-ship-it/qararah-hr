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
      .select("id,employee_id,event_type,effective_date,end_date,reason,amount,amount_unit,status,decision_reason,decision_at,approved_at,payroll_recorded_at,details,created_at,employee:employees(employee_number,first_name,last_name,full_name,branch:branches(name))")
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
    .select("id,employee_number,first_name,last_name,full_name,status,branch_id,job_title:job_titles(name),department:departments(name),branch:branches(name)")
    .order("employee_number");
  if (hasRole("branch_manager", "yard_supervisor") && !hasRole("admin", "hr", "auditor") && !extraPermissions.includes("employees.view_all")) employeesQuery = employeesQuery.eq("branch_id", profile.branch_id ?? "00000000-0000-0000-0000-000000000000");
  if (hasRole("employee") && userRoles.length === 1) employeesQuery = employeesQuery.eq("id", profile.employee_id ?? "00000000-0000-0000-0000-000000000000");

  const [{ data: employeeData }, { data: eventData }, { data: titleData }, { data: branchData }, { data: privateData }, approvalResult] = await Promise.all([
    employeesQuery,
    loadAllHREvents(supabase),
    hasRole("branch_manager") ? supabase.from("job_titles").select("id,name").order("name") : Promise.resolve({ data: [] }),
    profile.branch_id ? supabase.from("branches").select("name").eq("id", profile.branch_id).maybeSingle() : Promise.resolve({ data: null }),
    hasRole("admin", "hr") || extraPermissions.includes("employees.view_sensitive") ? supabase.from("employee_private").select("employee_id,salary_amount,phone") : Promise.resolve({ data: [] }),
    supabase.from("hr_event_approval_steps").select("id,event_id,step_order,approver_role,status,decided_by,decided_at,reason").order("step_order"),
  ]);
  const privateEmployees = new Map((privateData ?? []).map((row) => [row.employee_id, row]));
  const employeesWithSalary = (employeeData ?? []).map((employee) => ({ ...employee, salary_amount: privateEmployees.get(employee.id)?.salary_amount ?? null, phone: privateEmployees.get(employee.id)?.phone ?? null }));

  const name = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "الإدارة الرئيسية" : profile.role === "hr" ? "مدير الموارد البشرية" : profile.role === "auditor" ? "مراجع حسابات" : profile.role === "branch_manager" ? "مدير الفرع" : profile.role === "accountant" ? "محاسب" : "موظف";

  return (
    <EmployeeWorkspace userName={name} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="المؤثرات الأسبوعية">
      <main className="effects-page page-content" dir="rtl">
        <section className="effects-welcome">
          <div><p className="eyebrow">طلبات العاملين وإجراءات الفروع</p><h1>المؤثرات الأسبوعية</h1><p className="welcome-copy">قدّم الطلب، راجعه حسب صلاحيتك، وسجّل القرار والسبب في سجل الموظف.</p></div>
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
          events={(eventData ?? []) as unknown as HREvent[]}
          approvalSteps={(approvalResult.data ?? []) as ApprovalStep[]}
          approvalWorkflowAvailable={!approvalResult.error}
        />
      </main>
    </EmployeeWorkspace>
  );
}
