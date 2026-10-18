"use client";

import { useEffect, useRef, useState } from "react";

import type { ApprovalStep } from "./EffectsWorkspace";
import { requestPrintApprovals } from "./request-print-approvals";
import { leaveCalendarDays, requestDeductionText } from "./request-print-details";
import "./EffectRequestPreview.css";

type RequestKind = "leave" | "permission" | "late_permission";

const titles: Record<RequestKind, string> = {
  leave: "نموذج طلب إجازة",
  permission: "نموذج طلب إذن خروج",
  late_permission: "نموذج طلب إذن تأخير",
};

export default function EffectRequestPrintButton({ kind, employeeName, employeeNumber, submittedBy, submitterRole, startDate, endDate, requestedTime, reason, requestId, requestStatus, responsibleIds, approvalSteps, approvalNames, decisionBy, decisionAt, decisionReason, adminOverride = false, deductionAmount, deductionUnit }: {
  kind: RequestKind; employeeName: string; employeeNumber: string; submittedBy: string; submitterRole: string;
  startDate: string; endDate: string | null; requestedTime: string | null; reason: string;
  deductionAmount: number | null; deductionUnit: string | null;
  adminOverride?: boolean; requestId: string; requestStatus: "pending" | "approved" | "rejected"; responsibleIds: string[]; approvalSteps: ApprovalStep[]; approvalNames: Record<string, string>; decisionBy: string | null; decisionAt: string | null; decisionReason: string | null;
}) {
  const preview = useRef<HTMLDialogElement>(null);
  const leaveDays = leaveCalendarDays(startDate, endDate);
  const approvals = requestPrintApprovals({ responsibleIds, approvalSteps, approvalNames, requestStatus, decisionBy, decisionAt, decisionReason });
  const statusText = { approved: "تم الاعتماد إلكترونيًا", rejected: "مرفوض إلكترونيًا", pending: "لم يعتمد بعد", skipped: "لم يعتمد — تم تجاوز المرحلة" };
  const dateText = (value: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat("ar-LY", { timeZone: "Africa/Tripoli", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const reset = () => setPrinting(false);
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, [printing]);
  function printRequest() {
    setPrinting(true);
    window.setTimeout(() => window.print(), 50);
  }
  return <>
    <button type="button" className="secondary-button effect-request-print-button" onClick={() => preview.current?.showModal()}>معاينة وطباعة الطلب</button>
    <dialog ref={preview} className="request-preview-dialog" aria-label="معاينة نموذج الطلب" onClick={(event) => { if (event.target === event.currentTarget) preview.current?.close(); }}>
    <div className="request-preview-toolbar"><strong>معاينة نموذج الطلب</strong><div><button type="button" className="primary-button" onClick={printRequest}>طباعة / حفظ PDF</button><button type="button" className="secondary-button" onClick={() => preview.current?.close()}>إغلاق المعاينة</button></div></div>
    <article className={`effect-request-print-document${printing ? " is-printing" : ""}`} dir="rtl">
      <header className="request-print-header">
        <div className="request-print-hr">الرئيسي<br /><b>HR</b></div>
        <img src="/qararah-logo.jpeg" alt="شركة قرارة" />
      </header>
      <h1>{titles[kind]}</h1>
      <div className="request-print-reference"><span>رقم الطلب: <b dir="ltr">{requestId}</b></span><span>حالة الطلب: <b>{requestStatus === "approved" ? "معتمد" : requestStatus === "rejected" ? "مرفوض" : "قيد المراجعة"}</b></span></div>
      {adminOverride && <p className="request-print-electronic-submission">اعتماد نهائي من مدير النظام مع تجاوز الموافقات المتبقية؛ الموافقات المتجاوزة لا تُنسب إلى أصحابها.</p>}
      <h2>مقدمة لسيادتكم:</h2>
      <div className="request-print-identity">
        <div className="request-print-row"><span>اسم الموظف /</span><b>{employeeName}</b><span>الكود الوظيفي /</span><b dir="ltr">{employeeNumber}</b></div>
        <div className="request-print-row"><span>مقدم الطلب /</span><b>{submittedBy}</b><span>الصفة /</span><b>{submitterRole}</b></div>
      </div>
      {kind === "leave" ? <>
        <p className="request-print-summary">أرجو من سيادتكم التكرم بالموافقة على منحي إجازة <span className="request-print-blank" /> (اعتيادي / بدون راتب).</p>
        <div className="request-print-row"><span>من تاريخ:</span><b>{startDate}</b><span>إلى تاريخ:</span><b>{endDate || "ــــــــــــــــ"}</b><span>عدد الأيام:</span><b>{leaveDays === null ? "غير محدد" : `${leaveDays} ${leaveDays >= 3 && leaveDays <= 10 ? "أيام" : "يوم"}`}</b></div>
      </> : <>
        <p className="request-print-summary">أرجو من سيادتكم التكرم بالموافقة على طلب {kind === "permission" ? "إذن خروج / استئذان" : "إذن تأخير"}.</p>
        <div className="request-print-row"><span>التاريخ:</span><b>{startDate}</b><span>{kind === "permission" ? "وقت الخروج:" : "وقت الوصول المتوقع:"}</span><b>{requestedTime || "ــــــــــــــــ"}</b></div>
      </>}
      {kind === "leave" && <section className="request-print-financial"><div><span>قيمة الخصم على هذا الطلب:</span><strong>{requestDeductionText(requestStatus, deductionAmount, deductionUnit)}</strong></div><small>مدة الإجازة تشمل يوم البداية ويوم النهاية.</small></section>}
      <section className="request-print-reason"><b>السبب والتفاصيل:</b><p>{reason || "ــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ"}</p>{kind === "leave" && <div className="request-print-row"><span>اسم الموظف القائم بعملي خلال فترة الإجازة:</span><b className="request-print-fill" /></div>}</section>
      <p className="request-print-electronic-submission">تم تقديم هذا الطلب إلكترونيًا عبر نظام الموارد البشرية.</p>
      <section className="request-print-approvals"><h2>الاعتمادات الإلكترونية</h2><p className="request-print-approval-note">حالة كل مسؤول مستقلة حسب القرار المسجل في النظام. اعتماد الطلب العام لا يعني اعتماد جميع المسؤولين.</p>
        <div className="request-print-signatures">{approvals.map((approval, index) => <section key={index} className="request-print-approval"><h3>المسؤول {index + 1}</h3><p><b>الاسم:</b> {approval.name}</p><div className={`request-print-electronic-stamp ${approval.status}`}><span aria-hidden="true">{approval.status === "approved" ? "✓" : approval.status === "rejected" ? "×" : "○"}</span><strong>{statusText[approval.status]}</strong></div><p><b>تاريخ القرار:</b> {dateText(approval.date)}</p>{approval.reason && <p className="request-print-decision-reason"><b>{approval.status === "rejected" ? "سبب الرفض" : "ملاحظة القرار"}:</b> {approval.reason}</p>}</section>)}</div>
      </section>
      <section className="request-print-director-signature"><h2>اعتماد المدير العام</h2><div><p><b>التوقيع:</b> ................................................</p><p><b>التاريخ:</b> ........................</p></div></section>
      <footer className="request-print-footer"><span>{kind === "leave" ? "كود النموذج" : "نوع الطلب"}<b>{kind === "leave" ? "G - 06 - 01" : titles[kind]}</b></span><span>شركة قرارة<b>نظام الموارد البشرية</b></span><span>التاريخ<b>{startDate}</b></span></footer>
    </article>
    </dialog>
  </>;
}
