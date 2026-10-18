"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";
import { employeeName, type EvaluatedEmployee, type EvaluationAssignment, type EvaluatorOption } from "./evaluation-model";
import "./EvaluationAssignmentDialog.css";

const normalize = (value: string) => toWesternDigits(value).trim().toLocaleLowerCase("ar").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/[\u064B-\u065F\u0670\u0640]/g, "");
const accountLabel = (linked: boolean | null) => linked === true ? "حساب النظام مربوط" : linked === false ? "يحتاج حساب نظام مربوط" : "يتم التحقق من الحساب عند الحفظ";
const accountClass = (linked: boolean | null) => linked === true ? " is-linked" : linked === null ? " is-unknown" : "";

function UserIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>;
}

export default function EvaluationAssignmentDialog({ employee, assignments, evaluators, onClose, onSaved }: {
  employee: EvaluatedEmployee;
  assignments: EvaluationAssignment[];
  evaluators: EvaluatorOption[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const supabase = useMemo(() => createClient(), []);
  const employeeAssignments = assignments.filter((item) => item.employee_id === employee.id);
  const [choices, setChoices] = useState<[string, string]>(() => [employeeAssignments.find((item) => item.slot === 1)?.evaluator_employee_id ?? "", employeeAssignments.find((item) => item.slot === 2)?.evaluator_employee_id ?? ""]);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  const candidates = evaluators.filter((candidate) => candidate.employee_id !== employee.id && candidate.employee_id !== choices[activeSlot === 0 ? 1 : 0]);
  const branches = [...new Set(evaluators.filter((candidate) => candidate.employee_id !== employee.id).map((candidate) => candidate.branch_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  const words = normalize(search).split(/\s+/).filter(Boolean);
  const filtered = candidates.filter((candidate) => (!branch || candidate.branch_name === branch) && words.every((word) => normalize([candidate.full_name, candidate.job_title_name, candidate.branch_name].join(" ")).includes(word))).sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));

  function selectedName(slot: 0 | 1) {
    const option = evaluators.find((candidate) => candidate.employee_id === choices[slot]);
    if (option) return option.full_name;
    const assigned = employeeAssignments.find((item) => item.slot === slot + 1 && item.evaluator_employee_id === choices[slot])?.evaluator_employee;
    return assigned?.full_name || [assigned?.first_name, assigned?.last_name].filter(Boolean).join(" ") || "المسؤول المسند حاليًا";
  }

  function close() { if (!busyRef.current) onClose(); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const [primary, secondary] = choices;
    if (!primary) { setError("اختر المقيّم الأول قبل حفظ الإسناد."); setActiveSlot(0); return; }
    if (primary === employee.id || secondary === employee.id) { setError("لا يمكن إسناد تقييم الموظف إلى نفسه."); return; }
    if (primary === secondary) { setError("اختر مسؤولين مختلفين للتقييم الأول والثاني."); return; }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const { error: saveError } = await supabase.rpc("set_employee_evaluators", {
        p_employee_id: employee.id,
        p_primary_evaluator_employee_id: primary,
        p_secondary_evaluator_employee_id: secondary || null,
      });
      if (saveError) { setError(`تعذر حفظ المقيّمين: ${saveError.message}`); return; }
      onSaved(`تم حفظ المسؤولين عن تقييم ${employeeName(employee)}.`);
    } catch {
      setError("تعذر الاتصال. حاول حفظ الإسناد مرة أخرى.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <dialog ref={dialogRef} className="evaluation-assignment-dialog" dir="rtl" aria-labelledby="evaluation-assignment-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <form onSubmit={save} className="evaluation-assignment-dialog-form">
      <header className="evaluation-assignment-dialog-header">
        <div><span className="evaluation-assignment-dialog-eyebrow">التقييمات الشهرية</span><h2 id="evaluation-assignment-dialog-title">المسؤولون عن التقييم</h2><p>اختر المقيّم الأول، وأضف مقيّمًا ثانيًا عند الحاجة.</p></div>
        <button type="button" className="evaluation-assignment-dialog-close" aria-label="إغلاق إسناد التقييم" disabled={busy} onClick={close}>×</button>
      </header>

      <fieldset className="evaluation-assignment-dialog-body" disabled={busy}>
        <div className="evaluation-assignment-dialog-employee"><span className="evaluation-assignment-dialog-avatar"><UserIcon /></span><div><strong>{employeeName(employee)}</strong><small>{[employee.job_title_name, employee.branch_name, toWesternDigits(employee.employee_number)].filter(Boolean).join(" · ")}</small></div></div>
        <div className="evaluation-assignment-dialog-slots" aria-label="اختيار موضع المقيّم">
          {([0, 1] as const).map((slot) => {
            const selected = evaluators.find((candidate) => candidate.employee_id === choices[slot]);
            return <div key={slot} className={`evaluation-assignment-dialog-slot${activeSlot === slot ? " is-active" : ""}`}>
              <button type="button" className="evaluation-assignment-dialog-slot-button" aria-pressed={activeSlot === slot} onClick={() => { setActiveSlot(slot); setError(""); }}><span className="evaluation-assignment-dialog-slot-label">{slot === 0 ? "المقيّم الأول" : "المقيّم الثاني"}<small>{slot === 0 ? "مطلوب" : "اختياري"}</small></span><strong>{choices[slot] ? selectedName(slot) : "اختر مسؤولًا"}</strong><span className="evaluation-assignment-dialog-slot-hint">{choices[slot] ? "اضغط لتغيير المسؤول" : "اختر من القائمة أدناه"}</span></button>
              {selected && <small className={`evaluation-assignment-dialog-account${accountClass(selected.has_system_account)}`}>{accountLabel(selected.has_system_account)}</small>}
              {slot === 1 && choices[1] && <button type="button" className="evaluation-assignment-dialog-remove" onClick={() => { setChoices((current) => [current[0], ""]); setError(""); }}>إزالة المقيّم الثاني</button>}
            </div>;
          })}
        </div>

        <section className="evaluation-assignment-dialog-picker" aria-label={activeSlot === 0 ? "اختيار المقيّم الأول" : "اختيار المقيّم الثاني"}>
          <div className="evaluation-assignment-dialog-picker-heading"><strong>{activeSlot === 0 ? "اختر المقيّم الأول" : "اختر المقيّم الثاني"}</strong><span>{toWesternDigits(filtered.length)} نتيجة</span></div>
          <div className="evaluation-assignment-dialog-filters">
            <label className="evaluation-assignment-dialog-search"><span>البحث عن مسؤول</span><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></svg><input autoFocus type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="الاسم أو الصفة الوظيفية…" /></div></label>
            <label className="evaluation-assignment-dialog-branch"><span>الفرع</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">كل الفروع</option>{branches.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          </div>
          <ul className="evaluation-assignment-dialog-results">{filtered.length ? filtered.map((candidate) => <li key={candidate.employee_id}><button type="button" className={choices[activeSlot] === candidate.employee_id ? "is-selected" : ""} aria-pressed={choices[activeSlot] === candidate.employee_id} disabled={candidate.has_system_account === false} onClick={() => { setChoices((current) => activeSlot === 0 ? [candidate.employee_id, current[1]] : [current[0], candidate.employee_id]); setError(""); }}><span className="evaluation-assignment-dialog-candidate-avatar">{candidate.full_name.trim().charAt(0) || "م"}</span><span className="evaluation-assignment-dialog-candidate"><strong>{candidate.full_name}</strong><small>{[candidate.job_title_name, candidate.branch_name].filter(Boolean).join(" · ")}</small><small className={`evaluation-assignment-dialog-account${accountClass(candidate.has_system_account)}`}>{accountLabel(candidate.has_system_account)}</small></span><span className="evaluation-assignment-dialog-choose">{choices[activeSlot] === candidate.employee_id ? "✓ تم الاختيار" : candidate.has_system_account === false ? "غير متاح" : "اختيار"}</span></button></li>) : <li className="evaluation-assignment-dialog-empty">لا يوجد مسؤول يطابق البحث والفرع.{(search || branch) && <button type="button" onClick={() => { setSearch(""); setBranch(""); }}>مسح الفلاتر</button>}</li>}</ul>
        </section>
        <p className="evaluation-assignment-dialog-note">يُحفظ تقييم كل مسؤول باسمه. يلزم أن يكون المقيّم موظفًا نشطًا وله حساب نظام مربوط وصلاحية التقييم قبل حفظ الإسناد.</p>
      </fieldset>
      {error && <p className="evaluation-assignment-dialog-error" role="alert">{error}</p>}
      <footer className="evaluation-assignment-dialog-footer"><span>{choices.filter(Boolean).length === 2 ? "مسؤولان عن تقييم الموظف" : choices[0] ? "مسؤول واحد عن تقييم الموظف" : "المقيّم الأول مطلوب"}</span><div><button type="button" className="evaluation-assignment-dialog-cancel" onClick={close} disabled={busy}>إلغاء</button><button type="submit" className="evaluation-assignment-dialog-submit" disabled={busy || !choices[0]}>{busy ? "جارٍ الحفظ…" : "حفظ الإسناد"}</button></div></footer>
    </form>
  </dialog>;
}
