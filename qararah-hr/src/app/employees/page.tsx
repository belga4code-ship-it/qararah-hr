import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type EmployeeRow = {
  employee_number: string;
  first_name: string;
  last_name: string | null;
  full_name: string | null;
  zkt_user_id: string | null;
  status: string;
  branch: { name: string } | null;
  department: { name: string } | null;
  job_title: { name: string } | null;
};

const statusLabels: Record<string, string> = {
  active: "نشط",
  on_leave: "في إجازة",
  suspended: "موقوف",
  terminated: "منتهي الخدمة",
  needs_review: "يحتاج مراجعة",
};

export default async function EmployeesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");

  const { data } = await supabase
    .from("employees")
    .select("employee_number,first_name,last_name,full_name,zkt_user_id,status,branch:branches(name),department:departments(name),job_title:job_titles(name)")
    .order("employee_number");
  const employees = (data ?? []) as unknown as EmployeeRow[];

  return (
    <main className="employees-page" dir="rtl">
      <header className="topbar"><Link href="/" className="breadcrumb">نظام الموارد البشرية <span>/</span> الرئيسية</Link><div className="profile"><div className="avatar">م</div><div><strong>{user.email}</strong><span>الموارد البشرية</span></div></div></header>
      <div className="page-content">
        <div className="welcome-row"><div><p className="eyebrow">إدارة ملفات العاملين</p><h1>الموظفون</h1><p className="welcome-copy">قائمة الموظفين المسجلة في قاعدة البيانات.</p></div><Link className="primary-button" href="/employees/import"><span>⇧</span> استيراد موظفين</Link></div>
        <section className="panel employees-table-panel"><div className="panel-heading"><div><h2>بيانات الموظفين</h2><p>{employees.length} موظف</p></div></div><div className="table-wrap"><table><thead><tr><th>الكود الوظيفي</th><th>اسم الموظف</th><th>كود البصمة</th><th>الوظيفة</th><th>القسم</th><th>الفرع</th><th>الحالة</th></tr></thead><tbody>{employees.length ? employees.map((employee) => {
          const name = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ");
          return <tr key={employee.employee_number}><td className="code-cell">{employee.employee_number}</td><td><div className="employee-cell"><span className="employee-avatar">{name.charAt(0)}</span><strong>{name}</strong></div></td><td className="code-cell">{employee.zkt_user_id ?? "—"}</td><td>{employee.job_title?.name ?? "—"}</td><td>{employee.department?.name ?? "—"}</td><td>{employee.branch?.name ?? "—"}</td><td><span className={`status-pill ${employee.status === "active" ? "green" : "amber"}`}>{statusLabels[employee.status] ?? employee.status}</span></td></tr>;
        }) : <tr><td colSpan={7} className="empty-table">ما فيش موظفين في قاعدة البيانات لحد الآن. استورد ملف Excel لإضافة السجلات.</td></tr>}</tbody></table></div></section>
      </div>
    </main>
  );
}
