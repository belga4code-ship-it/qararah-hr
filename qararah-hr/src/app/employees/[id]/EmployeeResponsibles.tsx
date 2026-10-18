"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Evaluator = { id: string; employee_id: string; name: string };

export default function EmployeeResponsibles({ employeeId, initialResponsibleIds, managers, evaluators, initialEvaluatorIds, canAssign }: { employeeId: string; initialResponsibleIds: string[]; managers: Array<{ profileId: string; employeeId: string; name: string }>; evaluators: Evaluator[]; initialEvaluatorIds: string[]; canAssign: boolean }) {
  const [responsibles, setResponsibles] = useState([initialResponsibleIds[0] ?? "", initialResponsibleIds[1] ?? "", initialResponsibleIds[2] ?? ""]);
  const initialEvaluatorEmployeeIds = initialEvaluatorIds.map((id) => evaluators.find((item) => item.id === id)?.employee_id ?? "");
  const [primary, setPrimary] = useState(initialEvaluatorEmployeeIds[0] ?? "");
  const [secondary, setSecondary] = useState(initialEvaluatorEmployeeIds[1] ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [managerNotice, setManagerNotice] = useState<{ text: string; error: boolean } | null>(null);

  async function saveManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = responsibles.filter(Boolean);
    if (!selected.length) return setManagerNotice({ text: "اختر مسؤولًا واحدًا على الأقل.", error: true });
    if (new Set(selected).size !== selected.length) return setManagerNotice({ text: "اختر أشخاصًا مختلفين في خانات المسؤولين.", error: true });
    setBusy(true); setManagerNotice(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_employee_request_responsibles", { p_employee_id: employeeId, p_responsible_profile_ids: selected });
    setBusy(false);
    setManagerNotice(error ? { text: `تعذر حفظ مسؤول الإجازات والأذونات: ${error.message}`, error: true } : { text: "تم حفظ مسؤول الإجازات والأذونات.", error: false });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!primary) return setNotice({ text: "اختر المسؤول الأول عن تقييم الموظف.", error: true });
    if (primary === secondary) return setNotice({ text: "اختر مسؤولين مختلفين للتقييم.", error: true });
    setBusy(true); setNotice(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_employee_evaluators", { p_employee_id: employeeId, p_primary_evaluator_employee_id: primary, p_secondary_evaluator_employee_id: secondary || null });
    setBusy(false);
    setNotice(error ? { text: `تعذر حفظ مسؤولي التقييم: ${error.message}`, error: true } : { text: "تم حفظ مسؤولي تقييم الموظف.", error: false });
  }

  return <section className="panel employee-form-section employee-responsibles">
    <div className="panel-heading"><div><h2>مسؤولو الموظف</h2><p>حدد الموظفين المكلفين بتقييم هذا الموظف. يمكن إضافة مسؤول أول وآخر احتياطي.</p></div></div>
    {!canAssign && <div className="privacy-note"><strong>عرض فقط</strong><span>تعيين المسؤولين متاح للموارد البشرية ومدير النظام.</span></div>}
    <div className="employee-responsible-block">
      <div><h3>مسؤولو الإجازات والأذونات</h3><p>يمكن تعيين حتى ثلاثة مسؤولين. يحق لأي واحد منهم اعتماد الطلب أو رفضه، ويظل مدير النظام مخولًا أيضًا.</p></div>
      {canAssign ? <form onSubmit={saveManager}><div className="employee-fields-grid">{responsibles.map((responsible, index) => <label className="employee-field" key={index}><span>المسؤول {index + 1}{index === 0 ? " (مطلوب)" : " (اختياري)"}</span><select required={index === 0} value={responsible} onChange={(event) => setResponsibles((current) => current.map((value, slot) => slot === index ? event.target.value : value))}><option value="">{index === 0 ? "اختر المسؤول الأول" : "بدون مسؤول إضافي"}</option>{managers.filter((item) => item.employeeId !== employeeId && (!responsibles.includes(item.profileId) || item.profileId === responsible)).map((item) => <option key={item.profileId} value={item.profileId}>{item.name}</option>)}</select></label>)}</div>{managerNotice && <p className={`employee-save-message ${managerNotice.error ? "error" : "success"}`} role="status">{managerNotice.text}</p>}<div className="employee-responsibles-actions"><button className="primary-button employee-save-button" type="submit" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ مسؤولي الطلبات"}</button></div></form> : <p className="employee-responsible-value">{initialResponsibleIds.length ? initialResponsibleIds.map((id) => managers.find((item) => item.profileId === id)?.name ?? "حساب مرتبط غير ظاهر").join("، ") : "لم يُحدد مسؤول للإجازات والأذونات بعد."}</p>}
    </div>
    <div className="employee-responsible-block">
      <div><h3>مسؤولو التقييم</h3><p>يمكن تعيين مسؤول أول ومسؤول ثانٍ احتياطي للتقييمات الشهرية.</p></div>
      {canAssign ? <form onSubmit={save}>
        <div className="employee-fields-grid">
          <label className="employee-field"><span>المسؤول الأول عن التقييم</span><select value={primary} onChange={(event) => setPrimary(event.target.value)} required><option value="">اختر المسؤول</option>{[...new Map(evaluators.map((item) => [item.employee_id, item])).values()].map((item) => <option key={item.employee_id} value={item.employee_id}>{item.name}</option>)}</select></label>
          <label className="employee-field"><span>المسؤول الثاني عن التقييم (اختياري)</span><select value={secondary} onChange={(event) => setSecondary(event.target.value)}><option value="">بدون مسؤول ثانٍ</option>{[...new Map(evaluators.map((item) => [item.employee_id, item])).values()].map((item) => <option key={item.employee_id} value={item.employee_id} disabled={item.employee_id === primary}>{item.name}</option>)}</select></label>
        </div>
        {!evaluators.length && <p className="employee-responsibles-empty">لا توجد حسابات موظفين مؤهلة للتقييم. اربط حسابًا بموظف ومنحه صفة مدير أو موارد بشرية أو محاسب أولًا.</p>}
        {notice && <p className={`employee-save-message ${notice.error ? "error" : "success"}`} role="status">{notice.text}</p>}
        <div className="employee-responsibles-actions"><button className="primary-button employee-save-button" type="submit" disabled={busy || !evaluators.length}>{busy ? "جارٍ الحفظ…" : "حفظ مسؤولي التقييم"}</button></div>
      </form> : <div className="employee-responsibles-readonly">{initialEvaluatorIds.length ? initialEvaluatorIds.map((id, index) => <p key={id}><strong>{index === 0 ? "المسؤول الأول" : "المسؤول الثاني"}:</strong> {evaluators.find((item) => item.id === id)?.name ?? "حساب مرتبط غير ظاهر"}</p>) : <p>لم يُحدد مسؤول للتقييم بعد.</p>}</div>}
    </div>
  </section>;
}
