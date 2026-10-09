"use client";

import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";

export type EditValues = {
  employee_number: string; full_name: string; zkt_user_id: string; status: string; hired_on: string;
  branch_name: string; department_name: string; job_title_name: string; phone: string;
  salary_amount: string; salary_updated_on: string; education: string; graduation_year: string;
  date_of_birth: string; religion: string; marital_status: string; blood_type: string;
  residency_expires_on: string; emergency_phone: string; emergency_contact_name: string;
  passport_number: string; entered_libya_on: string; home_country: string; address: string;
  notes: string; source_data: Record<string, string | number | null>;
};
type Option = { id: string; name: string };
type TitleOption = Option & { department_id: string | null };

const sourceKeys = ["الكود الوظيفى", "كود البصمة", "الاسم", "الوظيفة", "القسم", "الفرع", "تاريخ التعيين بالشركة", "الحالة", "راتب الموظف تحديث يوليو26", "المؤهل الدراسى", "دفعة التخرج", "تاريخ الميلاد", "الديانة", "الحالة الاجتماعية", "فصيلة الدم", "تاريخ إنتهاء الاقامه", "رقم الجوال", "رقم الرجوع اليه في حالة الطوارئ", "اسم الشخص", "رقم جواز السفر", "تاريخ دخول الى ليبيا", "البلد الام", "العنوان", "ملاحظات / ملاحظات 2026"];
const statusOptions = [["active", "نشط"], ["on_leave", "في إجازة"], ["suspended", "موقوف"], ["terminated", "منتهي الخدمة"], ["needs_review", "يحتاج مراجعة"]];
const statusArabic: Record<string, string> = Object.fromEntries(statusOptions.map(([key, value]) => [key, value]));
const valueLabels: Record<string, string> = { employee_number: "الكود الوظيفي", full_name: "اسم الموظف", zkt_user_id: "كود البصمة", status: "الحالة", hired_on: "تاريخ التعيين", branch_name: "الفرع", department_name: "القسم", job_title_name: "الوظيفة", phone: "رقم الجوال", salary_amount: "الراتب", salary_updated_on: "تاريخ تحديث الراتب", education: "المؤهل الدراسي", graduation_year: "سنة التخرج", date_of_birth: "تاريخ الميلاد", religion: "الديانة", marital_status: "الحالة الاجتماعية", blood_type: "فصيلة الدم", residency_expires_on: "انتهاء الإقامة", emergency_phone: "رقم الطوارئ", emergency_contact_name: "اسم جهة الطوارئ", passport_number: "رقم جواز السفر", entered_libya_on: "تاريخ دخول ليبيا", home_country: "البلد الأم", address: "العنوان", notes: "ملاحظات" };
const groupFields: [string, string[]][] = [["البيانات الوظيفية", ["employee_number", "full_name", "zkt_user_id", "status", "hired_on", "branch_name", "department_name", "job_title_name"]], ["بيانات التواصل", ["phone", "emergency_phone", "emergency_contact_name", "address"]], ["البيانات الشخصية", ["date_of_birth", "religion", "marital_status", "blood_type", "education", "graduation_year", "home_country", "entered_libya_on", "passport_number", "residency_expires_on"]], ["بيانات الراتب والملاحظات", ["salary_amount", "salary_updated_on", "notes"]]];

export default function EmployeeEditor({ employeeId, initialValues, canEdit, branches, departments, jobTitles }: { employeeId: string; initialValues: EditValues; canEdit: boolean; branches: Option[]; departments: Option[]; jobTitles: TitleOption[] }) {
  const [values, setValues] = useState<EditValues>(() => ({ ...initialValues, ...Object.fromEntries(Object.entries(initialValues).filter(([key]) => key !== "source_data").map(([key, value]) => [key, typeof value === "string" ? toWesternDigits(value) : value])), source_data: Object.fromEntries(Object.entries(initialValues.source_data).map(([key, value]) => [key, typeof value === "string" ? toWesternDigits(value) : value])) } as EditValues));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{text:string;error:boolean}|null>(null);
  const set = (key: keyof EditValues, value: string) => setValues((current) => ({ ...current, [key]: toWesternDigits(value) }));
  const visibleTitles = useMemo(() => jobTitles.filter((item) => !values.department_name || !item.department_id || departments.find((d) => d.id === item.department_id)?.name === values.department_name), [jobTitles, departments, values.department_name]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage(null);
    try {
      const supabase = createClient();
      const branchName = values.branch_name.trim();
      const departmentName = values.department_name.trim();
      const titleName = values.job_title_name.trim();
      if (!branchName || !values.employee_number.trim() || !values.full_name.trim()) throw new Error("الكود الوظيفي والاسم والفرع حقول مطلوبة.");
      const branchPayload: { name: string; branch_code?: string } = { name: branchName };
      const branchCode = String(values.source_data["رمز الفرع"] ?? "").trim();
      if (branchCode) branchPayload.branch_code = branchCode;
      const branchResult = await supabase.from("branches").upsert(branchPayload, { onConflict: "name" }).select("id").single();
      if (branchResult.error) throw branchResult.error;
      let departmentId: string | null = null;
      if (departmentName) {
        const departmentResult = await supabase.from("departments").upsert({ name: departmentName }, { onConflict: "name" }).select("id").single();
        if (departmentResult.error) throw departmentResult.error;
        departmentId = departmentResult.data.id;
      }
      let jobTitleId: string | null = null;
      if (titleName) {
        const titleResult = await supabase.from("job_titles").upsert({ name: titleName, department_id: departmentId }, { onConflict: "name,department_id" }).select("id").single();
        if (titleResult.error) throw titleResult.error;
        jobTitleId = titleResult.data.id;
      }

      const employeeResult = await supabase.from("employees").update({ employee_number: values.employee_number.trim(), first_name: values.full_name.trim(), last_name: null, full_name: values.full_name.trim(), zkt_user_id: values.zkt_user_id.trim() || null, status: values.status, hired_on: values.hired_on || null, phone: values.phone.trim() || null, branch_id: branchResult.data.id, department_id: departmentId, job_title_id: jobTitleId }).eq("id", employeeId);
      if (employeeResult.error) throw employeeResult.error;

      const data = { ...values.source_data };
      const mapped: [string, string][] = [["الكود الوظيفى", "employee_number"], ["كود البصمة", "zkt_user_id"], ["الاسم", "full_name"], ["الوظيفة", "job_title_name"], ["القسم", "department_name"], ["الفرع", "branch_name"], ["تاريخ التعيين بالشركة", "hired_on"], ["الحالة", "status"], ["راتب الموظف تحديث يوليو26", "salary_amount"], ["المؤهل الدراسى", "education"], ["دفعة التخرج", "graduation_year"], ["تاريخ الميلاد", "date_of_birth"], ["الديانة", "religion"], ["الحالة الاجتماعية", "marital_status"], ["فصيلة الدم", "blood_type"], ["تاريخ إنتهاء الاقامه", "residency_expires_on"], ["رقم الجوال", "phone"], ["رقم الرجوع اليه في حالة الطوارئ", "emergency_phone"], ["اسم الشخص", "emergency_contact_name"], ["رقم جواز السفر", "passport_number"], ["تاريخ دخول الى ليبيا", "entered_libya_on"], ["البلد الام", "home_country"], ["العنوان", "address"], ["ملاحظات / ملاحظات 2026", "notes"]];
      for (const [rawKey, key] of mapped) {
        const value = values[key as keyof EditValues] as string;
        if (value) data[rawKey] = key === "status" ? statusArabic[value] ?? value : value;
        else delete data[rawKey];
      }
      if (values.salary_amount) data["راتب الموظف تحديث يوليو26"] = Number(values.salary_amount);
      if (values.graduation_year) data["دفعة التخرج"] = Number(values.graduation_year);
      const privateResult = await supabase.from("employee_private").upsert({ employee_id: employeeId, salary_amount: values.salary_amount ? Number(values.salary_amount) : null, salary_updated_on: values.salary_updated_on || null, education: values.education || null, graduation_year: values.graduation_year ? Number(values.graduation_year) : null, date_of_birth: values.date_of_birth || null, religion: values.religion || null, marital_status: values.marital_status || null, blood_type: values.blood_type || null, residency_expires_on: values.residency_expires_on || null, phone: values.phone || null, emergency_phone: values.emergency_phone || null, emergency_contact_name: values.emergency_contact_name || null, passport_number: values.passport_number || null, entered_libya_on: values.entered_libya_on || null, home_country: values.home_country || null, address: values.address || null, notes: values.notes || null, source_data: data }, { onConflict: "employee_id" });
      if (privateResult.error) throw privateResult.error;
      setValues((current) => ({ ...current, source_data: data }));
      setMessage({ text: "تم حفظ التعديلات بنجاح.", error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "تعذر حفظ التعديلات. تحقق من صلاحية الحساب والبيانات." , error: true });
    } finally { setSaving(false); }
  }

  function field(key: string): ReactNode {
    const current = String(values[key as keyof EditValues] ?? "");
    const common = { value: current, onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(key as keyof EditValues, event.target.value), disabled: !canEdit };
    return <label className="employee-field" key={key}><span>{valueLabels[key] ?? key}</span>{key === "status" ? <select {...common}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : key === "branch_name" ? <input {...common} list="branch-options" /> : key === "department_name" ? <input {...common} list="department-options" /> : key === "job_title_name" ? <input {...common} list="title-options" /> : key === "notes" || key === "address" ? <textarea {...common} rows={key === "notes" ? 3 : 2} /> : <input {...common} type="text" dir="ltr" inputMode={["hired_on", "salary_updated_on", "date_of_birth", "residency_expires_on", "entered_libya_on", "salary_amount", "graduation_year"].includes(key) ? "decimal" : undefined} placeholder={["hired_on", "salary_updated_on", "date_of_birth", "residency_expires_on", "entered_libya_on"].includes(key) ? "YYYY-MM-DD" : undefined} />}</label>;
  }

  return <form className="employee-editor" onSubmit={save}>
    {!canEdit && <div className="privacy-note"><strong>عرض للقراءة فقط</strong><span>التعديل والبيانات الخاصة متاحة لحسابات الموارد البشرية والمدير فقط.</span></div>}
    <datalist id="branch-options">{branches.map((item) => <option key={item.id} value={item.name} />)}</datalist><datalist id="department-options">{departments.map((item) => <option key={item.id} value={item.name} />)}</datalist><datalist id="title-options">{visibleTitles.map((item) => <option key={item.id} value={item.name} />)}</datalist>
    {groupFields.map(([group, keys]) => <section className="panel employee-form-section" key={group}><div className="panel-heading"><div><h2>{group}</h2></div></div><div className="employee-fields-grid">{keys.map((key) => field(key))}</div></section>)}
    {canEdit && Object.keys(values.source_data).filter((key) => !sourceKeys.includes(key)).length > 0 && <section className="panel employee-form-section"><div className="panel-heading"><div><h2>حقول إضافية من ملف Excel</h2><p>الحقول الإضافية محفوظة كما وردت في الملف.</p></div></div><div className="employee-fields-grid">{Object.entries(values.source_data).filter(([key]) => !sourceKeys.includes(key)).map(([key, value]) => <label className="employee-field" key={key}><span>{key}</span><input value={toWesternDigits(value)} onChange={(event) => setValues((current) => ({ ...current, source_data: { ...current.source_data, [key]: toWesternDigits(event.target.value) } }))} /></label>)}</div></section>}
    {canEdit && <div className="employee-save-row">{message && <p className={`employee-save-message ${message.error ? "error" : "success"}`} role="status">{message.text}</p>}<button className="primary-button employee-save-button" type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ التعديلات"}</button></div>}
  </form>;
}
