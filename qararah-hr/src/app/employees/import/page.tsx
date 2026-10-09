import Link from "next/link";
import { redirect } from "next/navigation";
import ImportEmployees from "./ImportEmployees";
import { createClient } from "@/lib/supabase/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";

export const instant = false;

export default async function ImportEmployeesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("id,role,full_name").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");
  if (!(["admin", "hr"].includes(profile.role))) redirect("/employees");

  const userName = profile.full_name || user.email || "مستخدم النظام";
  return (
    <EmployeeWorkspace userName={userName} email={user.email ?? ""} roleLabel={profile.role === "admin" ? "مدير النظام" : "الموارد البشرية"} breadcrumb="استيراد الموظفين">
      <main className="employees-page" dir="rtl">
      <div className="page-content">
        <div className="welcome-row"><div><p className="eyebrow">استيراد من ملف الشركة</p><h1>استيراد موظفين</h1><p className="welcome-copy">حمّل ملف Excel، راجع الأعمدة والسجلات، ثم احفظها في قاعدة البيانات.</p></div><Link className="secondary-button" href="/employees">رجوع إلى الموظفين</Link></div>
        <ImportEmployees />
      </div>
      </main>
    </EmployeeWorkspace>
  );
}
