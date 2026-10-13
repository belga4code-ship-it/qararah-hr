import { redirect } from "next/navigation";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import AuditLog, { type AuditRow } from "./AuditLog";

export const instant = false;

export default async function AuditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name,role").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");
  if (!["admin", "hr"].includes(profile.role)) redirect("/");

  const { data } = await supabase.from("audit_log").select("id,entity_table,entity_id,employee_id,branch_id,action,changed_fields,old_data,new_data,created_at,actor:profiles!audit_log_actor_id_fkey(full_name),employee:employees!audit_log_employee_id_fkey(employee_number,full_name,first_name,last_name),branch:branches!audit_log_branch_id_fkey(name)").order("created_at", { ascending: false }).limit(300);
  const rows = (data ?? []) as unknown as AuditRow[];
  const roleLabel = profile.role === "admin" ? "مدير النظام" : "مدير الموارد البشرية";

  return <EmployeeWorkspace userName={profile.full_name || user.email || "مستخدم النظام"} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="سجل التدقيق"><main className="audit-page page-content" dir="rtl"><section className="audit-welcome"><div><p className="eyebrow">متابعة التغييرات</p><h1>سجل التدقيق</h1><p className="welcome-copy">من عدّل بيانات الموظفين والحضور والطلبات والتقييمات، ومتى تم التعديل.</p></div><span className="audit-count">آخر {rows.length} حركة</span></section><AuditLog rows={rows} /></main></EmployeeWorkspace>;
}
