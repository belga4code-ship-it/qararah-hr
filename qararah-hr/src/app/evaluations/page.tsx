import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import EvaluationsWorkspace, { type EvaluationAssignment, type EvaluationRecord, type EvaluatorOption, type EvaluatedEmployee } from "./EvaluationsWorkspace";

export const instant = false;

const currentMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit" }).format(new Date());

export default async function EvaluationsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await connection();
  const { month: requestedMonth } = await searchParams;
  const month = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : currentMonth();
  const monthStart = `${month}-01`;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await loadAccessProfile<{ id: string; full_name: string | null; role: string; branch_id: string | null; employee_id: string | null }>(supabase, user.id, "id,full_name,role,user_roles,additional_permissions,branch_id,employee_id", "id,full_name,role,branch_id,employee_id");
  if (!profile) redirect("/setup-required");
  const roles = [...new Set([profile.role, ...((profile.user_roles as string[] | null) ?? [])])];
  const permissions = (profile.additional_permissions as string[] | null) ?? [];
  const isAuditor = roles.includes("auditor");
  const isBranchManager = roles.includes("branch_manager");
  const isHR = roles.some((role) => ["admin", "hr"].includes(role));
  const canAssignEvaluators = isHR || permissions.includes("evaluations.assign");
  const canEvaluateAll = isAuditor || permissions.includes("evaluations.evaluate");
  const canViewAll = isHR || isAuditor || canAssignEvaluators || canEvaluateAll || permissions.includes("evaluations.view_all");
  const { data: assignmentData } = await supabase
    .from("employee_evaluators")
    .select("employee_id,slot,evaluator_profile_id,evaluator_employee_id,evaluator_employee:employees!employee_evaluators_evaluator_employee_id_fkey(id,employee_number,first_name,last_name,full_name,job_title:job_titles(name),branch:branches(name))");
  const visibleAssignments = canAssignEvaluators || isAuditor || canEvaluateAll || permissions.includes("evaluations.view_all") ? assignmentData ?? [] : (assignmentData ?? []).filter((row) => row.evaluator_profile_id === user.id || (profile.employee_id && row.evaluator_employee_id === profile.employee_id));
  if (!canViewAll && !visibleAssignments.length && !isBranchManager) redirect("/");
  const assignedIds = [...new Set(visibleAssignments.map((row) => row.employee_id))];

  const employeeQuery = supabase
    .from("employees")
    .select("id,employee_number,first_name,last_name,full_name,status,branch_id,job_title:job_titles(name),branch:branches(name)")
    .order("employee_number");
  const [{ data: employeeData }, { data: evaluationData }, { data: evaluatorProfiles }] = await Promise.all([
    canViewAll ? employeeQuery : assignedIds.length ? employeeQuery.in("id", assignedIds) : Promise.resolve({ data: [] }),
    supabase.from("evaluations").select("id,employee_id,period_month,evaluator_id,total_score,max_score,status,notes,evaluation_items(criterion,score,max_score,evidence)").eq("period_month", monthStart),
    canAssignEvaluators ? supabase.from("profiles").select("employee_id") : Promise.resolve({ data: [] }),
  ]);

  const employees = (employeeData ?? []).map((row) => {
    const job = row.job_title as unknown as { name: string } | null;
    const branch = row.branch as unknown as { name: string } | null;
    return { id: row.id, employee_number: row.employee_number, first_name: row.first_name, last_name: row.last_name, full_name: row.full_name, status: row.status, branch_id: row.branch_id, job_title_name: job?.name ?? "", branch_name: branch?.name ?? "" };
  }) as EvaluatedEmployee[];
  const linkedEmployeeIds = new Set((evaluatorProfiles ?? []).map((candidate) => candidate.employee_id).filter(Boolean));
  const evaluators = employees.filter((employee) => employee.status === "active").map((employee) => ({
    employee_id: employee.id,
    full_name: employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" "),
    job_title_name: employee.job_title_name,
    branch_name: employee.branch_name,
    has_system_account: linkedEmployeeIds.has(employee.id),
  }));

  const name = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "الإدارة الرئيسية" : profile.role === "hr" ? "مدير الموارد البشرية" : profile.role === "auditor" ? "مراجع حسابات" : profile.role === "branch_manager" ? "مدير الفرع" : profile.role === "accountant" ? "محاسب" : "موظف مقيّم";
  return <EmployeeWorkspace userName={name} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="تقييم الأداء">
    <main className="evaluations-page page-content" dir="rtl">
      <section className="evaluations-welcome"><div><p className="eyebrow">تقييم أداء الكادر الإداري</p><h1>التقييمات الشهرية</h1><p className="welcome-copy">كل مسؤول يقيّم بشكل مستقل، وتظهر النتيجة النهائية كمتوسط التقييمات المقدمة.</p></div></section>
      <EvaluationsWorkspace
        role={profile.role as "admin" | "hr" | "branch_manager" | "accountant" | "employee" | "auditor"}
        userId={user.id}
        profileEmployeeId={profile.employee_id}
        month={month}
        employees={employees}
        assignments={(visibleAssignments ?? []) as unknown as EvaluationAssignment[]}
        evaluators={evaluators as EvaluatorOption[]}
        evaluations={(evaluationData ?? []) as unknown as EvaluationRecord[]}
        canAssignEvaluators={canAssignEvaluators}
        canEvaluateAll={canEvaluateAll}
        isBranchManager={isBranchManager}
      />
    </main>
  </EmployeeWorkspace>;
}
