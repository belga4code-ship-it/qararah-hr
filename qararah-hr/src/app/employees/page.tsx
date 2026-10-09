import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import EmployeesList, { type EmployeeListRow } from "./EmployeesList";

export const instant = false;

export default async function EmployeesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("id,role,full_name").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");

  const { data } = await supabase
    .from("employees")
    .select("id,employee_number,first_name,last_name,full_name,zkt_user_id,status,branch:branches(name),department:departments(name),job_title:job_titles(name)")
    .order("employee_number");
  const employees = (data ?? []) as unknown as EmployeeListRow[];
  const canEdit = profile.role === "admin" || profile.role === "hr";

  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "الموارد البشرية" : "مدير الفرع";
  const displayName = profile.full_name || user.email || "مستخدم النظام";

  return (
    <EmployeeWorkspace userName={displayName} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="الموظفون">
      <div className="employees-page">
      <div className="page-content">
        <div className="welcome-row"><div><p className="eyebrow">إدارة ملفات العاملين</p><h1>الموظفون</h1><p className="welcome-copy">بيانات واضحة وسهلة القراءة لكل الموظفين المسجلين.</p></div><Link className="primary-button" href="/employees/import"><span>⇧</span> استيراد موظفين</Link></div>
        <section className="panel employees-table-panel"><div className="panel-heading employees-heading"><div><h2>بيانات الموظفين</h2><p>{employees.length} موظف مسجل</p></div><span className="employees-hint">اضغط على «فتح الملف» لعرض البيانات وتعديلها</span></div><EmployeesList employees={employees} canEdit={canEdit} /></section>
      </div>
      </div>
    </EmployeeWorkspace>
  );
}
