"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";
import { employeeName, monthLabel, seedScores, templateFor, type EvaluatedEmployee, type EvaluationRecord, type Criterion } from "./evaluation-model";
import "./EvaluationDialog.css";

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
  const [scores, setScores] = useState<Criterion[]>(() => {
    const defaults = seedScores(employee?.job_title_name ?? "");
    const saved = new Map(ownEvaluation?.evaluation_items?.map((item) => [item.criterion, item]));
    return defaults.map((item) => ({ ...item, score: saved.get(item.name)?.score ?? item.score, evidence: saved.get(item.name)?.evidence ?? "" }));
  });
  const [notes, setNotes] = useState(ownEvaluation?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = scores.reduce((sum, item) => sum + item.score, 0);
  const maximum = scores.length * 4;
  const percentage = maximum ? (total / maximum) * 100 : 0;
  const template = templateFor(employee?.job_title_name ?? "");
  const passLine = template === "accountant" ? 26 : template === "sales" ? 29 : null;

  useEffect(() => {
    if (employee && !dialog.current?.open) dialog.current?.showModal();
  }, [employee]);

  function close() {
    if (!submitting.current) onClose();
  }

  function updateItem(index: number, updates: Partial<Pick<Criterion, "score" | "evidence">>) {
    setScores((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...updates } : item));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employee || submitting.current) return;
    if (!scores.length || scores.some((item) => !Number.isInteger(item.score) || item.score < 1 || item.score > 4)) {
      setError("اختر درجة من 1 إلى 4 لكل بند قبل حفظ التقييم.");
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
        p_items: scores.map((item) => ({ criterion: item.name, score: item.score, max_score: 4, evidence: item.evidence })),
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
          <div><span>مجموع نقاطي</span><strong><bdi dir="ltr">{toWesternDigits(total)} <small>/ {toWesternDigits(maximum)}</small></bdi></strong></div>
          <div className="evaluation-answer-percentage"><span>نسبة التقييم</span><strong>{toWesternDigits(percentage.toFixed(1))}<small>%</small></strong></div>
          <p>{passLine !== null ? <>حد الأداء المقبول <b>{toWesternDigits(passLine)} من {toWesternDigits(maximum)}</b><span className={total >= passLine ? "is-passing" : "is-below"}>{total >= passLine ? "أداء مقبول" : "أقل من الحد المقبول"}</span></> : <>النتيجة تتحدث مع كل إجابة.<br />تُحفظ مستقلة باسمك.</>}</p>
        </section>

        <div className="evaluation-answer-section-heading"><div><h3>بنود التقييم</h3><p>كل بند من 4 نقاط. يمكنك إضافة مثال أو ملاحظة توضح إجابتك.</p></div><span>{toWesternDigits(scores.length)} بنود</span></div>

        <fieldset className="evaluation-answer-questions" disabled={busy}>
          <legend className="sr-only">اختر درجة لكل بند من بنود التقييم</legend>
          {scores.map((item, index) => <fieldset className="evaluation-answer-question" key={item.name}>
            <legend><span className="evaluation-answer-number">{toWesternDigits(index + 1)}</span><span>{item.name}</span></legend>
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
          </fieldset>)}
        </fieldset>

        <label className="evaluation-answer-notes"><span>الملاحظات العامة <small>اختياري</small></span><textarea rows={3} disabled={busy} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="نقاط القوة، وما يحتاج إلى تحسين، وأي توصيات للشهر القادم…" /></label>
        {error && <p className="evaluation-answer-error" role="alert">{error}</p>}
      </div>

      <footer className="evaluation-answer-footer">
        <div className="evaluation-answer-footer-total"><span>النتيجة الحالية</span><strong><bdi dir="ltr">{toWesternDigits(total)} / {toWesternDigits(maximum)} <small>· {toWesternDigits(percentage.toFixed(1))}%</small></bdi></strong><p>تقييمك مستقل عن تقييمات المسؤولين الآخرين.</p></div>
        <div className="evaluation-answer-footer-actions"><button type="button" className="evaluation-answer-cancel" onClick={close} disabled={busy}>إلغاء</button><button type="submit" className="evaluation-answer-submit" disabled={busy}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m5 10 3.2 3.2L15 6.5" strokeLinecap="round" strokeLinejoin="round" /></svg>{busy ? "جارٍ الحفظ…" : ownEvaluation ? "حفظ التعديلات" : "حفظ التقييم"}</button></div>
      </footer>
    </form>
  </dialog>;
}
