"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { HREvent } from "./EffectsWorkspace";

export default function EffectReportEditor({ event }: { event: HREvent }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [start, setStart] = useState(event.effective_date);
  const [end, setEnd] = useState(event.end_date ?? "");
  const [reason, setReason] = useState(event.reason ?? "");
  const [amount, setAmount] = useState(event.amount?.toString() ?? "");
  const [editReason, setEditReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const canEditAmount = event.event_type === "deduction" || (event.event_type === "leave" && event.status === "approved");
  const name = event.employee?.full_name || [event.employee?.first_name,event.employee?.last_name].filter(Boolean).join(" ");

  function openEditor() {
    setStart(event.effective_date);setEnd(event.end_date ?? "");setReason(event.reason ?? "");setAmount(event.amount?.toString() ?? "");setEditReason("");setMessage("");setSaved(false);
    dialog.current?.showModal();
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();setMessage("");setBusy(true);
    try {
      const { error } = await createClient().rpc("admin_correct_hr_report", {
        p_event_id:event.id,p_expected_revision:event.report_revision ?? 0,p_expected_status:event.status,
        p_effective_date:start,p_end_date:event.event_type === "leave" ? end || null : event.end_date,
        p_reason:reason.trim(),p_amount:canEditAmount ? amount.trim() ? Number(amount) : null : event.amount,p_edit_reason:editReason.trim(),
      });
      if(error) {
        setMessage(/record changed/i.test(error.message) ? "تغير السجل بعد فتحه. أغلق النافذة وحدّث الصفحة ثم حاول مجددًا." : /No report fields/i.test(error.message) ? "لم تغيّر أي بيانات بعد." : /system administrator/i.test(error.message) ? "تعديل التقرير متاح لمدير النظام فقط." : `تعذر حفظ التعديل: ${error.message}`);
        return;
      }
      setSaved(true);setMessage("تم حفظ التعديل وتوثيق القيم السابقة والجديدة في سجل التدقيق.");router.refresh();
    } catch {setMessage("تعذر الاتصال لحفظ التعديل. حاول مرة أخرى.");}
    finally {setBusy(false);}
  }
  return <>
    <button type="button" className="report-action report-action-edit" onClick={openEditor}>تعديل</button>
    <dialog ref={dialog} className="report-record-dialog" aria-label="تعديل سجل التقرير" onCancel={(e)=>{if(busy)e.preventDefault();}}>
      <form onSubmit={save} dir="rtl">
        <header><div><span>صلاحية مدير النظام</span><h2>تعديل سجل التقرير</h2><p>{name} · {event.employee?.employee_number}</p></div><button type="button" className="report-dialog-close" disabled={busy} aria-label="إغلاق تعديل التقرير" onClick={()=>dialog.current?.close()}>×</button></header>
        <div className="report-editor-notice">كل تعديل يُحفظ مع اسم المستخدم ووقته وسببه، والقيم قبل التعديل وبعده. حالة الموافقة وأصحابها تبقى مسجلة.</div>
        <fieldset disabled={busy || saved} className="report-editor-fields">
          <label>تاريخ الإجراء<input type="date" required value={start} max={end || undefined} onChange={e=>setStart(e.target.value)}/></label>
          {event.event_type === "leave" && <label>نهاية الإجازة<input type="date" min={start} value={end} onChange={e=>setEnd(e.target.value)}/></label>}
          {canEditAmount && <label>قيمة الخصم (د.ل)<input type="number" min={event.event_type === "deduction" ? "0.01" : "0"} max="9999999999.99" step="0.01" required={event.event_type === "deduction"} value={amount} onChange={e=>setAmount(e.target.value)}/><small>الخصم المسجل للراتب سيتحدّث بالقيمة الجديدة.</small></label>}
          <label className="wide">سبب الطلب / الإجراء<textarea rows={3} required value={reason} onChange={e=>setReason(e.target.value)}/></label>
          <label className="wide">سبب التعديل (مطلوب للتدقيق)<textarea rows={2} required placeholder="وضح لماذا تحتاج إلى تصحيح هذا السجل…" value={editReason} onChange={e=>setEditReason(e.target.value)}/></label>
        </fieldset>
        {message && <p className={`report-edit-message ${saved ? "success" : "error"}`} role={saved ? "status" : "alert"}>{message}</p>}
        <footer><button type="button" className="secondary-button" disabled={busy} onClick={()=>dialog.current?.close()}>{saved ? "تم" : "إلغاء"}</button>{!saved && <button type="submit" className="primary-button" disabled={busy}>{busy ? "جارٍ حفظ التعديل…" : "حفظ التعديل"}</button>}</footer>
      </form>
    </dialog>
  </>;
}
