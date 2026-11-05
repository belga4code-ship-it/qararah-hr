import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import MyAttendanceExplanations, { type AttendanceExplanation, type OwnAttendanceRow } from "./MyAttendanceExplanations";

export const instant = false;

export default async function MyAttendancePage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await loadAccessProfile<{ full_name: string | null; role: string; employee_id: string | null; user_roles?: string[] | null; additional_permissions?: string[] | null }>(supabase, user.id, "full_name,role,employee_id,user_roles,additional_permissions", "full_name,role,employee_id");
  if (!profile) redirect("/setup-required");
  const since = new Date(); since.setDate(since.getDate() - 60);
  const { data: records } = profile.employee_id ? await supabase.from("attendance_records").select("id,attendance_date,first_in,last_out,total_work,status,exception_note").eq("employee_id", profile.employee_id).gte("attendance_date", since.toISOString().slice(0, 10)).order("attendance_date", { ascending: false }) : { data: [] };
  const recordIds = (records ?? []).map((row) => row.id);
  const { data: explanations } = recordIds.length ? await supabase.from("attendance_explanations").select("id,attendance_record_id,explanation_kind,explanation,status,decision_note,created_at").in("attendance_record_id", recordIds).order("created_at", { ascending: false }) : { data: [] };
  const name = profile.full_name || user.email || "مستخدم النظام";
  const roleLabels: Record<string, string> = { admin: "مدير النظام", hr: "مدير الموارد البشرية", branch_manager: "مدير الفرع", accountant: "محاسب", auditor: "مراجع الحسابات", employee: "موظف" };
  return <EmployeeWorkspace userName={name} email={user.email ?? ""} roleLabel={roleLabels[profile.role] ?? "موظف"} breadcrumb="حضور بصمتي" initialAccessProfile={profile}><main className="employee-app-page" dir="rtl"><section className="employee-app-welcome"><span>الحضور والانصراف</span><h1>حضور بصمتي</h1><p>راجع التأخير أو البصمة الناقصة، وأرسل إذنًا أو تفسيرًا للموارد البشرية.</p></section><MyAttendanceExplanations records={(records ?? []) as OwnAttendanceRow[]} explanations={(explanations ?? []) as AttendanceExplanation[]} /></main></EmployeeWorkspace>;
}
