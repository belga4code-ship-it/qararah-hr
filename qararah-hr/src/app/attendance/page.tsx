import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import AttendanceRecords, { type AttendanceRecordRow } from "./AttendanceRecords";
import AttendancePeriodFilter from "./AttendancePeriodFilter";
import { toWesternDigits } from "@/lib/digits";
import MonthlyTardinessExport from "./MonthlyTardinessExport";

export const instant = false;

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string; from?: string; to?: string; month?: string; period?: string }> }) {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name,role").eq("id", user.id).maybeSingle();
  if (!profile) redirect("/setup-required");

  const userName = profile.full_name || user.email || "مستخدم النظام";
  const roleLabel = profile.role === "admin" ? "مدير النظام" : profile.role === "hr" ? "الموارد البشرية" : "مدير الفرع";
  const params = await searchParams;
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const validDate = (value?: string) => { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T12:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; };
  const selectedDate = validDate(params.date) ? params.date! : todayKey;
  const defaultMonth = selectedDate.slice(0, 7);
  const selectedMonth = params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : defaultMonth;
  const selectedPeriod = ["1", "2", "3", "4", "all"].includes(params.period ?? "") ? params.period! : "custom";
  let rangeStart = validDate(params.from) ? params.from! : selectedDate;
  let rangeEnd = validDate(params.to) ? params.to! : rangeStart;
  if (selectedPeriod !== "custom") {
    const [year, month] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const firstDay = selectedPeriod === "all" ? 1 : (Number(selectedPeriod) - 1) * 7 + 1;
    const finalDay = selectedPeriod === "all" ? lastDay : Math.min(firstDay + 6, lastDay);
    rangeStart = `${selectedMonth}-${String(firstDay).padStart(2, "0")}`;
    rangeEnd = `${selectedMonth}-${String(finalDay).padStart(2, "0")}`;
  }
  if (rangeStart > rangeEnd) [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
  const periodSummary = rangeStart === rangeEnd ? rangeStart : `${rangeStart} إلى ${rangeEnd}`;
  const [{ data: records }, { data: latestImport }] = await Promise.all([
    supabase.from("attendance_records").select("id,employee_id,attendance_date,first_in,last_out,total_work,status,exception_note,employee:employees(employee_number,zkt_user_id,full_name,first_name,last_name,status,hired_on,job_title:job_titles(name),branch:branches(name))").gte("attendance_date", rangeStart).lte("attendance_date", rangeEnd).order("attendance_date", { ascending: true }).order("first_in", { ascending: true, nullsFirst: false }),
    supabase.from("attendance_imports").select("source_file,imported_at,period_start,period_end,row_count").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const attendance = (records ?? []) as unknown as AttendanceRecordRow[];
  const presentCount = attendance.filter((row) => ["present", "late", "on_mission"].includes(row.status)).length;
  const reviewCount = attendance.filter((row) => ["absent", "incomplete", "needs_review"].includes(row.status)).length;
  const branchCount = new Set(attendance.map((row) => row.employee?.branch?.name).filter(Boolean)).size;

  return (
    <EmployeeWorkspace userName={userName} email={user.email ?? ""} roleLabel={roleLabel} breadcrumb="الحضور والانصراف">
      <main className="attendance-page page-content" dir="rtl">
        <section className="attendance-welcome">
          <div><p className="eyebrow">متابعة الدوام</p><h1>الحضور والانصراف</h1><p className="welcome-copy">الفترة المحددة: {periodSummary} · سجلات الحضور والانصراف المستوردة.</p></div>
          <div className="attendance-page-actions"><MonthlyTardinessExport month={selectedMonth} /><Link className="secondary-button" href="/attendance/report">إنشاء التقرير الأسبوعي</Link><Link className="primary-button" href="/attendance/import"><span>⇧</span> استيراد ملف الحضور</Link></div>
        </section>

        <div className="attendance-stats">
          <article className="attendance-stat"><span className="attendance-stat-icon blue">◷</span><div><span>سجلات الفترة</span><strong>{attendance.length}</strong><small>في {branchCount} فروع</small></div></article>
          <article className="attendance-stat"><span className="attendance-stat-icon green">✓</span><div><span>حضور مكتمل</span><strong>{presentCount}</strong><small>حضور أو تأخر أو مأمورية</small></div></article>
          <article className="attendance-stat"><span className="attendance-stat-icon amber">!</span><div><span>تحتاج مراجعة</span><strong>{reviewCount}</strong><small>غياب بصمة أو بيانات ناقصة</small></div></article>
          <article className="attendance-stat"><span className="attendance-stat-icon slate">▣</span><div><span>آخر ملف مستورد</span><strong className="attendance-last-file">{toWesternDigits(latestImport?.source_file ?? "—")}</strong><small>{latestImport ? `${toWesternDigits(latestImport.row_count)} سجل · ${toWesternDigits(latestImport.period_start)} – ${toWesternDigits(latestImport.period_end)}` : "لم يتم استيراد ملف بعد"}</small></div></article>
        </div>

          <section className="panel attendance-records-panel">
          <div className="attendance-panel-heading"><div><h2>سجل الحضور والانصراف</h2><p>اختر تاريخًا يدويًا أو شهرًا وفترة لعرض سجلاتها.</p></div><AttendancePeriodFilter month={selectedMonth} period={selectedPeriod} from={rangeStart} to={rangeEnd} /></div>
          <AttendanceRecords rows={attendance} />
        </section>
      </main>
    </EmployeeWorkspace>
  );
}
