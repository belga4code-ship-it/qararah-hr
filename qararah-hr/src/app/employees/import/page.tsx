import Link from "next/link";
import { redirect } from "next/navigation";
import ImportEmployees from "./ImportEmployees";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function ImportEmployeesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("id,role").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");
  if (!(["admin", "hr"].includes(profile.role))) redirect("/employees");

  return (
    <main className="employees-page" dir="rtl">
      <header className="topbar"><Link href="/employees" className="breadcrumb">الموظفون <span>/</span> استيراد موظفين</Link><div className="profile"><div className="avatar">م</div><div><strong>{user.email}</strong><span>الموارد البشرية</span></div></div></header>
      <div className="page-content">
        <div className="welcome-row"><div><p className="eyebrow">استيراد من ملف الشركة</p><h1>استيراد موظفين</h1><p className="welcome-copy">حمّل ملف Excel، راجع الأعمدة والسجلات، ثم احفظها في قاعدة البيانات.</p></div><Link className="secondary-button" href="/employees">رجوع إلى الموظفين</Link></div>
        <ImportEmployees />
      </div>
    </main>
  );
}
