"use client";

import { useEffect, useState } from "react";

type RequestKind = "leave" | "permission" | "late_permission";

const titles: Record<RequestKind, string> = {
  leave: "نموذج طلب إجازة",
  permission: "نموذج طلب إذن خروج",
  late_permission: "نموذج طلب إذن تأخير",
};

export default function EffectRequestPrintButton({ kind, employeeName, employeeNumber, submittedBy, submitterRole, startDate, endDate, requestedTime, reason }: {
  kind: RequestKind; employeeName: string; employeeNumber: string; submittedBy: string; submitterRole: string;
  startDate: string; endDate: string | null; requestedTime: string | null; reason: string;
}) {
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
    <button type="button" className="secondary-button effect-request-print-button" onClick={printRequest}>طباعة الطلب</button>
    <article className={`effect-request-print-document${printing ? " is-printing" : ""}`} dir="rtl" aria-hidden="true">
      <header className="request-print-header">
        <div className="request-print-hr">الرئيسي<br /><b>HR</b></div>
        <img src="/qararah-logo.jpeg" alt="شركة قرارة" />
      </header>
      <h1>{titles[kind]}</h1>
      <h2>مقدمة لسيادتكم:</h2>
      <div className="request-print-identity">
        <div className="request-print-row"><span>اسم الموظف /</span><b>{employeeName}</b><span>الكود الوظيفي /</span><b dir="ltr">{employeeNumber}</b></div>
        <div className="request-print-row"><span>مقدم الطلب /</span><b>{submittedBy}</b><span>الصفة /</span><b>{submitterRole}</b></div>
      </div>
      {kind === "leave" ? <>
        <p className="request-print-summary">أرجو من سيادتكم التكرم بالموافقة على منحي إجازة <span className="request-print-blank" /> (اعتيادي / بدون راتب).</p>
        <div className="request-print-row"><span>من تاريخ:</span><b>{startDate}</b><span>إلى تاريخ:</span><b>{endDate || "ــــــــــــــــ"}</b><span>المدة:</span><b>ــــــــ يوم</b></div>
      </> : <>
        <p className="request-print-summary">أرجو من سيادتكم التكرم بالموافقة على طلب {kind === "permission" ? "إذن خروج / استئذان" : "إذن تأخير"}.</p>
        <div className="request-print-row"><span>التاريخ:</span><b>{startDate}</b><span>{kind === "permission" ? "وقت الخروج:" : "وقت الوصول المتوقع:"}</span><b>{requestedTime || "ــــــــــــــــ"}</b></div>
      </>}
      <section className="request-print-reason"><b>السبب والتفاصيل:</b><p>{reason || "ــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ"}</p>{kind === "leave" && <div className="request-print-row"><span>اسم الموظف القائم بعملي خلال فترة الإجازة:</span><b className="request-print-fill" /></div>}</section>
      <div className="request-print-signatures">
        <section><h3>اعتماد المدير المباشر /</h3><p>................................................................................</p><p>التوقيع: ....................................................</p></section>
        <section><h3>{kind === "leave" ? "الموارد البشرية /" : "الإدارة المختصة /"}</h3><p>{kind === "leave" ? "رصيد إجازات الموظف ( يسمح / لا يسمح )" : "القرار: ( موافق / غير موافق )"}</p><p>التوقيع: ....................................................</p></section>
      </div>
      <footer className="request-print-footer"><span>{kind === "leave" ? "كود النموذج" : "نوع الطلب"}<b>{kind === "leave" ? "G - 06 - 01" : titles[kind]}</b></span><span>شركة قرارة<b>نظام الموارد البشرية</b></span><span>التاريخ<b>{startDate}</b></span></footer>
    </article>
  </>;
}
