import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
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
  const { data: profile } = await supabase.from("profiles").select("id,full_name,role,branch_id,employee_id").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");
  const isAuditor = profile.role === "auditor";
  const isHR = profile.role === "admin" || profile.role === "hr";
  const { data: assignmentData } = await supabase
    .from("employee_evaluators")
    .select("employee_id,slot,evaluator_profile_id,evaluator_employee_id,evaluator_employee:employees!employee_evaluators_evaluator_employee_id_fkey(id,employee_number,first_name,last_name,full_name,job_title:job_titles(name),branch:branches(name))");
  const visibleAssignments = isHR ? assignmentData ?? [] : (assignmentData ?? []).filter((row) => row.evaluator_profile_id === user.id || (profile.employee_id && row.evaluator_employee_id === profile.employee_id));
  if (!isHR && !isAuditor && !visibleAssignments.length) redirect("/");
  const assignedIds = [...new Set(visibleAssignments.map((row) => row.employee_id))];

  const employeeQuery = supabase
    .from("employees")
    .select("id,employee_number,first_name,last_name,full_name,status,branch_id,job_title:job_titles(name),branch:branches(name)")
    .order("employee_number");
  const [{ data: employeeData }, { data: evaluationData }, { data: evaluatorProfiles }] = await Promise.all([
    isHR || isAuditor ? employeeQuery : assignedIds.length ? employeeQuery.in("id", assignedIds) : Promise.resolve({ data: [] }),
    supabase.from("evaluations").select("id,employee_id,period_month,evaluator_id,total_score,max_score,status,notes,evaluation_items(criterion,score,max_score,evidence)").eq("period_month", monthStart),
    isHR ? supabase.from("profiles").select("employee_id") : Promise.resolve({ data: [] }),
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
        role={profile.role}
        userId={user.id}
        profileEmployeeId={profile.employee_id}
        month={month}
        employees={employees}
        assignments={(visibleAssignments ?? []) as unknown as EvaluationAssignment[]}
        evaluators={evaluators as EvaluatorOption[]}
        evaluations={(evaluationData ?? []) as unknown as EvaluationRecord[]}
      />
    </main>
  </EmployeeWorkspace>;
}
