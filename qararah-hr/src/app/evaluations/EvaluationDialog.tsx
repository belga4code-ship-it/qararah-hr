"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";
import { employeeName, monthLabel, seedScores, templateFor, type EvaluatedEmployee, type EvaluationRecord, type Criterion } from "./evaluation-model";
import { calculateAttendanceScore, type AttendanceScoreEvent, type AttendanceScoreImport, type AttendanceScoreRecord, type AttendanceScoreResult } from "./attendance-score";
import "./EvaluationDialog.css";

const attendanceCriterion = "الالتزام بالحضور وإدارة الوقت وإنجاز المهام";
const emptyAttendanceResult: AttendanceScoreResult = { state: "unavailable", reason: "لم يتم تحميل تفاصيل الحضور بعد.", score: null, scheduleAvailable: false, expectedDays: 0, presentDays: 0, absentDays: 0, completePunchDays: 0, lateDays: 0, lateMinutes: 0, earlyDays: 0, earlyMinutes: 0, incompletePunchDays: 0, missingPunchDays: 0, missingPunches: 0, missingDates: [], unresolvedDates: [], importFiles: [], daily: [] };
const dayLabel = (date: string) => new Intl.DateTimeFormat("ar-LY", { weekday: "long", day: "numeric", month: "short", timeZone: "Africa/Tripoli" }).format(new Date(`${date}T12:00:00Z`));
const minutesLabel = (value: number) => `${toWesternDigits(Math.floor(value / 60))} س ${toWesternDigits(value % 60)} د`;

type Props = {
  employee: EvaluatedEmployee | null;
  month: string;
  userId: string;
  existing: EvaluationRecord | null;
  onClose: () => void;
  onSaved: (message: string) => void;
};

const answers = [
  { score: 4, label: "ممتاز" },
  { score: 3, label: "جيد" },
  { score: 2, label: "متوسط" },
  { score: 1, label: "ضعيف" },
] as const;

export default function EvaluationDialog({ employee, month, userId, existing, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const headingId = useId();
  const descriptionId = useId();
  const answerGroupId = useId();
  const supabase = useMemo(() => createClient(), []);
  const ownEvaluation = existing?.evaluator_id === userId && existing.employee_id === employee?.id && existing.period_month.slice(0, 7) === month ? existing : null;
  const savedItems = new Map(ownEvaluation?.evaluation_items?.map((item) => [item.criterion, item]));
  const savedAttendance = savedItems.get(attendanceCriterion);
  const savedManualReason = savedAttendance?.evidence?.match(/قرار يدوي:\s*([^·]+)/)?.[1]?.trim() ?? "";
  const [scores, setScores] = useState<Criterion[]>(() => {
    const defaults = seedScores(employee?.job_title_name ?? "");
    return defaults.filter((item) => employee?.attendance_required !== false || item.name !== attendanceCriterion).map((item) => {
      const saved = savedItems.get(item.name);
      if (item.name === attendanceCriterion) {
        const percent = saved ? (saved.max_score === 100 ? saved.score : saved.score * 25) : 75;
        return { ...item, score: percent, scorePercent: percent, evidence: saved?.evidence ?? "" };
      }
      return { ...item, score: saved?.score ?? item.score, evidence: saved?.evidence ?? "" };
    });
  });
  const [notes, setNotes] = useState(ownEvaluation?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attendanceDetailsOpen, setAttendanceDetailsOpen] = useState(false);
  const attendanceDetailsDialog = useRef<HTMLDialogElement>(null);
  const [attendanceTouched, setAttendanceTouched] = useState(Boolean(savedAttendance?.max_score === 100 && savedManualReason));
  const attendanceTouchedRef = useRef(Boolean(savedAttendance?.max_score === 100 && savedManualReason));
  const [attendanceSystemAccepted, setAttendanceSystemAccepted] = useState(savedAttendance?.max_score === 100 && !savedManualReason);
  const [attendanceDecisionReason, setAttendanceDecisionReason] = useState(savedManualReason);
  const [attendanceData, setAttendanceData] = useState<AttendanceScoreResult>(emptyAttendanceResult);
  const attendanceItem = scores.find((item) => item.name === attendanceCriterion);
  const attendancePercent = attendanceItem?.scorePercent ?? 75;
  const total = scores.reduce((sum, item) => sum + (item.name === attendanceCriterion ? (item.scorePercent ?? 75) / 25 : item.score), 0);
  const maximum = scores.length * 4;
  const percentage = maximum ? (total / maximum) * 100 : 0;
  const template = templateFor(employee?.job_title_name ?? "");
  const passLine = template === "accountant" ? Math.ceil(maximum * (26 / 36)) : template === "sales" ? Math.ceil(maximum * (29 / 40)) : null;

  useEffect(() => {
    if (employee && !dialog.current?.open) dialog.current?.showModal();
  }, [employee]);

  useEffect(() => {
    if (!attendanceDetailsDialog.current) return;
    if (attendanceDetailsOpen && !attendanceDetailsDialog.current.open) attendanceDetailsDialog.current.showModal();
    else if (!attendanceDetailsOpen && attendanceDetailsDialog.current.open) attendanceDetailsDialog.current.close();
  }, [attendanceDetailsOpen]);

  useEffect(() => {
    if (!employee) return;
    if (!employee.attendance_required) {
      setAttendanceData({ ...emptyAttendanceResult, state: "exempt", reason: "الموظف معفى من تسجيل البصمة؛ لا يُحتسب بند حضور آلي في تقييمه." });
      setScores((current) => current.filter((item) => item.name !== attendanceCriterion));
      return;
    }
    let cancelled = false;
    setAttendanceData({ ...emptyAttendanceResult, state: "unavailable", reason: "جارٍ تحميل سجلات الشهر…" });
    const start = `${month}-01`;
    const endDate = new Date(`${start}T12:00:00Z`);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    endDate.setUTCDate(0);
    const end = endDate.toISOString().slice(0, 10);
    void (async () => {
      try {
        const [recordsResult, importsResult, eventsResult] = await Promise.all([
          supabase.from("attendance_records").select("attendance_date,first_in,last_out,status,exception_note,reviewed_at").eq("employee_id", employee.id).gte("attendance_date", start).lte("attendance_date", end).order("attendance_date"),
          supabase.from("attendance_imports").select("source_file,period_start,period_end").eq("branch_id", employee.branch_id).gte("period_end", start).lte("period_start", end).order("period_start"),
          supabase.from("hr_events").select("event_type,effective_date,end_date").eq("employee_id", employee.id).eq("status", "approved").in("event_type", ["leave", "mission", "late_permission", "permission"]).lte("effective_date", end).or(`end_date.is.null,end_date.gte.${start}`),
        ]);
        const failed = [recordsResult, importsResult, eventsResult].find((result) => result.error);
        if (failed?.error) throw failed.error;
        const result = calculateAttendanceScore({
          employeeRequired: employee.attendance_required,
          month,
          records: (recordsResult.data ?? []) as AttendanceScoreRecord[],
          imports: (importsResult.data ?? []) as AttendanceScoreImport[],
          events: (eventsResult.data ?? []) as AttendanceScoreEvent[],
        });
        if (cancelled) return;
        setAttendanceData(result);
        if ((result.state === "ready" || result.state === "provisional") && !attendanceTouchedRef.current && !savedAttendance && result.score !== null) {
          setScores((current) => current.map((item) => item.name === attendanceCriterion ? { ...item, score: result.score!, scorePercent: result.score } : item));
        }
      } catch (loadError) {
        if (cancelled) return;
        setAttendanceData({ ...emptyAttendanceResult, state: "unavailable", reason: loadError instanceof Error ? `تعذر قراءة بيانات الحضور: ${loadError.message}` : "تعذر قراءة بيانات الحضور لهذا الحساب." });
      }
    })();
    return () => { cancelled = true; };
  }, [employee?.id, employee?.branch_id, employee?.attendance_required, month, supabase, savedAttendance?.score, savedAttendance?.max_score, savedAttendance?.evidence]);

  function close() {
    if (!submitting.current) onClose();
  }

  function updateItem(index: number, updates: Partial<Pick<Criterion, "score" | "evidence" | "scorePercent">>) {
    setScores((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...updates } : item));
  }

  function updateAttendancePercent(value: number) {
    attendanceTouchedRef.current = true;
    setAttendanceTouched(true);
    setAttendanceSystemAccepted(false);
    updateItem(scores.findIndex((item) => item.name === attendanceCriterion), { score: value, scorePercent: value });
  }

  function approveSystemAttendanceScore() {
    if (attendanceData.score === null) return;
    attendanceTouchedRef.current = false;
    setAttendanceTouched(false);
    setAttendanceSystemAccepted(true);
    setAttendanceDecisionReason("");
    updateItem(scores.findIndex((item) => item.name === attendanceCriterion), { score: attendanceData.score, scorePercent: attendanceData.score });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employee || submitting.current) return;
    const invalidStandardScore = scores.some((item) => item.name !== attendanceCriterion && (!Number.isInteger(item.score) || item.score < 1 || item.score > 4));
    const invalidAttendanceScore = Boolean(attendanceItem && (!Number.isInteger(attendanceItem.scorePercent) || attendanceItem.scorePercent! < 0 || attendanceItem.scorePercent! > 100));
    if (!scores.length || invalidStandardScore || invalidAttendanceScore) {
      setError("اختر درجة من 1 إلى 4 لكل بند، ودرجة من 0 إلى 100 للحضور.");
      return;
    }
    if (attendanceItem && (attendanceTouched || (attendanceData.state !== "ready" && !attendanceSystemAccepted)) && !attendanceDecisionReason.trim()) {
      setError("اكتب سبب التقييم اليدوي للحضور قبل حفظ التقييم.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const { error: saveError } = await supabase.rpc("submit_employee_evaluation", {
        p_employee_id: employee.id,
        p_period_month: `${month}-01`,
        p_notes: notes,
        p_items: scores.map((item) => ({
          criterion: item.name,
          score: item.name === attendanceCriterion ? item.scorePercent ?? 75 : item.score,
          max_score: item.name === attendanceCriterion ? 100 : 4,
          evidence: item.name === attendanceCriterion
            ? [`${attendanceData.score !== null ? `درجة النظام المقترحة: ${toWesternDigits(String(attendanceData.score))}/100` : attendanceData.reason}`, `الدرجة النهائية: ${toWesternDigits(String(item.scorePercent ?? 75))}/100`, attendanceTouched || (attendanceData.state !== "ready" && !attendanceSystemAccepted) ? `قرار يدوي: ${attendanceDecisionReason.trim()}` : attendanceData.state === "provisional" ? "اعتماد درجة النظام المؤقتة" : "اعتماد درجة النظام", `الحضور: ${attendanceData.presentDays} من ${attendanceData.expectedDays} يومًا`, `التأخير: ${attendanceData.lateDays} يومًا، ${minutesLabel(attendanceData.lateMinutes)}`, `الانصراف المبكر: ${attendanceData.earlyDays} يومًا، ${minutesLabel(attendanceData.earlyMinutes)}`, `البصمات المكتملة: ${attendanceData.completePunchDays} من ${attendanceData.presentDays}`, `البصمات الناقصة: ${attendanceData.missingPunches}`, `سجلات تحتاج مراجعة: ${attendanceData.unresolvedDates.length}`].join(" · ")
            : item.evidence,
        })),
      });
      if (saveError) {
        setError(`تعذر حفظ التقييم: ${saveError.message}`);
        return;
      }
      onSaved(`تم حفظ تقييم ${employeeName(employee)} لشهر ${monthLabel(month)}.`);
    } catch {
      setError("تعذر الاتصال لحفظ التقييم. حاول مرة أخرى.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (!employee) return null;

  return <dialog
    ref={dialog}
    className="evaluation-answer-dialog"
    dir="rtl"
    aria-labelledby={headingId}
    aria-describedby={descriptionId}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClose={close}
  >
    <form className="evaluation-answer-form" onSubmit={save} aria-busy={busy}>
      <header className="evaluation-answer-header">
        <div>
          <span className="evaluation-answer-eyebrow">تقييم أداء الموظفين</span>
          <h2 id={headingId}>{ownEvaluation ? "تحديث تقييمي" : "تقييم جديد"}</h2>
          <p id={descriptionId}>اختر الدرجة المناسبة لكل بند، ثم راجع النتيجة واحفظ تقييمك.</p>
        </div>
        <button type="button" className="evaluation-answer-close" onClick={close} disabled={busy} aria-label="إغلاق نافذة التقييم">×</button>
      </header>

      <div className="evaluation-answer-body">
        <section className="evaluation-answer-context" aria-label="بيانات الموظف وفترة التقييم">
          <div className="evaluation-answer-person">
            <span className="evaluation-answer-avatar" aria-hidden="true">{employeeName(employee).trim().slice(0, 1)}</span>
            <div><h3>{employeeName(employee)}</h3><p>{employee.job_title_name || "موظف"}{employee.branch_name ? ` · ${employee.branch_name}` : ""}</p><small>{toWesternDigits(employee.employee_number)}</small></div>
          </div>
          <div className="evaluation-answer-period"><span>شهر التقييم</span><strong>{monthLabel(month)}</strong></div>
        </section>

        <section className="evaluation-answer-summary" aria-label="نتيجة تقييمي الحالية">
          <div><span>مجموع نقاطي</span><strong><bdi dir="ltr">{toWesternDigits(total.toFixed(1))} <small>/ {toWesternDigits(maximum)}</small></bdi></strong></div>
          <div className="evaluation-answer-percentage"><span>نسبة التقييم</span><strong>{toWesternDigits(percentage.toFixed(1))}<small>%</small></strong></div>
          <p>{passLine !== null ? <>حد الأداء المقبول <b>{toWesternDigits(passLine)} من {toWesternDigits(maximum)}</b><span className={total >= passLine ? "is-passing" : "is-below"}>{total >= passLine ? "أداء مقبول" : "أقل من الحد المقبول"}</span></> : <>النتيجة تتحدث مع كل إجابة.<br />تُحفظ مستقلة باسمك.</>}</p>
        </section>

        <div className="evaluation-answer-section-heading"><div><h3>بنود التقييم</h3><p>كل بند من 4 نقاط، باستثناء الحضور فيُحسب من 100 ثم يُوزن كبند واحد.</p></div><span>{toWesternDigits(scores.length)} بنود</span></div>

        <fieldset className="evaluation-answer-questions" disabled={busy}>
          <legend className="sr-only">اختر درجة لكل بند من بنود التقييم</legend>
          {scores.map((item, index) => <fieldset className="evaluation-answer-question" key={item.name}>
            <legend><span className="evaluation-answer-number">{toWesternDigits(index + 1)}</span><span>{item.name}</span></legend>
            {item.name === attendanceCriterion ? <div className="evaluation-attendance-score">
              <div className="evaluation-attendance-score-head"><span className={`evaluation-attendance-status ${attendanceData.state}`}><i/>{attendanceData.state === "ready" ? "درجة النظام جاهزة" : attendanceData.state === "provisional" ? "درجة مؤقتة للمراجعة" : attendanceData.state === "incomplete" ? "البيانات تحتاج استكمالًا" : attendanceData.state === "exempt" ? "غير منطبق" : "درجة يدوية"}</span><button type="button" className="evaluation-attendance-details-button" onClick={() => setAttendanceDetailsOpen(true)}>اطلاع على التفاصيل</button></div>
              <p className="evaluation-attendance-source-note">{attendanceData.reason}</p>
              <div className="evaluation-attendance-current"><span>الدرجة النهائية</span><strong><bdi dir="ltr">{toWesternDigits(String(attendancePercent))}<small>/100</small></bdi></strong>{attendanceData.score !== null && <span className="evaluation-attendance-proposal">درجة النظام: {toWesternDigits(String(attendanceData.score))}/100{attendanceData.state === "provisional" ? " · مؤقتة" : ""}</span>}</div>
              <div className="evaluation-attendance-quick-metrics"><span>الحضور <b>{toWesternDigits(String(attendanceData.presentDays))}/{toWesternDigits(String(attendanceData.expectedDays))}</b></span><span>التأخير <b>{toWesternDigits(String(attendanceData.lateDays))} أيام · {minutesLabel(attendanceData.lateMinutes)}</b></span><span>بصمات ناقصة <b>{toWesternDigits(String(attendanceData.missingPunches))}</b></span></div>
              <input className="evaluation-attendance-slider" type="range" min="0" max="100" step="1" value={attendancePercent} onChange={(event) => updateAttendancePercent(Number(event.target.value))} aria-label="درجة الحضور النهائية من 100" style={{ "--attendance-score-fill": `${attendancePercent}%` } as CSSProperties} />
              <div className="evaluation-attendance-slider-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
              {attendanceData.score !== null && (!attendanceSystemAccepted || attendancePercent !== attendanceData.score) && <button type="button" className="evaluation-attendance-accept-button" onClick={approveSystemAttendanceScore}>اعتماد درجة النظام {toWesternDigits(String(attendanceData.score))}/100{attendanceData.state === "provisional" ? " (مؤقتة)" : ""}</button>}
              {(attendanceTouched || (attendanceData.state !== "ready" && !attendanceSystemAccepted)) && <label className="evaluation-attendance-reason"><span>سبب القرار اليدوي <b>مطلوب</b></span><textarea rows={2} value={attendanceDecisionReason} onChange={(event) => setAttendanceDecisionReason(event.target.value)} placeholder="اكتب سبب تعديل درجة النظام أو سبب التقييم اليدوي…" /></label>}
            </div> : <>
            <div className="evaluation-answer-options">
              {answers.map((answer) => <label key={answer.score} className={`evaluation-answer-option score-${answer.score}${item.score === answer.score ? " is-selected" : ""}`}>
                <input type="radio" name={`${answerGroupId}-${index}`} value={answer.score} checked={item.score === answer.score} onChange={() => updateItem(index, { score: answer.score })} required />
                <span className="evaluation-answer-score">{toWesternDigits(answer.score)}</span>
                <span>{answer.label}</span>
                <span className="evaluation-answer-check" aria-hidden="true">✓</span>
              </label>)}
            </div>
            <details className="evaluation-answer-evidence" open={item.evidence ? true : undefined}>
              <summary>{item.evidence ? "ملاحظة على هذا البند" : "إضافة ملاحظة أو مثال"}<span>اختياري</span></summary>
              <label><span className="sr-only">ملاحظة على البند: {item.name}</span><textarea rows={2} value={item.evidence} onChange={(event) => updateItem(index, { evidence: event.target.value })} placeholder="اكتب مثالًا أو ملاحظة تدعم الدرجة المختارة…" /></label>
            </details>
            </>}
          </fieldset>)}
        </fieldset>

        <label className="evaluation-answer-notes"><span>الملاحظات العامة <small>اختياري</small></span><textarea rows={3} disabled={busy} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="نقاط القوة، وما يحتاج إلى تحسين، وأي توصيات للشهر القادم…" /></label>
        {error && <p className="evaluation-answer-error" role="alert">{error}</p>}
      </div>

      <footer className="evaluation-answer-footer">
        <div className="evaluation-answer-footer-total"><span>النتيجة الحالية</span><strong><bdi dir="ltr">{toWesternDigits(total.toFixed(1))} / {toWesternDigits(maximum)} <small>· {toWesternDigits(percentage.toFixed(1))}%</small></bdi></strong><p>تقييمك مستقل عن تقييمات المسؤولين الآخرين.</p></div>
        <div className="evaluation-answer-footer-actions"><button type="button" className="evaluation-answer-cancel" onClick={close} disabled={busy}>إلغاء</button><button type="submit" className="evaluation-answer-submit" disabled={busy}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m5 10 3.2 3.2L15 6.5" strokeLinecap="round" strokeLinejoin="round" /></svg>{busy ? "جارٍ الحفظ…" : ownEvaluation ? "حفظ التعديلات" : "حفظ التقييم"}</button></div>
      </footer>
    </form>
    <dialog ref={attendanceDetailsDialog} className="attendance-score-details-dialog" dir="rtl" aria-labelledby="attendance-score-details-title" onCancel={(event) => { event.preventDefault(); setAttendanceDetailsOpen(false); }} onClose={() => setAttendanceDetailsOpen(false)}>
      <div className="attendance-score-details-content">
        <header><div><span>سجلات الشهر</span><h2 id="attendance-score-details-title">تفاصيل احتساب الحضور</h2><p>{employeeName(employee)} · {monthLabel(month)}</p></div><button type="button" onClick={() => setAttendanceDetailsOpen(false)} aria-label="إغلاق">×</button></header>
        <div className="attendance-score-details-body">
          <p className={`attendance-score-details-state ${attendanceData.state}`} role="status">{attendanceData.reason}</p>
          <section className="attendance-score-breakdown"><h3>طريقة احتساب الدرجة</h3><div><span>الحضور الفعلي</span><b>حتى 60 نقطة · الحاضر ÷ أيام الدوام × 60</b></div><div><span>الدخول والانصراف</span><b>حتى 25 نقطة · التأخير والخروج المبكر نسبةً إلى دقائق الدوام</b></div><div><span>اكتمال البصمة</span><b>حتى 15 نقطة · عدد البصمات المسجلة ÷ (2 × أيام الحضور) × 15</b></div><small>دوام جميع الفروع: السبت إلى الأربعاء من 09:00 إلى 17:00، الخميس إلى 14:30، والجمعة عطلة. يبدأ حساب التأخير بعد 09:15 حسب قاعدة تقرير التأخير الشهري. تُستثنى الإجازات والمأموريات والأذونات المعتمدة.</small></section>
          <section className="attendance-score-detail-metrics"><article><small>{attendanceData.scheduleAvailable ? attendanceData.state === "provisional" ? "أيام الدوام المغطاة" : "أيام الدوام" : "أيام بسجلات مستوردة"}</small><b>{toWesternDigits(String(attendanceData.expectedDays))}</b></article><article><small>حضور</small><b>{toWesternDigits(String(attendanceData.presentDays))}</b></article><article><small>غياب مسجل</small><b>{toWesternDigits(String(attendanceData.absentDays))}</b></article><article><small>بصمات مكتملة</small><b>{toWesternDigits(String(attendanceData.completePunchDays))}/{toWesternDigits(String(attendanceData.presentDays))}</b></article><article><small>بصمات ناقصة</small><b>{toWesternDigits(String(attendanceData.missingPunches))} خلال {toWesternDigits(String(attendanceData.missingPunchDays))} أيام</b></article><article><small>التأخير</small><b>{toWesternDigits(String(attendanceData.lateDays))} أيام · {minutesLabel(attendanceData.lateMinutes)}</b></article><article><small>خروج مبكر</small><b>{attendanceData.scheduleAvailable ? `${toWesternDigits(String(attendanceData.earlyDays))} أيام · ${minutesLabel(attendanceData.earlyMinutes)}` : "غير محسوب"}</b></article><article><small>سجلات تحتاج مراجعة</small><b>{toWesternDigits(String(attendanceData.unresolvedDates.length))}</b></article></section>
          {(attendanceData.missingDates.length > 0 || attendanceData.unresolvedDates.length > 0) && <div className="attendance-score-detail-warnings">{attendanceData.missingDates.length > 0 && <p><b>أيام بلا سجل:</b> {attendanceData.missingDates.map(dayLabel).join("، ")}</p>}{attendanceData.unresolvedDates.length > 0 && <p><b>بصمات تحتاج مراجعة:</b> {attendanceData.unresolvedDates.map(dayLabel).join("، ")}</p>}</div>}
          {attendanceData.daily.length > 0 && <section className="attendance-score-daily"><h3>السجلات اليومية</h3>{attendanceData.daily.map((day) => <article key={day.date}><b>{dayLabel(day.date)}</b><span>دخول: {day.firstIn ? toWesternDigits(day.firstIn) : "—"}</span><span>انصراف: {day.lastOut ? toWesternDigits(day.lastOut) : "—"}</span><span>{[day.status === "absent" ? "غياب" : "", day.missingPunches ? `بصمة ناقصة (${day.missingPunches})` : "", day.late ? `تأخير ${minutesLabel(day.late)}` : "", day.early ? `انصراف مبكر ${minutesLabel(day.early)}` : "", !attendanceData.scheduleAvailable ? "الانصراف المبكر غير محسوب" : day.exempted ? "إذن معتمد" : ""].filter(Boolean).join(" · ") || "لا توجد مخالفة وقت"}</span></article>)}</section>}
          {attendanceData.importFiles.length > 0 && <p className="attendance-score-detail-files"><b>ملفات الاستيراد:</b> {attendanceData.importFiles.join("، ")}</p>}
          {attendanceData.score !== null && <strong className="attendance-score-detail-result">{attendanceData.state === "provisional" ? "الدرجة المؤقتة للفترة المستوردة" : "درجة النظام المقترحة"}: {toWesternDigits(String(attendanceData.score))}/100</strong>}
        </div>
        <footer><button type="button" onClick={() => setAttendanceDetailsOpen(false)}>إغلاق التفاصيل</button></footer>
      </div>
    </dialog>
  </dialog>;
}
