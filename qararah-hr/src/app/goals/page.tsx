import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import GoalsWorkspace, { type Goal } from "./GoalsWorkspace";

export const instant = false;

export default async function GoalsPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name,role,branch_id,employee_id").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");
  const isHR = profile.role === "admin" || profile.role === "hr";
  const [{ data: goalData, error: goalError }, { data: employeeData }] = await Promise.all([
    supabase.from("employee_goals").select("id,employee_id,period_month,title,description,target_value,actual_value,target_unit,employee:employees(full_name,first_name,last_name,employee_number)").order("period_month", { ascending: false }),
    isHR ? supabase.from("employees").select("id,full_name,first_name,last_name,employee_number,branch:branches(name)").eq("status", "active").order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const progressAvailable = !goalError;
  const fallbackGoalData = goalError
    ? await supabase.from("employee_goals").select("id,employee_id,period_month,title,description,target_value,target_unit,employee:employees(full_name,first_name,last_name,employee_number)").order("period_month", { ascending: false })
    : null;
  const goals = goalData ?? (fallbackGoalData?.data ?? []).map((goal) => ({ ...goal, actual_value: null }));
  const employees = (employeeData ?? []).map((employee) => {
    const branch = employee.branch as unknown as { name: string } | null;
    return { id: employee.id, full_name: employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" "), employee_number: employee.employee_number, branch_name: branch?.name ?? "" };
  });
  const name = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "مدير الموارد البشرية" : profile.role === "branch_manager" ? "مدير الفرع" : profile.role === "accountant" ? "محاسب" : "موظف";
  return <EmployeeWorkspace userName={name} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="أهدافي">
    <main className="employee-app-page" dir="rtl"><section className="employee-app-welcome"><span>متابعة الأداء</span><h1>{isHR ? "أهداف الموظفين" : "أهدافي"}</h1><p>{isHR ? "حدد أهدافًا شهرية خاصة بكل موظف." : "راجع الأهداف الشهرية المحددة لك."}</p></section>
      <GoalsWorkspace role={profile.role as "admin" | "hr" | "employee" | "branch_manager" | "accountant" | "auditor"} employeeId={profile.employee_id} userId={user.id} employees={employees} goals={goals as unknown as Goal[]} progressAvailable={progressAvailable} />
    </main>
  </EmployeeWorkspace>;
}
