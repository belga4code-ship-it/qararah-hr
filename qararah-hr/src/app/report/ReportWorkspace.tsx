"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";

export type EmployeeReport = { id: string; employee_id: string; category: string; subject: string; message: string; status: "pending" | "in_progress" | "resolved"; hr_response: string | null; created_at: string; employee?: { full_name: string | null; first_name: string; last_name: string | null; employee_number: string; branch: { name: string } | null } | null };
const categories: Record<string, string> = { workplace: "مشكلة في العمل", safety: "سلامة ومخاطر", suggestion: "اقتراح", other: "أخرى" };
const statusNames = { pending: "وصل للموارد البشرية", in_progress: "قيد المتابعة", resolved: "تمت المعالجة" };

export default function ReportWorkspace({ isHR, employeeId, branchId, userId, reports }: { isHR: boolean; employeeId: string | null; branchId: string | null; userId: string; reports: EmployeeReport[] }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [category, setCategory] = useState("other");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, "in_progress" | "resolved">>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId || !branchId) { setNotice("حسابك يحتاج ربط بملف الموظف والفرع من الموارد البشرية."); return; }
    setBusy(true); setNotice("");
    const { error } = await supabase.from("employee_reports").insert({ employee_id: employeeId, branch_id: branchId, category, subject: subject.trim(), message: message.trim() });
    setBusy(false);
    if (error) { setNotice(`تعذر إرسال الإبلاغ: ${error.message}`); return; }
    setSubject(""); setMessage(""); setNotice("وصل إبلاغك للموارد البشرية."); router.refresh();
  }

  async function handleReport(report: EmployeeReport) {
    setBusy(true); setNotice("");
    const { error } = await supabase.from("employee_reports").update({ status: statuses[report.id] ?? "in_progress", hr_response: responses[report.id]?.trim() || null, handled_by: userId, updated_at: new Date().toISOString() }).eq("id", report.id);
    setBusy(false);
    if (error) { setNotice(`تعذر تحديث الإبلاغ: ${error.message}`); return; }
    setNotice("تم تحديث حالة الإبلاغ."); router.refresh();
  }

  return <div className="employee-app-content">
    {!isHR && <section className="panel app-form-card"><div className="app-section-heading"><h2>إرسال إبلاغ</h2><p>اكتب المشكلة أو الملاحظة، وستصل للموارد البشرية لتتابعها.</p></div><form className="app-simple-form" onSubmit={submitReport}>
      <label>نوع الإبلاغ<select value={category} onChange={(event) => setCategory(event.target.value)}>{Object.entries(categories).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select></label>
      <label>عنوان مختصر<input required maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="اكتب عنوانًا واضحًا" /></label>
      <label className="wide">التفاصيل<textarea required rows={5} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="اشرح ما حدث أو اكتب ملاحظتك" /></label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "جارٍ الإرسال…" : "إرسال للموارد البشرية"}</button>
    </form>{notice && <p className="app-inline-message" role="status">{notice}</p>}</section>}
    <section className="panel app-list-card"><div className="app-section-heading"><h2>{isHR ? "إبلاغات الموظفين" : "إبلاغاتي"}</h2><p>{isHR ? "تابع البلاغات والاقتراحات الواردة." : "تابع حالة البلاغات التي أرسلتها."}</p></div>
      {reports.length ? <div className="app-card-list">{reports.map((report) => {
        const employeeName = report.employee?.full_name || [report.employee?.first_name, report.employee?.last_name].filter(Boolean).join(" ") || "موظف";
        const date = new Intl.DateTimeFormat("ar-LY", { dateStyle: "medium", timeZone: "Africa/Tripoli" }).format(new Date(report.created_at));
        return <article className="app-item-card app-report-card" key={report.id}><div className="app-report-top"><div><strong>{report.subject}</strong><small>{categories[report.category] ?? "أخرى"} · {date}</small>{isHR && <small>{employeeName} · {report.employee?.branch?.name || "بدون فرع"}</small>}</div><span className={`app-report-status ${report.status}`}>{statusNames[report.status]}</span></div><p className="app-report-message">{report.message}</p>
          {report.hr_response && <p className="app-report-response"><b>رد الموارد البشرية:</b> {report.hr_response}</p>}
          {isHR && report.status !== "resolved" && <div className="app-report-reply"><label>الرد أو الإجراء<textarea rows={2} value={responses[report.id] ?? report.hr_response ?? ""} onChange={(event) => setResponses((current) => ({ ...current, [report.id]: event.target.value }))} /></label><label>الحالة<select value={statuses[report.id] ?? (report.status === "resolved" ? "resolved" : "in_progress")} onChange={(event) => setStatuses((current) => ({ ...current, [report.id]: event.target.value as "in_progress" | "resolved" }))}><option value="in_progress">قيد المتابعة</option><option value="resolved">تمت المعالجة</option></select></label><button className="primary-button" type="button" disabled={busy} onClick={() => handleReport(report)}>حفظ</button></div>}
        </article>;
      })}</div> : <p className="app-empty-state">{isHR ? "ما فيش إبلاغات واردة." : "لم ترسل أي إبلاغ حتى الآن."}</p>}
      {notice && isHR && <p className="app-inline-message" role="status">{notice}</p>}
    </section>
  </div>;
}
