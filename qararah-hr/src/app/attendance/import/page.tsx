import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import AttendanceImport from "./AttendanceImport";

export const instant = false;

export default async function AttendanceImportPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name,role").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");
  if (!(profile.role === "admin" || profile.role === "hr")) redirect("/attendance");

  const userName = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "الموارد البشرية" : "مدير الفرع";

  return (
    <EmployeeWorkspace userName={userName} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="استيراد الحضور">
      <main className="attendance-page attendance-import-page page-content" dir="rtl">
        <section className="attendance-welcome">
          <div><p className="eyebrow">إضافة سجلات الدوام</p><h1>استيراد الحضور والانصراف</h1><p className="welcome-copy">ارفع تقرير ZKT الأسبوعي لمطابقة أكواد البصمة ومراجعة السجلات قبل حفظها.</p></div>
          <Link className="secondary-button" href="/attendance">العودة إلى الحضور والانصراف</Link>
        </section>

        <div className="attendance-import-layout">
          <section className="panel attendance-upload-panel">
            <div className="attendance-panel-heading"><div><h2>ملف الحضور</h2><p>اختر ملف .xlsx المُصدّر من جهاز ZKT. تُقرأ بيانات رقم الموظف والتاريخ وأوقات الدخول والخروج.</p></div><span className="attendance-step">الخطوة 1 من 3</span></div>
            <AttendanceImport />
          </section>
          <aside className="panel attendance-guide-panel">
            <span className="attendance-guide-icon">ⓘ</span><h2>قبل رفع الملف</h2>
            <ul><li>تتم مطابقة رقم الموظف في التقرير مع كود البصمة المسجل في ملف الموظف.</li><li>تُعرض حالات الحضور والغياب والإجازة والسجلات الناقصة قبل الحفظ.</li><li>إذا وُجدت سجلات لنفس الموظف والتاريخ، يلزم تأكيد تحديثها صراحةً.</li></ul>
            <div className="attendance-guide-note">السجلات تُقسّم حسب فروع الموظفين، ويُحفظ صف التقرير الأصلي للمراجعة.</div>
          </aside>
        </div>
      </main>
    </EmployeeWorkspace>
  );
}
