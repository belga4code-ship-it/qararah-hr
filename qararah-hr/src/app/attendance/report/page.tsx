import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import WeeklyAttendanceReport from "./WeeklyAttendanceReport";

export const instant = false;

export default async function AttendanceReportPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await loadAccessProfile<{ full_name: string | null; role: string; user_roles?: string[] | null; additional_permissions?: string[] | null }>(supabase, user.id, "full_name,role,user_roles,additional_permissions", "full_name,role");
  if (!profile) redirect("/setup-required");
  const roles = [...new Set([profile.role, ...((profile.user_roles as string[] | null) ?? [])])];
  const permissions = (profile.additional_permissions as string[] | null) ?? [];
  const isHR = roles.some((role) => ["admin", "hr"].includes(role));
  const isAuditor = roles.includes("auditor");
  const canViewReport = isHR || isAuditor || permissions.includes("reports.view_all") || permissions.includes("reports.export");
  if (!canViewReport) redirect("/attendance");
  const canExportReport = isHR || isAuditor || permissions.includes("reports.export");
  const roleLabel = roles.includes("admin") ? "مدير النظام" : roles.includes("hr") ? "مدير الموارد البشرية" : roles.includes("auditor") ? "مراجع حسابات" : "مصرح بالتقارير";
  return <EmployeeWorkspace userName={profile.full_name || user.email || "مستخدم النظام"} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="التقرير الأسبوعي">
    <main className="attendance-page page-content" dir="rtl">
      <section className="attendance-welcome"><div><p className="eyebrow">تقارير الحضور والانصراف</p><h1>التقرير الأسبوعي</h1><p className="welcome-copy">جهّز تقرير الإدارة حسب الفترة والدوام المعتمد لكل فرع.</p></div><Link className="secondary-button" href="/attendance">العودة للحضور</Link></section>
      <WeeklyAttendanceReport canExport={canExportReport} />
    </main>
  </EmployeeWorkspace>;
}
