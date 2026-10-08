import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

const navigation = [
  { icon: "⌂", label: "الرئيسية", active: true, href: "/" },
  { icon: "♙", label: "الموظفون", href: "/employees" },
  { icon: "◷", label: "الحضور والانصراف", href: "#" },
  { icon: "▤", label: "المؤثرات الأسبوعية", href: "#" },
  { icon: "▣", label: "الإجازات والمأموريات", href: "#" },
  { icon: "☆", label: "تقييم الأداء", href: "#" },
  { icon: "▥", label: "التقارير", href: "#" },
];

type Employee = { id: string; employee_number: string; first_name: string; last_name: string | null; branch_id: string; status: string };
type Attendance = { employee_id: string; status: string; first_in: string | null; last_out: string | null; attendance_date: string; exception_note: string | null; employee: { employee_number: string; first_name: string; last_name: string | null } | null; branch: { name: string } | null };
type Branch = { id: string; name: string };

function Icon({ children }: { children: string }) {
  return <span className="nav-icon" aria-hidden="true">{children}</span>;
}

function formatClock(value: string | null) {
  if (!value) return "—";
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  return `${String(hour % 12 || 12).padStart(2, "0")}:${minute} ${hour >= 12 ? "م" : "ص"}`;
}

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("full_name, role, branch_id").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekStartDate = new Date(now);
  weekStartDate.setDate(weekStartDate.getDate() - 6);
  const weekStart = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(weekStartDate);
  const [{ data: employeeData }, { data: branchData }, { data: todayData }, { data: weekData }] = await Promise.all([
    supabase.from("employees").select("id,employee_number,first_name,last_name,branch_id,status").eq("status", "active"),
    supabase.from("branches").select("id,name").eq("is_active", true).order("name"),
    supabase.from("attendance_records").select("employee_id,status,first_in,last_out,attendance_date,exception_note,employee:employees(employee_number,first_name,last_name),branch:branches(name)").eq("attendance_date", today),
    supabase.from("attendance_records").select("attendance_date,status").gte("attendance_date", weekStart).lte("attendance_date", today),
  ]);

  const employees = (employeeData ?? []) as Employee[];
  const branches = ((branchData ?? []) as Branch[]).filter((branch) => profile.role === "admin" || profile.role === "hr" || branch.id === profile.branch_id);
  const attendance = (todayData ?? []) as unknown as Attendance[];
  const week = weekData ?? [];
  const presentCount = attendance.filter((row) => ["present", "late", "on_mission"].includes(row.status)).length;
  const lateCount = attendance.filter((row) => row.status === "late").length;
  const reviewCount = attendance.filter((row) => ["needs_review", "incomplete", "absent"].includes(row.status)).length;
  const presentPercent = employees.length ? Math.round((presentCount / employees.length) * 100) : 0;
  const exceptions = attendance.filter((row) => ["needs_review", "incomplete", "absent"].includes(row.status)).slice(0, 8);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStartDate);
    date.setDate(date.getDate() + index);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    return {
      key,
      label: new Intl.DateTimeFormat("ar-LY", { timeZone: "Africa/Tripoli", weekday: "short" }).format(date),
      present: week.filter((row) => row.attendance_date === key && ["present", "on_mission"].includes(row.status)).length,
      late: week.filter((row) => row.attendance_date === key && row.status === "late").length,
    };
  });
  const largestDay = Math.max(1, ...weekDays.map((day) => day.present + day.late));
  const todayLabel = new Intl.DateTimeFormat("ar-LY", { dateStyle: "full", timeZone: "Africa/Tripoli" }).format(now);
  const displayName = profile.full_name || user.email || "مستخدم النظام";
  const initials = displayName.trim().charAt(0) || "م";

  return (
    <main className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">ق</div><div><strong>قرارة</strong><span>نظام الموارد البشرية</span></div></div>
        <div className="menu-caption">القائمة الرئيسية</div>
        <nav className="nav-list" aria-label="القائمة الرئيسية">
          {navigation.map((item) => <Link className={`nav-item${item.active ? " active" : ""}`} href={item.href} key={item.label}><Icon>{item.icon}</Icon><span>{item.label}</span>{item.label === "الحضور والانصراف" && reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}</Link>)}
        </nav>
        <div className="sidebar-footer"><div className="help-icon">؟</div><div><strong>تحتاج إلى مساعدة؟</strong><span>تواصل مع إدارة الموارد البشرية</span></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="breadcrumb">نظام الموارد البشرية <span>/</span> الرئيسية</div><div className="top-actions"><div className="profile"><div className="avatar">{initials}</div><div><strong>{displayName}</strong><span>{profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "الموارد البشرية" : "مدير الفرع"}</span></div></div></div></header>
        <div className="page-content">
          <div className="welcome-row"><div><p className="eyebrow">{todayLabel}</p><h1>الرئيسية</h1><p className="welcome-copy">نظرة عامة على شؤون الموظفين والحضور في الفروع المصرح بها لحسابك.</p></div><Link className="primary-button" href="/employees"><span>♙</span> إدارة الموظفين</Link></div>

          <div className="stats-grid">
            <article className="stat-card"><div className="stat-top"><span className="stat-label">الموظفون النشطون</span><span className="stat-icon blue">♙</span></div><div className="stat-value">{employees.length}</div><div className="stat-foot"><span>حسب بيانات قاعدة الشركة</span></div></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-label">حاضرون اليوم</span><span className="stat-icon green">✓</span></div><div className="stat-value">{presentCount} <small>موظف</small></div><div className="stat-foot"><span>من أصل {employees.length} موظف نشط</span><span className="rate">{presentPercent}%</span></div><div className="progress"><span style={{ width: `${presentPercent}%` }} /></div></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-label">تأخروا عن الدوام</span><span className="stat-icon amber">◷</span></div><div className="stat-value">{lateCount} <small>موظف</small></div><div className="stat-foot"><span>في {new Set(attendance.filter((row) => row.status === "late").map((row) => row.branch?.name).filter(Boolean)).size} فروع</span></div></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-label">حالات تحتاج مراجعة</span><span className="stat-icon rose">!</span></div><div className="stat-value">{reviewCount} <small>حالة</small></div><div className="stat-foot"><span>حسب سجلات البصمة المعتمدة</span></div></article>
          </div>

          <div className="content-grid">
            <section className="panel attendance-panel">
              <div className="panel-heading"><div><h2>ملخص الحضور</h2><p>سجلات آخر سبعة أيام</p></div><span className="select-button">هذا الأسبوع</span></div>
              <div className="chart-area"><div className="chart-y"><span>{largestDay}</span><span>{Math.ceil(largestDay * .8)}</span><span>{Math.ceil(largestDay * .6)}</span><span>{Math.ceil(largestDay * .4)}</span><span>{Math.ceil(largestDay * .2)}</span><span>0</span></div><div className="chart-main"><div className="chart-gridlines"><i/><i/><i/><i/><i/><i/></div><div className="bars">{weekDays.map((day) => <div className="bar-group" key={day.key}><div className="bar-pair"><span className="bar present" style={{ height: `${(day.present / largestDay) * 100}%` }} /><span className="bar late" style={{ height: `${(day.late / largestDay) * 100}%` }} /></div><span className="day-label">{day.label}</span></div>)}</div></div></div>
              <div className="chart-legend"><span><i className="legend-present"/> حضور</span><span><i className="legend-late"/> تأخير</span><span className="chart-note">{week.length ? "من بيانات البصمة المسجلة" : "لا توجد سجلات حضور للفترة"}</span></div>
            </section>

            <section className="panel branch-panel"><div className="panel-heading"><div><h2>الحضور حسب الفرع</h2><p>نسبة الحضور اليوم</p></div></div><div className="branch-list">{branches.length ? branches.map((branch) => { const branchEmployees = employees.filter((employee) => employee.branch_id === branch.id); const branchRows = attendance.filter((row) => row.branch?.name === branch.name); const branchPresent = branchRows.filter((row) => ["present", "late", "on_mission"].includes(row.status)).length; const rate = branchEmployees.length ? Math.round((branchPresent / branchEmployees.length) * 100) : 0; return <div className="branch-row" key={branch.id}><div className="branch-meta"><strong>{branch.name}</strong><span>{branchPresent} / {branchEmployees.length} موظف</span></div><div className="branch-progress"><div><span style={{ width: `${rate}%` }} /></div><b>{rate}%</b></div></div>; }) : <p className="empty-message">لا توجد فروع مسجلة أو متاحة لهذا الحساب.</p>}</div></section>
          </div>

          <section className="panel exceptions-panel"><div className="panel-heading"><div><h2>حالات البصمة التي تحتاج مراجعة</h2><p>راجع الحالات قبل اعتماد الحضور أو تسجيل أي خصم</p></div></div><div className="table-wrap"><table><thead><tr><th>الموظف</th><th>الرقم الوظيفي</th><th>الفرع</th><th>نوع الحالة</th><th>وقت الدخول</th><th>الحالة</th></tr></thead><tbody>{exceptions.length ? exceptions.map((row) => { const name = [row.employee?.first_name, row.employee?.last_name].filter(Boolean).join(" ") || "موظف"; const issue = row.exception_note || (row.status === "absent" ? "غياب مسجل" : row.status === "incomplete" ? "بصمة ناقصة" : "تحتاج مراجعة"); return <tr key={`${row.employee_id}-${row.attendance_date}`}><td><div className="employee-cell"><span className="employee-avatar">{name.charAt(0)}</span><strong>{name}</strong></div></td><td className="code-cell">{row.employee?.employee_number ?? "—"}</td><td>{row.branch?.name ?? "—"}</td><td>{issue}</td><td className="time-cell">{formatClock(row.first_in)}</td><td><span className={`status-pill ${row.status === "absent" ? "red" : "amber"}`}>{row.status === "absent" ? "غياب" : "مراجعة مطلوبة"}</span></td></tr>; }) : <tr><td colSpan={6} className="empty-table">لا توجد حالات مراجعة مسجلة اليوم.</td></tr>}</tbody></table></div></section>
          <footer className="page-footer"><span>© {now.getFullYear()} شركة قرارة للرخام والجرانيت</span><span>نظام الموارد البشرية <b>•</b> البيانات من Supabase</span></footer>
        </div>
      </section>
    </main>
  );
}
