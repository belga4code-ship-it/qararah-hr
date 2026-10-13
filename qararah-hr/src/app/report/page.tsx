import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import ReportWorkspace, { type EmployeeReport } from "./ReportWorkspace";

export const instant = false;

export default async function ReportPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name,role,branch_id,employee_id").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");
  const isHR = profile.role === "admin" || profile.role === "hr";
  if (!isHR && profile.role !== "employee") redirect("/");
  const { data: reportData } = await supabase.from("employee_reports").select("id,employee_id,category,subject,message,status,hr_response,created_at,employee:employees(full_name,first_name,last_name,employee_number,branch:branches(name))").order("created_at", { ascending: false });
  const name = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "مدير الموارد البشرية" : "موظف";
  return <EmployeeWorkspace userName={name} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="الإبلاغ">
    <main className="employee-app-page" dir="rtl"><section className="employee-app-welcome"><span>{isHR ? "الموارد البشرية" : "تواصل معنا"}</span><h1>{isHR ? "إبلاغات الموظفين" : "الإبلاغ"}</h1><p>{isHR ? "استقبل إبلاغات الموظفين وتابع الرد والمعالجة." : "أرسل مشكلة أو ملاحظة للموارد البشرية وتابع حالتها."}</p></section>
      <ReportWorkspace isHR={isHR} employeeId={profile.employee_id} branchId={profile.branch_id} userId={user.id} reports={(reportData ?? []) as unknown as EmployeeReport[]} />
    </main>
  </EmployeeWorkspace>;
}
