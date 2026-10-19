import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import GoalsWorkspace, { type Goal } from "./GoalsWorkspace";

export const instant = false;

export default async function GoalsPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await loadAccessProfile<{ full_name: string | null; role: string; branch_id: string | null; employee_id: string | null }>(supabase, user.id, "full_name,role,user_roles,additional_permissions,branch_id,employee_id", "full_name,role,branch_id,employee_id");
  if (!profile) redirect("/setup-required");
  const roles = [...new Set([profile.role, ...((profile.user_roles as string[] | null) ?? [])])];
  const permissions = (profile.additional_permissions as string[] | null) ?? [];
  const isHR = roles.some((role) => ["admin", "hr"].includes(role));
  const canManageGoals = isHR || permissions.includes("goals.manage");
  const canViewAllGoals = canManageGoals || permissions.includes("goals.view_all");
  const { error: recurrenceError } = canManageGoals
    ? await supabase.rpc("ensure_monthly_employee_goal_instances")
    : { error: null };
  const [{ data: goalData, error: goalError }, { data: employeeData }, { data: taskData, error: taskError }] = await Promise.all([
    supabase.from("employee_goals").select("id,employee_id,period_month,title,description,target_value,actual_value,target_unit,goal_revision,employee:employees(full_name,first_name,last_name,employee_number,branch:branches(name))").is("deleted_at", null).order("period_month", { ascending: false }),
    canManageGoals ? supabase.from("employees").select("id,full_name,first_name,last_name,employee_number,branch_id,department_id,branch:branches(name),department:departments(name)").eq("status", "active").order("full_name") : Promise.resolve({ data: [] }),
    supabase.from("employee_goal_tasks").select("id,goal_id,title,sort_order,is_completed,employee_note,review_status,review_note,due_date").order("sort_order"),
  ]);
  const progressAvailable = !goalError;
  const fallbackGoalData = goalError
    ? await supabase.from("employee_goals").select("id,employee_id,period_month,title,description,target_value,target_unit,goal_revision,employee:employees(full_name,first_name,last_name,employee_number,branch:branches(name))").is("deleted_at", null).order("period_month", { ascending: false })
    : null;
  const tasksByGoal = new Map<string, NonNullable<typeof taskData>[number][]>();
  for (const task of taskData ?? []) tasksByGoal.set(task.goal_id, [...(tasksByGoal.get(task.goal_id) ?? []), task]);
  const goals = (goalData ?? (fallbackGoalData?.data ?? []).map((goal) => ({ ...goal, actual_value: null }))).map(goal => ({ ...goal, tasks: tasksByGoal.get(goal.id) ?? [] }));
  const employees = (employeeData ?? []).map((employee) => {
    const branch = employee.branch as unknown as { name: string } | null;
    const department = employee.department as unknown as { name: string } | null;
    return { id: employee.id, full_name: employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" "), employee_number: employee.employee_number, branch_id: employee.branch_id, branch_name: branch?.name ?? "", department_id: employee.department_id, department_name: department?.name ?? "" };
  });
  const name = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "مدير الموارد البشرية" : profile.role === "branch_manager" ? "مدير الفرع" : profile.role === "accountant" ? "محاسب" : "موظف";
  const tasksAvailable = !taskError;
  return <EmployeeWorkspace userName={name} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="أهدافي">
    <main className="employee-app-page goals-page" dir="rtl">
      <GoalsWorkspace role={profile.role as "admin" | "hr" | "employee" | "branch_manager" | "accountant" | "auditor"} employeeId={profile.employee_id} userId={user.id} employees={employees} goals={goals as unknown as Goal[]} progressAvailable={progressAvailable} tasksAvailable={tasksAvailable} recurrenceAvailable={!recurrenceError} canViewAllGoals={canViewAllGoals} canManageGoals={canManageGoals} canEditGoals={isHR} />
    </main>
  </EmployeeWorkspace>;
}
