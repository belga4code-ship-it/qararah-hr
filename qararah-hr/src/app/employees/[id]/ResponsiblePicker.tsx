"use client";

import { useId, useRef, useState } from "react";
import "./ResponsiblePicker.css";

type Option = { id: string; name: string };
const normalize = (value: string) => value.normalize("NFKD").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").toLocaleLowerCase("ar").trim();

export default function ResponsiblePicker({ label, value, options, onChange, optional = false, disabled = false }: {
  label: string; value: string; options: Option[]; onChange: (id: string) => void; optional?: boolean; disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [search, setSearch] = useState("");
  const selected = options.find((option) => option.id === value);
  const words = normalize(search).split(/\s+/).filter(Boolean);
  const results = options.filter((option) => words.every((word) => normalize(option.name).includes(word))).sort((a, b) => a.name.localeCompare(b.name, "ar"));

  function choose(id: string) {
    onChange(id);
    dialog.current?.close();
  }

  return <div className="employee-field responsible-picker">
    <span>{label}</span>
    <button className="responsible-picker-trigger" type="button" disabled={disabled} aria-haspopup="dialog" aria-label={`${label}: ${selected?.name || "اختر المسؤول"}`} onClick={() => { setSearch(""); dialog.current?.showModal(); }}>
      <span>{selected?.name || (optional ? "بدون مسؤول إضافي" : "اختر المسؤول")}</span><span aria-hidden="true">⌕</span>
    </button>
    <dialog ref={dialog} className="responsible-picker-dialog" aria-labelledby={headingId} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="responsible-picker-content" dir="rtl">
        <header><div><small>اختيار مسؤول الموظف</small><h2 id={headingId}>{label}</h2></div><button type="button" className="responsible-picker-close" aria-label="إغلاق اختيار المسؤول" onClick={() => dialog.current?.close()}>×</button></header>
        <label className="responsible-picker-search"><span>ابحث عن المسؤول بالاسم</span><input autoFocus type="search" placeholder="اكتب الاسم أو جزءًا منه…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <p className="responsible-picker-count" role="status">{results.length} من {options.length} مسؤول متاح · اختر اسمًا لتحديده</p>
        <div className="responsible-picker-results">
          {optional && <button type="button" className="responsible-picker-option responsible-picker-clear" onClick={() => choose("")}>بدون مسؤول إضافي {value === "" && <span>✓</span>}</button>}
          {results.map((option) => <button type="button" key={option.id} className={`responsible-picker-option${option.id === value ? " selected" : ""}`} onClick={() => choose(option.id)} aria-pressed={option.id === value}><span>{option.name}</span><span>{option.id === value ? "✓ محدد" : "اختيار"}</span></button>)}
          {!results.length && <div className="responsible-picker-empty"><strong>{options.length ? "لا توجد أسماء مطابقة" : "لا يوجد مسؤولون متاحون"}</strong><p>{options.length ? "جرّب جزءًا آخر من الاسم أو امسح البحث." : "قد يكون المسؤول مختارًا في خانة أخرى أو غير مؤهل لهذه المهمة."}</p>{search && <button type="button" className="secondary-button" onClick={() => setSearch("")}>مسح البحث</button>}</div>}
        </div>
        <footer>بعد الاختيار، اضغط زر الحفظ في قسم المسؤولين لتثبيت التغييرات.</footer>
      </div>
    </dialog>
  </div>;
}
