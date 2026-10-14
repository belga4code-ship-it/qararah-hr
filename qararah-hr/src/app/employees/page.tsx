import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import EmployeesList, { type EmployeeListRow } from "./EmployeesList";

export const instant = false;

export default async function EmployeesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await loadAccessProfile<{ id: string; role: string; full_name: string | null }>(supabase, user.id, "id,role,user_roles,full_name,additional_permissions", "id,role,full_name");
  if (!profile) redirect("/setup-required");
  const permissions = (profile.additional_permissions as string[] | null) ?? [];
  const roles = [...new Set([profile.role, ...((profile.user_roles as string[] | null) ?? [])])];
  const hasRole = (...keys: string[]) => keys.some((key) => roles.includes(key));
  const canViewAll = hasRole("admin", "hr", "branch_manager", "auditor") || permissions.includes("employees.view_all") || permissions.includes("employees.edit") || permissions.includes("employees.manage_accounts");
  if (!canViewAll) redirect("/");

  const { data } = await supabase
    .from("employees")
    .select("id,employee_number,first_name,last_name,full_name,zkt_user_id,status,branch:branches(name),department:departments(name),job_title:job_titles(name)")
    .order("employee_number");
  const employees = (data ?? []) as unknown as EmployeeListRow[];
  const canEdit = hasRole("admin", "hr") || permissions.includes("employees.edit");

  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "مدير الموارد البشرية" : profile.role === "auditor" ? "مراجع حسابات" : profile.role === "accountant" ? "محاسب" : profile.role === "branch_manager" ? "مدير الفرع" : "موظف";
  const displayName = profile.full_name || user.email || "مستخدم النظام";

  return (
    <EmployeeWorkspace userName={displayName} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="الموظفون">
      <div className="employees-page">
      <div className="page-content">
        <div className="welcome-row"><div><p className="eyebrow">إدارة ملفات العاملين</p><h1>الموظفون</h1><p className="welcome-copy">بيانات واضحة وسهلة القراءة لكل الموظفين المسجلين.</p></div>{canEdit && <Link className="primary-button" href="/employees/import"><span>⇧</span> استيراد موظفين</Link>}</div>
        <section className="panel employees-table-panel"><div className="panel-heading employees-heading"><div><h2>بيانات الموظفين</h2><p>{employees.length} موظف مسجل</p></div><span className="employees-hint">اضغط على «فتح الملف» لعرض البيانات وتعديلها</span></div><EmployeesList employees={employees} canEdit={canEdit} /></section>
      </div>
      </div>
    </EmployeeWorkspace>
  );
}
