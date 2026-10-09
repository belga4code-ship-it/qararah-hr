import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import EmployeeEditor, { type EditValues } from "./EmployeeEditor";
import { toWesternDigits } from "@/lib/digits";

export const instant = false;

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("id,role,full_name").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");
  const canEdit = profile.role === "admin" || profile.role === "hr";

  const [{ data: employee }, { data: branches }, { data: departments }, { data: titles }] = await Promise.all([
    supabase.from("employees").select("id,employee_number,first_name,last_name,full_name,zkt_user_id,status,hired_on,branch_id,department_id,job_title_id,branch:branches(name),department:departments(name),job_title:job_titles(name)").eq("id", id).maybeSingle(),
    canEdit ? supabase.from("branches").select("id,name").order("name") : Promise.resolve({ data: [] }),
    canEdit ? supabase.from("departments").select("id,name").order("name") : Promise.resolve({ data: [] }),
    canEdit ? supabase.from("job_titles").select("id,name,department_id").order("name") : Promise.resolve({ data: [] }),
  ]);
  if (!employee) notFound();
  const { data: privateRow } = canEdit ? await supabase.from("employee_private").select("salary_amount,salary_updated_on,education,graduation_year,date_of_birth,religion,marital_status,blood_type,residency_expires_on,phone,emergency_phone,emergency_contact_name,passport_number,entered_libya_on,home_country,address,notes,source_data").eq("employee_id", id).maybeSingle() : { data: null };

  const rel = employee as unknown as { branch: { name: string } | null; department: { name: string } | null; job_title: { name: string } | null };
  const privateData = (privateRow ?? {}) as Record<string, unknown>;
  const sourceData = (privateData.source_data ?? {}) as Record<string, string | number | null>;
  const values: EditValues = {
    employee_number: employee.employee_number ?? "", full_name: employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" "), zkt_user_id: employee.zkt_user_id ?? "", status: employee.status ?? "needs_review", hired_on: employee.hired_on ?? "", branch_name: rel.branch?.name ?? "", department_name: rel.department?.name ?? "", job_title_name: rel.job_title?.name ?? "", phone: String(privateData.phone ?? ""), salary_amount: String(privateData.salary_amount ?? ""), salary_updated_on: String(privateData.salary_updated_on ?? ""), education: String(privateData.education ?? ""), graduation_year: String(privateData.graduation_year ?? ""), date_of_birth: String(privateData.date_of_birth ?? ""), religion: String(privateData.religion ?? ""), marital_status: String(privateData.marital_status ?? ""), blood_type: String(privateData.blood_type ?? ""), residency_expires_on: String(privateData.residency_expires_on ?? ""), emergency_phone: String(privateData.emergency_phone ?? ""), emergency_contact_name: String(privateData.emergency_contact_name ?? ""), passport_number: String(privateData.passport_number ?? ""), entered_libya_on: String(privateData.entered_libya_on ?? ""), home_country: String(privateData.home_country ?? ""), address: String(privateData.address ?? ""), notes: String(privateData.notes ?? ""), source_data: sourceData,
  };

  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "الموارد البشرية" : "مدير الفرع";
  const displayName = profile.full_name || user.email || "مستخدم النظام";
  return <EmployeeWorkspace userName={displayName} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="ملف الموظف"><div className="employees-page"><div className="page-content employee-detail-content"><div className="employee-detail-top"><div><p className="eyebrow">ملف الموظف</p><h1>{values.full_name}</h1><p className="welcome-copy">الكود الوظيفي: <b dir="ltr">{toWesternDigits(employee.employee_number)}</b></p></div><Link href="/employees" className="secondary-button">→　العودة إلى القائمة</Link></div><EmployeeEditor employeeId={employee.id} initialValues={values} canEdit={canEdit} branches={(branches ?? []) as {id:string;name:string}[]} departments={(departments ?? []) as {id:string;name:string}[]} jobTitles={(titles ?? []) as {id:string;name:string;department_id:string|null}[]} /></div></div></EmployeeWorkspace>;
}
