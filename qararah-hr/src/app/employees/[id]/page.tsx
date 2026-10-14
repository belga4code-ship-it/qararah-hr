import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import EmployeeEditor, { type EditValues } from "./EmployeeEditor";
import EmployeeCredentials from "./EmployeeCredentials";
import { toWesternDigits } from "@/lib/digits";

export const instant = false;

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await loadAccessProfile<{ id: string; role: string; full_name: string | null }>(supabase, user.id, "id,role,user_roles,full_name,additional_permissions", "id,role,full_name");
  if (!profile) redirect("/setup-required");
  const suppliedPermissions = (profile.additional_permissions as string[] | null) ?? [];
  const roles = [...new Set([profile.role, ...((profile.user_roles as string[] | null) ?? [])])];
  const hasRole = (...keys: string[]) => keys.some((key) => roles.includes(key));
  if (!hasRole("admin", "hr", "branch_manager", "auditor") && !suppliedPermissions.some((permission) => permission.startsWith("employees."))) redirect("/");
  const extraPermissions = suppliedPermissions;
  const canEdit = hasRole("admin", "hr") || extraPermissions.includes("employees.edit");
  const canManageAccounts = hasRole("admin", "hr") || extraPermissions.includes("employees.manage_accounts");
  const accountReader = canManageAccounts && !hasRole("admin", "hr") ? createAdminClient() : supabase;
  const employeeAccountQuery = canManageAccounts ? (async () => {
    const extended = await accountReader.from("profiles").select("username,role,user_roles,additional_permissions").eq("employee_id", id).maybeSingle();
    if (extended.data || !extended.error || !/user_roles|additional_permissions/i.test(extended.error.message)) return extended;
    return accountReader.from("profiles").select("username,role").eq("employee_id", id).maybeSingle();
  })() : Promise.resolve({ data: null, error: null });

  const [{ data: employee }, { data: branches }, { data: departments }, { data: titles }, { data: employeeAccount }] = await Promise.all([
    supabase.from("employees").select("id,employee_number,first_name,last_name,full_name,zkt_user_id,status,hired_on,branch_id,department_id,job_title_id,branch:branches(name),department:departments(name),job_title:job_titles(name)").eq("id", id).maybeSingle(),
    canEdit ? supabase.from("branches").select("id,name").order("name") : Promise.resolve({ data: [] }),
    canEdit ? supabase.from("departments").select("id,name").order("name") : Promise.resolve({ data: [] }),
    canEdit ? supabase.from("job_titles").select("id,name,department_id").order("name") : Promise.resolve({ data: [] }),
    employeeAccountQuery,
  ]);
  if (!employee) notFound();
  const { data: privateRow } = canEdit ? await supabase.from("employee_private").select("salary_amount,salary_updated_on,education,graduation_year,date_of_birth,religion,marital_status,blood_type,residency_expires_on,phone,emergency_phone,emergency_contact_name,passport_number,entered_libya_on,home_country,address,notes,source_data").eq("employee_id", id).maybeSingle() : { data: null };

  const rel = employee as unknown as { branch: { name: string } | null; department: { name: string } | null; job_title: { name: string } | null };
  const privateData = (privateRow ?? {}) as Record<string, unknown>;
  const sourceData = (privateData.source_data ?? {}) as Record<string, string | number | null>;
  const values: EditValues = {
    employee_number: employee.employee_number ?? "", full_name: employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" "), zkt_user_id: employee.zkt_user_id ?? "", status: employee.status ?? "needs_review", hired_on: employee.hired_on ?? "", branch_name: rel.branch?.name ?? "", department_name: rel.department?.name ?? "", job_title_name: rel.job_title?.name ?? "", phone: String(privateData.phone ?? ""), salary_amount: String(privateData.salary_amount ?? ""), salary_updated_on: String(privateData.salary_updated_on ?? ""), education: String(privateData.education ?? ""), graduation_year: String(privateData.graduation_year ?? ""), date_of_birth: String(privateData.date_of_birth ?? ""), religion: String(privateData.religion ?? ""), marital_status: String(privateData.marital_status ?? ""), blood_type: String(privateData.blood_type ?? ""), residency_expires_on: String(privateData.residency_expires_on ?? ""), emergency_phone: String(privateData.emergency_phone ?? ""), emergency_contact_name: String(privateData.emergency_contact_name ?? ""), passport_number: String(privateData.passport_number ?? ""), entered_libya_on: String(privateData.entered_libya_on ?? ""), home_country: String(privateData.home_country ?? ""), address: String(privateData.address ?? ""), notes: String(privateData.notes ?? ""), source_data: sourceData,
  };

  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "مدير الموارد البشرية" : profile.role === "auditor" ? "مراجع حسابات" : profile.role === "accountant" ? "محاسب" : profile.role === "branch_manager" ? "مدير الفرع" : "موظف";
  const displayName = profile.full_name || user.email || "مستخدم النظام";
  const account = employeeAccount as { username?: string | null; role?: string | null; user_roles?: string[] | null; additional_permissions?: string[] | null } | null;
  return <EmployeeWorkspace userName={displayName} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="ملف الموظف"><div className="employees-page"><div className="page-content employee-detail-content"><div className="employee-detail-top"><div><p className="eyebrow">ملف الموظف</p><h1>{values.full_name}</h1><p className="welcome-copy">الكود الوظيفي: <b dir="ltr">{toWesternDigits(employee.employee_number)}</b></p></div><Link href="/employees" className="secondary-button">→　العودة إلى القائمة</Link></div><EmployeeEditor employeeId={employee.id} initialValues={values} canEdit={canEdit} branches={(branches ?? []) as {id:string;name:string}[]} departments={(departments ?? []) as {id:string;name:string}[]} jobTitles={(titles ?? []) as {id:string;name:string;department_id:string|null}[]} />{canManageAccounts && <EmployeeCredentials employeeId={employee.id} initialUsername={account?.username ?? ""} initialRole={account?.role ?? "employee"} initialRoles={account?.user_roles ?? [account?.role ?? "employee"]} initialPermissions={account?.additional_permissions ?? []} initialBranchId={employee.branch_id} branches={(branches ?? []) as {id:string;name:string}[]} canAssignAdmin={hasRole("admin")} />}</div></div></EmployeeWorkspace>;
}
