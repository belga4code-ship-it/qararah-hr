"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { lateMinutesAfter915 } from "@/lib/attendance";
import { toWesternDigits } from "@/lib/digits";

export type AttendanceExplanation = { id: string; attendance_record_id: string; explanation_kind: "late" | "incomplete" | "review"; explanation: string; status: "pending" | "accepted" | "rejected"; decision_note: string | null; created_at: string };
export type OwnAttendanceRow = { id: string; attendance_date: string; first_in: string | null; last_out: string | null; total_work: string | null; status: string; exception_note: string | null };

const recordLabels: Record<string, string> = { late: "تأخير", incomplete: "بصمة ناقصة", needs_review: "تحتاج مراجعة" };
const kindLabels = { late: "تفسير تأخير", incomplete: "تفسير بصمة ناقصة", review: "طلب مراجعة بصمة" } as const;
const decisionLabels = { pending: "قيد المراجعة", accepted: "مقبول", rejected: "مرفوض" } as const;

function time(value: string | null) { return value ? toWesternDigits(value.slice(0, 5)) : "—"; }
function isActionable(row: OwnAttendanceRow) { return row.status === "late" || row.status === "incomplete" || row.status === "needs_review" || lateMinutesAfter915(row.first_in) !== null; }

export default function MyAttendanceExplanations({ records, explanations: initialExplanations }: { records: OwnAttendanceRow[]; explanations: AttendanceExplanation[] }) {
  const [explanations, setExplanations] = useState(initialExplanations);
  const [selected, setSelected] = useState<OwnAttendanceRow | null>(null);
  const [kind, setKind] = useState<keyof typeof kindLabels>("late");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const explanationByRecord = useMemo(() => new Map(explanations.map((item) => [item.attendance_record_id, item])), [explanations]);
  const actionable = records.filter(isActionable);

  function openExplanation(row: OwnAttendanceRow) {
    const existing = explanationByRecord.get(row.id);
    if (existing?.status !== "rejected") return;
    setSelected(row);
    setKind(row.status === "incomplete" ? "incomplete" : row.status === "needs_review" ? "review" : "late");
    setText(existing?.explanation ?? "");
    setNotice("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true); setNotice("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("submit_attendance_explanation", { p_attendance_record_id: selected.id, p_explanation_kind: kind, p_explanation: text });
    if (error) { setNotice("تعذر إرسال التفسير: " + error.message); setBusy(false); return; }
    const next: AttendanceExplanation = { id: data as string, attendance_record_id: selected.id, explanation_kind: kind, explanation: text.trim(), status: "pending", decision_note: null, created_at: new Date().toISOString() };
    setExplanations((current) => [...current.filter((item) => item.attendance_record_id !== selected.id), next]);
    setSelected(null); setText(""); setNotice("تم إرسال التفسير للموارد البشرية للمراجعة."); setBusy(false);
  }

  return <div className="employee-app-content">
    <section className="panel app-list-card"><div className="app-section-heading app-list-heading"><div><h2>البصمات التي تحتاج إجراء</h2><p>اكتب تفسيرًا واحدًا لكل سجل؛ لن يتغير الحضور أو الراتب حتى تراجعه الموارد البشرية.</p></div><strong className="evaluation-self-score">{toWesternDigits(actionable.length)}</strong></div>
      {notice && <p className="app-report-message" role="status">{notice}</p>}
      {actionable.length ? <div className="app-card-list">{actionable.map((row) => {
        const explanation = explanationByRecord.get(row.id);
        const state = explanation?.status;
        const label = lateMinutesAfter915(row.first_in) !== null ? "تأخير" : recordLabels[row.status] ?? "تحتاج مراجعة";
        return <article className="app-item-card" key={row.id}><div className="my-attendance-card-heading"><div><strong>{toWesternDigits(row.attendance_date)} · {label}</strong><small>دخول {time(row.first_in)} · خروج {time(row.last_out)} · مدة العمل {time(row.total_work)}</small></div>{state && <b className={`attendance-explanation-status ${state}`}>{decisionLabels[state]}</b>}</div>{row.exception_note && <p>{row.exception_note}</p>}{explanation ? <><p><b>{kindLabels[explanation.explanation_kind]}:</b> {explanation.explanation}</p>{explanation.decision_note && <small>رد الموارد البشرية: {explanation.decision_note}</small>}{state === "rejected" && <button type="button" className="secondary-button" onClick={() => openExplanation(row)}>تعديل وإعادة الإرسال</button>}</> : <button type="button" className="secondary-button" onClick={() => openExplanation(row)}>اكتب إذنًا أو تفسيرًا</button>}</article>;
      })}</div> : <p className="app-empty-state"><strong>لا توجد بصمات متأخرة أو ناقصة ضمن آخر 60 يومًا.</strong></p>}
    </section>
    {selected && <dialog open className="employee-attendance-dialog" onClick={(event) => { if (event.target === event.currentTarget && !busy) setSelected(null); }}><form method="dialog" onSubmit={submit}><header><div><span>سجل الحضور</span><h2>{toWesternDigits(selected.attendance_date)}</h2><p>الدخول {time(selected.first_in)} · الخروج {time(selected.last_out)}</p></div><button type="button" onClick={() => setSelected(null)} disabled={busy} aria-label="إغلاق">×</button></header><label>نوع الطلب<select value={kind} onChange={(event) => setKind(event.target.value as keyof typeof kindLabels)}><option value="late">تفسير تأخير</option><option value="incomplete">تفسير بصمة ناقصة</option><option value="review">طلب مراجعة</option></select></label><label>التفسير أو الإذن<textarea required minLength={5} maxLength={1200} rows={5} value={text} onChange={(event) => setText(event.target.value)} placeholder="اكتب سبب التأخير أو ما حدث في البصمة…" /></label><p className="employee-attendance-help">يرسل هذا الطلب للمراجعة فقط، ولا يعدّل سجل البصمة أو الراتب تلقائيًا.</p><footer><button type="button" className="secondary-button" onClick={() => setSelected(null)} disabled={busy}>إلغاء</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "جارٍ الإرسال…" : "إرسال للمراجعة"}</button></footer></form></dialog>}
  </div>;
}
