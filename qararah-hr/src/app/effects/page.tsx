import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import EffectsWorkspace, { type EffectEmployee, type HREvent } from "./EffectsWorkspace";

export const instant = false;

export default async function EffectsPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name,role,branch_id,employee_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) redirect("/setup-required");
  if (!(profile.role === "admin" || profile.role === "hr" || profile.role === "branch_manager" || profile.role === "employee")) redirect("/");

  let employeesQuery = supabase
    .from("employees")
    .select("id,employee_number,first_name,last_name,full_name,status,branch_id,job_title:job_titles(name),branch:branches(name)")
    .order("employee_number");
  if (profile.role === "branch_manager") employeesQuery = employeesQuery.eq("branch_id", profile.branch_id ?? "00000000-0000-0000-0000-000000000000");
  if (profile.role === "employee") employeesQuery = employeesQuery.eq("id", profile.employee_id ?? "00000000-0000-0000-0000-000000000000");

  const [{ data: employeeData }, { data: eventData }, { data: titleData }, { data: branchData }, { data: privateData }] = await Promise.all([
    employeesQuery,
    supabase.from("hr_events").select("id,employee_id,event_type,effective_date,end_date,reason,amount,amount_unit,status,decision_reason,decision_at,payroll_recorded_at,details,created_at,employee:employees(employee_number,first_name,last_name,full_name,branch:branches(name))").order("effective_date", { ascending: false }).order("created_at", { ascending: false }),
    profile.role === "branch_manager" ? supabase.from("job_titles").select("id,name").order("name") : Promise.resolve({ data: [] }),
    profile.branch_id ? supabase.from("branches").select("name").eq("id", profile.branch_id).maybeSingle() : Promise.resolve({ data: null }),
    profile.role === "admin" || profile.role === "hr" ? supabase.from("employee_private").select("employee_id,salary_amount") : Promise.resolve({ data: [] }),
  ]);
  const salaries = new Map((privateData ?? []).map((row) => [row.employee_id, row.salary_amount]));
  const employeesWithSalary = (employeeData ?? []).map((employee) => ({ ...employee, salary_amount: salaries.get(employee.id) ?? null }));

  const name = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "الإدارة الرئيسية" : profile.role === "hr" ? "الموارد البشرية" : profile.role === "branch_manager" ? "مدير الفرع" : "موظف";

  return (
    <EmployeeWorkspace userName={name} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="المؤثرات الأسبوعية">
      <main className="effects-page page-content" dir="rtl">
        <section className="effects-welcome">
          <div><p className="eyebrow">طلبات العاملين وإجراءات الفروع</p><h1>المؤثرات الأسبوعية</h1><p className="welcome-copy">قدّم الطلب، راجعه حسب صلاحيتك، وسجّل القرار والسبب في سجل الموظف.</p></div>
          {branchData?.name && <span className="effects-branch">{branchData.name}</span>}
        </section>
        <EffectsWorkspace
          role={profile.role}
          userId={user.id}
          employeeId={profile.employee_id}
          branchId={profile.branch_id}
          employees={employeesWithSalary as unknown as EffectEmployee[]}
          jobTitles={(titleData ?? []) as { id: string; name: string }[]}
          events={(eventData ?? []) as unknown as HREvent[]}
        />
      </main>
    </EmployeeWorkspace>
  );
}
