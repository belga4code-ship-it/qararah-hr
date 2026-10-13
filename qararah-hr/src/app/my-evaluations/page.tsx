import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import { toWesternDigits } from "@/lib/digits";

export const instant = false;

export default async function MyEvaluationsPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name,role,employee_id").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");
  const { data } = profile.employee_id ? await supabase.from("evaluations").select("id,period_month,total_score,max_score,status,notes,evaluation_items(criterion,score,max_score,evidence)").eq("employee_id", profile.employee_id).eq("status", "submitted").order("period_month", { ascending: false }) : { data: [] };
  const name = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "مدير الموارد البشرية" : profile.role === "branch_manager" ? "مدير الفرع" : profile.role === "accountant" ? "محاسب" : "موظف";
  return <EmployeeWorkspace userName={name} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="تقييماتي">
    <main className="employee-app-page" dir="rtl"><section className="employee-app-welcome"><span>تقييم الأداء</span><h1>تقييماتي</h1><p>نتائج التقييمات الشهرية المسجلة على ملفك.</p></section>
      {data?.length ? <div className="employee-app-content">{data.map((evaluation) => {
        const month = new Intl.DateTimeFormat("ar-LY", { month: "long", year: "numeric", timeZone: "Africa/Tripoli" }).format(new Date(`${evaluation.period_month}T12:00:00`));
        const percent = evaluation.max_score ? (Number(evaluation.total_score ?? 0) / Number(evaluation.max_score)) * 100 : 0;
        return <section className="panel app-list-card" key={evaluation.id}><div className="app-section-heading app-list-heading"><div><h2>{month}</h2><p>النتيجة النهائية</p></div><strong className="evaluation-self-score">{toWesternDigits(percent.toFixed(1))}%</strong></div>
          {evaluation.notes && <p className="app-report-message">{evaluation.notes}</p>}
          <div className="app-card-list">{evaluation.evaluation_items.map((item) => <article className="app-item-card" key={item.criterion}><strong>{item.criterion}</strong><small>{toWesternDigits(item.score)} من {toWesternDigits(item.max_score)}</small>{item.evidence && <p>{item.evidence}</p>}</article>)}</div>
        </section>;
      })}</div> : <section className="panel app-empty-state"><span>☆</span><strong>ما فيش تقييمات منشورة لملفك حتى الآن</strong><p>تظهر نتائجك هنا بعد ما يقدّم المسؤول تقييمك الشهري.</p></section>}
    </main>
  </EmployeeWorkspace>;
}
