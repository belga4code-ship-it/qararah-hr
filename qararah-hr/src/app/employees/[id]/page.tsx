import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import type { EditValues } from "./EmployeeEditor";
import EmployeeProfileTabs from "./EmployeeProfileTabs";
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
  const canAssignResponsibilities = hasRole("admin", "hr");
  const accountReader = canManageAccounts && !hasRole("admin", "hr") ? createAdminClient() : supabase;
  const employeeAccountQuery = canManageAccounts ? (async () => {
    const extended = await accountReader.from("profiles").select("username,role,user_roles,additional_permissions").eq("employee_id", id).maybeSingle();
    if (extended.data || !extended.error || !/user_roles|additional_permissions/i.test(extended.error.message)) return extended;
    return accountReader.from("profiles").select("username,role").eq("employee_id", id).maybeSingle();
  })() : Promise.resolve({ data: null, error: null });
  const profileOptionsQuery = canAssignResponsibilities ? (async () => {
    const extended = await supabase.from("profiles").select("id,employee_id,full_name,role,user_roles,additional_permissions").not("employee_id", "is", null);
    if (extended.data || !extended.error || !/user_roles|additional_permissions/i.test(extended.error.message)) return extended;
    return supabase.from("profiles").select("id,employee_id,full_name,role").not("employee_id", "is", null);
  })() : Promise.resolve({ data: [] });

  const [{ data: employee }, { data: branches }, { data: departments }, { data: titles }, { data: employeeAccount }, { data: evaluatorRows }, { data: profileRows }, { data: responsibleRows }] = await Promise.all([
    supabase.from("employees").select("id,employee_number,first_name,last_name,full_name,zkt_user_id,status,hired_on,attendance_required,branch_id,department_id,job_title_id,manager_id,branch:branches(name),department:departments(name),job_title:job_titles(name)").eq("id", id).maybeSingle(),
    canEdit ? supabase.from("branches").select("id,name").order("name") : Promise.resolve({ data: [] }),
    canEdit ? supabase.from("departments").select("id,name").order("name") : Promise.resolve({ data: [] }),
    canEdit ? supabase.from("job_titles").select("id,name,department_id").order("name") : Promise.resolve({ data: [] }),
    employeeAccountQuery,
    canAssignResponsibilities ? supabase.from("employee_evaluators").select("slot,evaluator_profile_id").eq("employee_id", id).order("slot") : Promise.resolve({ data: [] }),
    profileOptionsQuery,
    canAssignResponsibilities ? supabase.from("employee_request_responsibles").select("profile_id,slot").eq("employee_id", id).order("slot") : Promise.resolve({ data: [] }),
  ]);
  if (!employee) notFound();
  const [{ data: goalRows, error: goalRowsError }, { data: evaluationRows }, { data: requestRows }] = await Promise.all([
    supabase.from("employee_goals").select("id,period_month,title,target_value,actual_value,target_unit").eq("employee_id", id).is("deleted_at", null).order("period_month", { ascending: false }).limit(12),
    supabase.from("evaluations").select("id,period_month,total_score,max_score,status,notes").eq("employee_id", id).order("period_month", { ascending: false }).limit(12),
    supabase.from("hr_events").select("id,event_type,effective_date,end_date,status,reason,decision_reason,created_at").eq("employee_id", id).order("created_at", { ascending: false }).limit(12),
  ]);
  const visibleGoalRows = goalRowsError && /actual_value/i.test(goalRowsError.message)
    ? (await supabase.from("employee_goals").select("id,period_month,title,target_value,target_unit").eq("employee_id", id).is("deleted_at", null).order("period_month", { ascending: false }).limit(12)).data?.map((goal) => ({ ...goal, actual_value: null })) ?? []
    : goalRows ?? [];
  const { data: privateRow } = canEdit ? await supabase.from("employee_private").select("salary_amount,salary_updated_on,education,graduation_year,date_of_birth,religion,marital_status,blood_type,residency_expires_on,phone,emergency_phone,emergency_contact_name,passport_number,entered_libya_on,home_country,address,notes,source_data").eq("employee_id", id).maybeSingle() : { data: null };

  const rel = employee as unknown as { branch: { name: string } | null; department: { name: string } | null; job_title: { name: string } | null };
  const privateData = (privateRow ?? {}) as Record<string, unknown>;
  const sourceData = (privateData.source_data ?? {}) as Record<string, string | number | null>;
  const values: EditValues = {
    employee_number: employee.employee_number ?? "", full_name: employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" "), zkt_user_id: employee.zkt_user_id ?? "", status: employee.status ?? "needs_review", hired_on: employee.hired_on ?? "", attendance_required: employee.attendance_required ?? true, branch_name: rel.branch?.name ?? "", department_name: rel.department?.name ?? "", job_title_name: rel.job_title?.name ?? "", phone: String(privateData.phone ?? ""), salary_amount: String(privateData.salary_amount ?? ""), salary_updated_on: String(privateData.salary_updated_on ?? ""), education: String(privateData.education ?? ""), graduation_year: String(privateData.graduation_year ?? ""), date_of_birth: String(privateData.date_of_birth ?? ""), religion: String(privateData.religion ?? ""), marital_status: String(privateData.marital_status ?? ""), blood_type: String(privateData.blood_type ?? ""), residency_expires_on: String(privateData.residency_expires_on ?? ""), emergency_phone: String(privateData.emergency_phone ?? ""), emergency_contact_name: String(privateData.emergency_contact_name ?? ""), passport_number: String(privateData.passport_number ?? ""), entered_libya_on: String(privateData.entered_libya_on ?? ""), home_country: String(privateData.home_country ?? ""), address: String(privateData.address ?? ""), notes: String(privateData.notes ?? ""), source_data: sourceData,
  };

  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "مدير الموارد البشرية" : profile.role === "auditor" ? "مراجع حسابات" : profile.role === "accountant" ? "محاسب" : profile.role === "branch_manager" ? "مدير الفرع" : "موظف";
  const displayName = profile.full_name || user.email || "مستخدم النظام";
  const account = employeeAccount as { username?: string | null; role?: string | null; user_roles?: string[] | null; additional_permissions?: string[] | null } | null;
  const linkedProfiles = (profileRows ?? []) as Array<{ id: string; employee_id: string | null; full_name: string | null; role: string; user_roles?: string[] | null; additional_permissions?: string[] | null }>;
  const managers = linkedProfiles.filter((item) => item.employee_id).map((item) => ({ profileId: item.id, employeeId: item.employee_id!, name: item.full_name || `الموظف ${item.employee_id}` }));
  const initialResponsibleIds = ((responsibleRows ?? []) as Array<{ profile_id: string; slot: number }>).sort((a, b) => a.slot - b.slot).map((item) => item.profile_id);
  if (!initialResponsibleIds.length && employee.manager_id) initialResponsibleIds.push(...managers.filter((item) => item.employeeId === employee.manager_id).slice(0, 1).map((item) => item.profileId));
  const eligibleEvaluators = linkedProfiles.filter((item) => {
    const roles = [item.role, ...(item.user_roles ?? [])];
    return Boolean(item.employee_id) && (roles.some((role) => ["admin", "hr", "branch_manager", "accountant", "auditor", "yard_supervisor"].includes(role)) || (item.additional_permissions ?? []).includes("evaluations.evaluate"));
  }).map((item) => ({ id: item.id, employee_id: item.employee_id!, name: item.full_name || `الموظف ${item.employee_id}` }));
  const assignedEvaluatorIds = ((evaluatorRows ?? []) as Array<{ slot: number; evaluator_profile_id: string }>).sort((a, b) => a.slot - b.slot).map((item) => item.evaluator_profile_id);
  return <EmployeeWorkspace userName={displayName} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="ملف الموظف" initialAccessProfile={profile}><div className="employees-page"><div className="page-content employee-detail-content"><div className="employee-detail-top"><div><p className="eyebrow">ملف الموظف</p><h1>{values.full_name}</h1><p className="welcome-copy">الكود الوظيفي: <b dir="ltr">{toWesternDigits(employee.employee_number)}</b></p></div><Link href="/employees" className="secondary-button">→　العودة إلى القائمة</Link></div><EmployeeProfileTabs employeeId={employee.id} initialValues={values} canEdit={canEdit} canManageAccounts={canManageAccounts} canAssignResponsibilities={canAssignResponsibilities} branches={(branches ?? []) as {id:string;name:string}[]} departments={(departments ?? []) as {id:string;name:string}[]} jobTitles={(titles ?? []) as {id:string;name:string;department_id:string|null}[]} initialUsername={account?.username ?? ""} initialRole={account?.role ?? "employee"} initialRoles={account?.user_roles ?? [account?.role ?? "employee"]} initialPermissions={account?.additional_permissions ?? []} initialBranchId={employee.branch_id} canAssignAdmin={hasRole("admin")} evaluators={eligibleEvaluators} assignedEvaluatorIds={assignedEvaluatorIds} initialResponsibleIds={initialResponsibleIds} managers={managers} goals={visibleGoalRows as Array<{id:string;period_month:string;title:string;target_value:number|null;actual_value:number|null;target_unit:string|null}>} evaluations={(evaluationRows ?? []) as Array<{id:string;period_month:string;total_score:number|null;max_score:number|null;status:string;notes:string|null}>} requests={(requestRows ?? []) as Array<{id:string;event_type:string;effective_date:string;end_date:string|null;status:string;reason:string|null;decision_reason:string|null;created_at:string}>} /></div></div></EmployeeWorkspace>;
}
