import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import EmployeeWorkspace from "@/components/EmployeeWorkspace";
import { createClient } from "@/lib/supabase/server";
import { loadAccessProfile } from "@/lib/supabase/profile";
import "./devices.css";
const styles = { page: "zkbio-page", header: "zkbio-header", actions: "zkbio-actions", notice: "zkbio-notice", stats: "zkbio-stats", time: "zkbio-time", section: "zkbio-section", devices: "zkbio-devices", filters: "zkbio-filters", check: "zkbio-check", table: "zkbio-table" };

export const instant = false;
type Relation = { name: string } | null;
type Punch = { id: string; external_employee_id: string; employee_id: string | null; branch_id: string | null; punch_time: string; punch_type: string | null; employee: { full_name: string | null; employee_number: string } | null; device: { serial_number: string; device_name: string | null } | null; branch: Relation };
type Device = { id: string; serial_number: string; device_name: string | null; last_seen_at: string | null; external_status_code: string | null; branch: Relation };
const formatTime = (value?: string | null) => value ? new Intl.DateTimeFormat("ar-LY", { timeZone: "Africa/Tripoli", dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" }).format(new Date(value)) : "—";
const validDate = (v?: string) => v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v ? v : undefined;

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; branch?: string; code?: string; review?: string; page?: string }> }) {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await loadAccessProfile<{ full_name: string | null; role: string; user_roles?: string[] | null }>(supabase,user.id,"full_name,role,user_roles,additional_permissions","full_name,role");
  if (!profile) redirect("/setup-required");
  if (![profile.role,...(profile.user_roles ?? [])].some(r=>["admin","hr"].includes(r))) redirect("/");
  const params = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Tripoli",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  let from = validDate(params.from) ?? today;
  let to = validDate(params.to) ?? from;
  if (from > to) [from,to]=[to,from];
  const page = Math.max(1,Math.min(10000,Number.parseInt(params.page ?? "1",10)||1));
  const branch = /^[a-f0-9-]{36}$/i.test(params.branch ?? "") ? params.branch! : "";
  const code = (params.code ?? "").trim().slice(0,100);
  const review = params.review === "1";
  let query = supabase.from("attendance_raw_logs").select("id,external_employee_id,employee_id,branch_id,punch_time,punch_type,employee:employees(full_name,employee_number),device:attendance_devices(serial_number,device_name),branch:branches(name)",{count:"exact"})
    .gte("punch_time",`${from}T00:00:00+02:00`).lte("punch_time",`${to}T23:59:59.999+02:00`)
    .order("punch_time",{ascending:false}).order("id",{ascending:false});
  if (branch) query=query.eq("branch_id",branch);
  if (code) query=query.eq("external_employee_id",code);
  if (review) query=query.or("employee_id.is.null,branch_id.is.null,punch_type.eq.255,punch_type.is.null");
  const [punches,devices,sync,branches,total,unmatched] = await Promise.all([
    query.range((page-1)*50,page*50-1),
    supabase.from("attendance_devices").select("id,serial_number,device_name,last_seen_at,external_status_code,branch:branches(name)").order("device_name").limit(200),
    supabase.from("attendance_sync_state").select("status,last_successful_sync,updated_at").eq("source_id","zkbio-central").maybeSingle(),
    supabase.from("branches").select("id,name").order("name"),
    supabase.from("attendance_raw_logs").select("id",{count:"exact",head:true}),
    supabase.from("attendance_raw_logs").select("id",{count:"exact",head:true}).or("employee_id.is.null,branch_id.is.null"),
  ]);
  const error = [punches,devices,sync,branches,total,unmatched].some(r=>r.error);
  const rows=(punches.data ?? []) as unknown as Punch[];
  const deviceRows=(devices.data ?? []) as unknown as Device[];
  const href=(n:number)=>{const q=new URLSearchParams({from,to,page:String(n)});if(branch)q.set("branch",branch);if(code)q.set("code",code);if(review)q.set("review","1");return `/attendance/devices?${q}`;};
  return <EmployeeWorkspace userName={profile.full_name || user.email || "مستخدم النظام"} email={user.email ?? ""} roleLabel={profile.role==="admin"?"مدير النظام":"الموارد البشرية"} breadcrumb="أجهزة البصمة" initialAccessProfile={profile}>
    <main className={`page-content ${styles.page}`} dir="rtl">
      <header className={styles.header}><div><p className="eyebrow">متابعة الاستيراد الآلي</p><h1>أجهزة البصمة والحركات المستوردة</h1><p>الأوقات بتوقيت ليبيا · تحديث الصفحة يعرض آخر بيانات مستلمة.</p></div><div className={styles.actions}><Link className="secondary-button" href="/attendance">الحضور والانصراف</Link><Link className="primary-button" href={href(page)}>تحديث البيانات</Link></div></header>
      <div className={styles.notice}>هذه الحركات خام للمراجعة. لا تُحتسب تلقائيًا في تقارير الحضور أو الرواتب. رمز الحركة 255 يعني «غير معروف».</div>
      {error ? <section className="panel"><h2>تعذر تحميل بيانات البصمات</h2><p>تحقق من تجهيز جداول الاستقبال وصلاحيات قراءتها، ثم أعد التحديث.</p></section> : <>
        <section className={styles.stats}>
          <article><span>الحركات المستوردة</span><strong>{total.count ?? 0}</strong></article>
          <article><span>ربط الموظف أو الفرع يحتاج مراجعة</span><strong>{unmatched.count ?? 0}</strong></article>
          <article><span>آخر تحديث للاستقبال</span><strong className={styles.time}>{formatTime(sync.data?.updated_at)}</strong><small>{sync.data?.status==="ok"?"نجح الاستلام":sync.data?.status==="error"?"خطأ في الاستلام":"لم تصل مزامنة مكتملة بعد"}</small></article>
          <article><span>نهاية آخر فترة مستلمة</span><strong className={styles.time}>{formatTime(sync.data?.last_successful_sync)}</strong></article>
        </section>
        <section className={`panel ${styles.section}`}><h2>الأجهزة</h2><p>رمز الحالة وآخر نشاط كما وردا من ZKBio؛ لا يثبتان اتصال الجهاز الآن أو اتصال خدمة المزامنة.</p><div className={styles.devices}>{deviceRows.length ? deviceRows.map(d=><article key={d.id}><h3>{d.device_name || "جهاز دون اسم"}</h3><code>{d.serial_number}</code><p>{d.branch?.name || "الفرع غير مربوط — للمراجعة"}</p><small>آخر نشاط: {formatTime(d.last_seen_at)} · رمز المصدر: {d.external_status_code ?? "—"}</small></article>):<p>لم تُستلم أجهزة بعد.</p>}</div></section>
        <section className={`panel ${styles.section}`}><h2>حركات البصمة</h2>
          <form className={styles.filters}><label>من<input type="date" name="from" defaultValue={from}/></label><label>إلى<input type="date" name="to" defaultValue={to}/></label><label>الفرع<select name="branch" defaultValue={branch}><option value="">كل الفروع</option>{branches.data?.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>رقم الموظف في البصمة<input name="code" defaultValue={code} placeholder="emp_code"/></label><label className={styles.check}><input type="checkbox" name="review" value="1" defaultChecked={review}/>تحتاج مراجعة فقط</label><button className="primary-button" type="submit">عرض</button></form>
          <p>{punches.count ?? 0} حركة ضمن الفلاتر · الصفحة {page}</p>
          <div className={styles.table}><table><thead><tr><th>الوقت</th><th>الموظف / رقم البصمة</th><th>الجهاز</th><th>الفرع</th><th>نوع الحركة من المصدر</th><th>المطابقة</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{formatTime(r.punch_time)}</td><td>{r.employee?.full_name || "غير مطابق أو رقم مكرر"}<br/><code>{r.external_employee_id}</code></td><td>{r.device?.device_name || r.device?.serial_number || "—"}</td><td>{r.branch?.name || "غير مربوط"}</td><td>{r.punch_type==="255"?"255 — غير معروف":r.punch_type ?? "غير محدد"}</td><td>{r.employee_id && r.branch_id ? "مربوط" : "تحتاج مراجعة"}</td></tr>)}</tbody></table>{!rows.length && <p>لا توجد حركات بهذه الفلاتر.</p>}</div>
          <nav className={styles.actions} aria-label="صفحات حركات البصمة">{page>1&&<Link className="secondary-button" href={href(page-1)}>السابق</Link>}{page*50<(punches.count ?? 0)&&<Link className="secondary-button" href={href(page+1)}>التالي</Link>}</nav>
        </section>
      </>}
    </main>
  </EmployeeWorkspace>;
}
