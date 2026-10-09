import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import WeeklyAttendanceReport from "./WeeklyAttendanceReport";

export const instant = false;

export default async function AttendanceReportPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name,role").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");
  if (!(profile.role === "admin" || profile.role === "hr")) redirect("/attendance");
  return <EmployeeWorkspace userName={profile.full_name || user.email || "مستخدم النظام"} email={user.email ?? ""} roleLabel={profile.role === "admin" ? "مدير النظام" : "الموارد البشرية"} breadcrumb="التقرير الأسبوعي">
    <main className="attendance-page page-content" dir="rtl">
      <section className="attendance-welcome"><div><p className="eyebrow">تقارير الحضور والانصراف</p><h1>التقرير الأسبوعي</h1><p className="welcome-copy">جهّز تقرير الإدارة حسب الفترة والدوام المعتمد لكل فرع.</p></div><Link className="secondary-button" href="/attendance">العودة للحضور</Link></section>
      <WeeklyAttendanceReport />
    </main>
  </EmployeeWorkspace>;
}
