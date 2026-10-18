import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import ReportWorkspace, { type EmployeeReport } from "./ReportWorkspace";

export const instant = false;

export default async function ReportPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await loadAccessProfile<{ full_name: string | null; role: string; branch_id: string | null; employee_id: string | null }>(supabase, user.id, "full_name,role,branch_id,employee_id,user_roles,additional_permissions", "full_name,role,branch_id,employee_id");
  if (!profile) redirect("/setup-required");
  const roles = [...new Set([profile.role, ...((profile.user_roles as string[] | null) ?? [])])];
  const isHR = roles.some((role) => role === "admin" || role === "hr");
  const isBranchManager = roles.includes("branch_manager");
  if (!isHR && !isBranchManager && !roles.includes("employee")) redirect("/");
  const [{ data: reportData }, { data: employeeData }] = await Promise.all([
    supabase.from("employee_reports").select("id,employee_id,category,subject,message,status,hr_response,created_at,employee:employees(full_name,first_name,last_name,employee_number,branch:branches(name))").order("created_at", { ascending: false }),
    isBranchManager ? supabase.from("employees").select("id,full_name,first_name,last_name,employee_number").eq("status", "active").order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const name = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = roles.includes("admin") ? "مدير النظام" : roles.includes("hr") ? "مدير الموارد البشرية" : isBranchManager ? "مدير الفرع" : "موظف";
  return <EmployeeWorkspace userName={name} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="الإبلاغ">
    <main className="employee-app-page" dir="rtl"><section className="employee-app-welcome"><span>{isHR ? "الموارد البشرية" : isBranchManager ? "متابعة الفرع" : "تواصل معنا"}</span><h1>{isHR ? "إبلاغات الموظفين" : isBranchManager ? "بلاغات الفرع" : "الإبلاغ"}</h1><p>{isHR ? "استقبل إبلاغات الموظفين وتابع الرد والمعالجة." : isBranchManager ? "اطّلع على بلاغات فرعك وأرسل بلاغًا نيابةً عن أحد موظفيه." : "أرسل مشكلة أو ملاحظة للموارد البشرية وتابع حالتها."}</p></section>
      <ReportWorkspace isHR={isHR} isBranchManager={isBranchManager} branchEmployees={(employeeData ?? []) as { id: string; full_name: string | null; first_name: string; last_name: string | null; employee_number: string }[]} employeeId={profile.employee_id} branchId={profile.branch_id} userId={user.id} reports={(reportData ?? []) as unknown as EmployeeReport[]} />
    </main>
  </EmployeeWorkspace>;
}
