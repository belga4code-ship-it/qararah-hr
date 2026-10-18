"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import GoalIcon from "./GoalIcon";
import "./GoalActions.css";

export type EditableGoal = {
  id: string; period_month: string; title: string; description: string | null;
  target_value: number | null; actual_value: number | null; target_unit: string | null; goal_revision?: number;
};

export default function GoalActions({ goal, onChanged, compact = false }: { goal: EditableGoal; onChanged?: (updated: EditableGoal | null) => void; compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [expectedRevision, setExpectedRevision] = useState(goal.goal_revision ?? 0);
  const [mode, setMode] = useState<"edit" | "delete">("edit");
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description ?? "");
  const [month, setMonth] = useState(goal.period_month.slice(0,7));
  const [target, setTarget] = useState(goal.target_value?.toString() ?? "");
  const [unit, setUnit] = useState(goal.target_unit ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);

  function open(nextMode: "edit" | "delete") {
    setExpectedRevision(goal.goal_revision ?? 0);setMode(nextMode);setTitle(goal.title);setDescription(goal.description ?? "");setMonth(goal.period_month.slice(0,7));
    setTarget(goal.target_value?.toString() ?? "");setUnit(goal.target_unit ?? "");setReason("");setMessage("");setSaved(false);
    dialog.current?.showModal();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();setMessage("");
    if (!reason.trim()) return setMessage("اكتب سبب التعديل أو الحذف قبل الحفظ.");
    if (mode === "edit" && !title.trim()) return setMessage("اكتب اسم الهدف.");
    const targetValue = target.trim() ? Number(target) : null;
    if (mode === "edit" && targetValue !== null && (!Number.isFinite(targetValue) || targetValue < 0 || targetValue > 9999999999.99)) return setMessage("أدخل قيمة مستهدفة صحيحة من صفر فما فوق.");
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = mode === "edit"
        ? await supabase.rpc("update_employee_goal", { p_goal_id:goal.id,p_expected_revision:expectedRevision,p_title:title.trim(),p_description:description.trim() || null,p_period_month:`${month}-01`,p_target_value:targetValue,p_target_unit:unit.trim() || null,p_change_reason:reason.trim() })
        : await supabase.rpc("archive_employee_goal", { p_goal_id:goal.id,p_expected_revision:expectedRevision,p_delete_reason:reason.trim() });
      if (error) {
        setMessage(/No goal fields/i.test(error.message) ? "لم تغيّر أي بيانات للهدف بعد." : /changed|revision|stale/i.test(error.message) ? "تغيّر الهدف أو إنجازه بعد فتح النافذة. أغلقها وحدّث البيانات ثم حاول مجددًا." : /not found|archived|deleted/i.test(error.message) ? "الهدف غير متاح؛ ربما حُذف من حساب آخر. حدّث الصفحة." : /administrat|human resources|HR role/i.test(error.message) ? "هذه العملية متاحة لمدير النظام ومدير الموارد البشرية فقط." : `تعذر حفظ العملية: ${error.message}`);
        return;
      }
      const updated = mode === "delete" ? null : (Array.isArray(data) ? data[0] : data) as EditableGoal;
      if (mode === "edit" && !updated?.id) {setMessage("تعذر التحقق من حفظ الهدف. حدّث البيانات قبل إعادة المحاولة.");return;}
      setSaved(true);setMessage(mode === "edit" ? "تم تعديل الهدف وحفظ سبب التغيير في سجل التدقيق." : "تم حذف الهدف من القوائم مع الاحتفاظ بسجله والإنجاز المسجل.");
      onChanged?.(updated);router.refresh();
    } catch {setMessage("تعذر الاتصال لحفظ العملية. حاول مرة أخرى.");}
    finally {setBusy(false);}
  }

  return <div className="goal-definition-actions">
    <button type="button" onClick={()=>open("edit")} aria-label={`تعديل الهدف: ${goal.title}`} title="تعديل الهدف">{compact && <GoalIcon name="edit"/>}{compact ? "تعديل" : "تعديل الهدف"}</button>
    <button type="button" className="goal-delete-trigger" onClick={()=>open("delete")} aria-label={`حذف الهدف: ${goal.title}`} title="حذف الهدف">{compact && <GoalIcon name="delete"/>}حذف</button>
    <dialog ref={dialog} className="goal-edit-dialog" aria-label={mode === "edit" ? "تعديل الهدف" : "حذف الهدف"} onCancel={event=>{if(busy)event.preventDefault();}}>
      <form onSubmit={save} dir="rtl">
        <header><div><small>مدير النظام · مدير الموارد البشرية</small><h2>{mode === "edit" ? "تعديل الهدف" : "حذف الهدف"}</h2><p>{goal.title}</p></div><button type="button" className="goal-dialog-close" disabled={busy} aria-label="إغلاق نافذة الهدف" onClick={()=>dialog.current?.close()}>×</button></header>
        <div className="goal-change-note">{mode === "delete" ? "سيختفي الهدف من قوائم الأهداف، مع الاحتفاظ ببياناته والإنجاز المسجل وسجل التغييرات." : "يمكن تغيير المستهدف بالزيادة أو النقصان. الإنجاز الفعلي والتقييمات المسجلة تبقى محفوظة."}</div>
        <fieldset disabled={busy || saved}>
          {mode === "edit" && <><label className="wide">اسم الهدف<input required value={title} onChange={event=>setTitle(event.target.value)}/></label><label>الشهر<input type="month" required value={month} onChange={event=>setMonth(event.target.value)}/></label><label>القيمة المستهدفة<input type="number" min="0" max="9999999999.99" step="0.01" value={target} onChange={event=>setTarget(event.target.value)} placeholder="اختياري"/></label><label className="wide">وحدة القياس<input value={unit} onChange={event=>setUnit(event.target.value)} placeholder="زيارة، فاتورة، د.ل…"/></label><label className="wide">تفاصيل الهدف<textarea rows={3} value={description} onChange={event=>setDescription(event.target.value)}/></label></>}
          <label className="wide">{mode === "edit" ? "سبب التعديل (مطلوب)" : "سبب الحذف (مطلوب)"}<textarea rows={2} required value={reason} onChange={event=>setReason(event.target.value)} placeholder={mode === "edit" ? "وضح سبب تصحيح الهدف أو تغيير المستهدف…" : "مثال: أُضيف الهدف بالخطأ…"}/></label>
        </fieldset>
        {message && <p role={saved ? "status" : "alert"} className={`goal-operation-message ${saved ? "success" : "error"}`}>{message}</p>}
        <footer><button type="button" className="secondary-button" disabled={busy} onClick={()=>dialog.current?.close()}>{saved ? "تم" : "إلغاء"}</button>{!saved && <button type="submit" className={mode === "delete" ? "goal-confirm-delete" : "primary-button"} disabled={busy}>{busy ? "جارٍ الحفظ…" : mode === "edit" ? "حفظ التعديل" : "تأكيد حذف الهدف"}</button>}</footer>
      </form>
    </dialog>
  </div>;
}
