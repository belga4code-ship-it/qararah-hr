"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWesternDigits } from "@/lib/digits";
import "./GoalCreateDialog.css";

export type GoalEmployeeOption = {
  id: string;
  full_name: string;
  employee_number: string;
  branch_name: string;
  branch_id: string | null;
  department_name: string;
  department_id: string | null;
};

type Props = {
  employees: GoalEmployeeOption[];
  defaultEmployeeId: string;
  defaultMonth: string;
  tasksAvailable: boolean;
  onCreated: (result: { employeeId: string; month: string; warning?: string }) => void;
};

function normalizeSearch(value: string) {
  return toWesternDigits(value)
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLocaleLowerCase("ar")
    .trim();
}

type GoalTaskDraft = { title: string; due_date: string };
function dueDateFor(month: string) { if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) return ""; const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(10); return date.toISOString().slice(0, 10); }

export default function GoalCreateDialog({ employees, defaultEmployeeId, defaultMonth, tasksAvailable, onCreated }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const headingId = useId();
  const descriptionId = useId();
  const searchResultsId = useId();
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [pickingEmployee, setPickingEmployee] = useState(!defaultEmployeeId);
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [department, setDepartment] = useState("all");
  const [month, setMonth] = useState(defaultMonth);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [description, setDescription] = useState("");
  const [tasks, setTasks] = useState<GoalTaskDraft[]>([{ title: "", due_date: dueDateFor(defaultMonth) }]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selectedEmployee = employees.find((employee) => employee.id === employeeId);
  const employeeOptions = useMemo(() => employees
    .map((employee) => ({ employee, searchText: normalizeSearch(`${employee.full_name} ${employee.employee_number} ${employee.branch_name} ${employee.department_name}`) }))
    .sort((a, b) => a.employee.full_name.localeCompare(b.employee.full_name, "ar")), [employees]);
  const branches = useMemo(() => [...new Map(employees.map((employee) => [employee.branch_id ?? "unassigned", employee.branch_name || "الفرع غير محدد"])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "ar")), [employees]);
  const departments = useMemo(() => [...new Map(employees
    .filter((employee) => branch === "all" || (employee.branch_id ?? "unassigned") === branch)
    .map((employee) => [employee.department_id ?? "unassigned", employee.department_name || "القسم غير محدد"])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "ar")), [employees, branch]);
  const hasFilters = !!search.trim() || branch !== "all" || department !== "all";
  const filteredEmployees = useMemo(() => {
    const terms = normalizeSearch(search).split(/\s+/).filter(Boolean);
    return employeeOptions.filter(({ employee, searchText }) =>
      (branch === "all" || (employee.branch_id ?? "unassigned") === branch) &&
      (department === "all" || (employee.department_id ?? "unassigned") === department) &&
      terms.every((term) => searchText.includes(term)));
  }, [employeeOptions, search, branch, department]);

  function resetFilters() {
    setSearch("");
    setBranch("all");
    setDepartment("all");
  }

  function changeBranch(nextBranch: string) {
    setBranch(nextBranch);
    if (department !== "all" && !employees.some((employee) =>
      (nextBranch === "all" || (employee.branch_id ?? "unassigned") === nextBranch) &&
      (employee.department_id ?? "unassigned") === department)) setDepartment("all");
  }

  function open() {
    const hasDefaultEmployee = employees.some((employee) => employee.id === defaultEmployeeId);
    setEmployeeId(hasDefaultEmployee ? defaultEmployeeId : "");
    setPickingEmployee(!hasDefaultEmployee);
    resetFilters();
    setMonth(defaultMonth);
    setTitle("");
    setTarget("");
    setUnit("");
    setDescription("");
    setTasks([{ title: "", due_date: dueDateFor(defaultMonth) }]);
    setMessage("");
    dialog.current?.showModal();
    requestAnimationFrame(() => (hasDefaultEmployee ? titleInput : searchInput).current?.focus());
  }

  function close() {
    if (!submitting.current) dialog.current?.close();
  }

  function chooseEmployee(employee: GoalEmployeeOption) {
    setEmployeeId(employee.id);
    setPickingEmployee(false);
    setSearch("");
    setMessage("");
    requestAnimationFrame(() => titleInput.current?.focus());
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setMessage("");
    if (!selectedEmployee) {
      setPickingEmployee(true);
      setMessage("اختر الموظف الذي تريد إضافة الهدف له.");
      requestAnimationFrame(() => searchInput.current?.focus());
      return;
    }
    if (!title.trim()) {
      setMessage("اكتب اسم الهدف قبل الحفظ.");
      titleInput.current?.focus();
      return;
    }
    const taskList = tasks.map(task => ({ title: task.title.trim(), due_date: task.due_date })).filter(task => task.title);
    if (!taskList.length) {
      setMessage("أضف مهمة واحدة على الأقل لكل هدف.");
      return;
    }
    if (taskList.some(task => !task.due_date)) { setMessage("حدد موعد تسليم لكل مهمة."); return; }
    if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) {
      setMessage("اختر شهرًا صحيحًا للهدف.");
      return;
    }
    const targetValue = target.trim() === "" ? null : Number(toWesternDigits(target));
    if (targetValue !== null && (!Number.isFinite(targetValue) || targetValue < 0 || targetValue > 9999999999.99)) {
      setMessage("أدخل قيمة مستهدفة صحيحة بين 0 و9,999,999,999.99، أو اتركها فارغة.");
      return;
    }
    if (targetValue !== null && Math.abs(targetValue * 100 - Math.round(targetValue * 100)) > 0.0001) {
      setMessage("القيمة المستهدفة تقبل منزلتين عشريتين كحد أقصى.");
      return;
    }

    submitting.current = true;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setMessage("تعذر التحقق من حسابك. حدّث الصفحة وسجّل دخولك مجددًا.");
        return;
      }
      const { data: goal, error } = await supabase.from("employee_goals").insert({
        employee_id: selectedEmployee.id,
        period_month: `${month}-01`,
        title: title.trim(),
        description: description.trim() || null,
        target_value: targetValue,
        target_unit: unit.trim() || null,
        created_by: authData.user.id,
      }).select("id").single();
      if (error || !goal) {
        setMessage(/row-level security|permission denied/i.test(error.message)
          ? "لا يملك حسابك صلاحية إضافة هدف لهذا الموظف. حدّث الصفحة للتحقق من الصلاحيات."
          : `تعذر حفظ الهدف: ${error.message}`);
        return;
      }
      const { error: taskError } = await supabase.from("employee_goal_tasks").insert(taskList.map((task, index) => ({ goal_id: goal.id, title: task.title, sort_order: index, due_date: task.due_date, created_by: authData.user.id })));
      if (taskError) {
        dialog.current?.close();
        onCreated({ employeeId: selectedEmployee.id, month, warning: `حُفظ الهدف لكن تعذر حفظ مهامه (${taskError.message}). أضف المهام من تفاصيل الهدف.` });
        return;
      }
      dialog.current?.close();
      onCreated({ employeeId: selectedEmployee.id, month });
    } catch {
      setMessage("تعذر الاتصال لحفظ الهدف. تحقق من الاتصال وحاول مرة أخرى.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="goal-create-trigger" onClick={open} disabled={!tasksAvailable} title={!tasksAvailable ? "طبّق ترحيل مهام الأهداف في قاعدة البيانات أولًا" : undefined}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      إضافة هدف
    </button>
    <dialog ref={dialog} className="goal-create-dialog" dir="rtl" aria-labelledby={headingId} aria-describedby={descriptionId} onCancel={(event) => { if (submitting.current) event.preventDefault(); }}>
      <form className="goal-create-form" onSubmit={save}>
        <header className="goal-create-header">
          <div>
            <span className="goal-create-eyebrow">أهداف الموظفين</span>
            <h2 id={headingId}>إضافة هدف جديد</h2>
            <p id={descriptionId}>اختر الموظف، وحدّد المطلوب منه خلال الشهر.</p>
          </div>
          <button type="button" className="goal-create-close" aria-label="إغلاق نافذة إضافة الهدف" disabled={busy} onClick={close}>×</button>
        </header>

        <fieldset className="goal-create-fields" disabled={busy}>
          <section className="goal-create-employee" aria-label="اختيار الموظف">
            <div className="goal-create-section-label"><span>الموظف <em>مطلوب</em></span>{selectedEmployee && pickingEmployee && <button type="button" onClick={() => setPickingEmployee(false)}>العودة للموظف المحدد</button>}</div>
            {selectedEmployee && !pickingEmployee ? <div className="goal-create-selected">
              <span className="goal-create-avatar" aria-hidden="true">{selectedEmployee.full_name.trim().charAt(0) || "م"}</span>
              <div><strong>{selectedEmployee.full_name}</strong><small><bdi>{selectedEmployee.employee_number || "بدون رقم وظيفي"}</bdi><span>·</span>{selectedEmployee.branch_name || "الفرع غير محدد"}<span>·</span>{selectedEmployee.department_name || "القسم غير محدد"}</small></div>
              <button type="button" onClick={() => { setPickingEmployee(true); requestAnimationFrame(() => searchInput.current?.focus()); }}>تغيير الموظف</button>
            </div> : <div className="goal-create-picker">
              <div className="goal-create-picker-controls">
              <label className="goal-create-search-label"><span>اسم الموظف أو الرقم الوظيفي</span><span className="goal-create-search">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.7" /><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                <input ref={searchInput} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الرقم الوظيفي…" aria-controls={searchResultsId} autoComplete="off" />
              </span></label>
              <div className="goal-create-employee-filters">
                <label><span>الفرع</span><select value={branch} onChange={(event) => changeBranch(event.target.value)} aria-controls={searchResultsId}><option value="all">كل الفروع</option>{branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                <label><span>القسم</span><select value={department} onChange={(event) => setDepartment(event.target.value)} aria-controls={searchResultsId}><option value="all">كل الأقسام</option>{departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              </div>
              </div>
              <div className="goal-create-results-count"><span role="status">{hasFilters ? `عرض ${toWesternDigits(filteredEmployees.length)} من ${toWesternDigits(employees.length)} موظف` : `${toWesternDigits(employees.length)} موظف متاح للاختيار`}</span>{hasFilters && <button type="button" onClick={resetFilters}>مسح الفلاتر ×</button>}</div>
              <ul className="goal-create-employee-results" id={searchResultsId}>
                {filteredEmployees.map(({ employee }) => <li key={employee.id}>
                  <button type="button" className={employee.id === employeeId ? "is-selected" : ""} aria-pressed={employee.id === employeeId} onClick={() => chooseEmployee(employee)}>
                    <span className="goal-create-avatar" aria-hidden="true">{employee.full_name.trim().charAt(0) || "م"}</span>
                    <span className="goal-create-employee-name"><strong>{employee.full_name}</strong><small><bdi>{employee.employee_number || "بدون رقم وظيفي"}</bdi><span>·</span>{employee.branch_name || "الفرع غير محدد"}<span>·</span>{employee.department_name || "القسم غير محدد"}</small></span>
                    <span className="goal-create-choose">{employee.id === employeeId ? "محدد ✓" : "اختيار"}</span>
                  </button>
                </li>)}
                {!filteredEmployees.length && <li className="goal-create-empty">{employees.length ? "لا يوجد موظفون مطابقون. جرّب تغيير الفرع أو القسم أو مسح البحث." : "لا يوجد موظفون متاحون لإضافة الأهداف."}</li>}
              </ul>
            </div>}
          </section>

          <div className="goal-create-details">
            <label className="goal-create-title">اسم الهدف <span>مطلوب</span><input ref={titleInput} required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: متابعة الزبائن" /></label>
            <label>شهر الهدف <span>مطلوب</span><input type="month" required value={month} onChange={(event) => { const next = event.target.value; const oldDefault = dueDateFor(month); const nextDefault = dueDateFor(next); setMonth(next); setTasks(current => current.map(task => ({ ...task, due_date: task.due_date === oldDefault ? nextDefault : task.due_date }))); }} /></label>
            <label>القيمة المستهدفة <span>اختياري</span><input type="number" min="0" max="9999999999.99" step="0.01" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="مثال: 20" /></label>
            <label>وحدة القياس <span>اختياري</span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="زيارة، فاتورة، د.ل…" /></label>
            <label className="goal-create-description">تفاصيل الهدف <span>اختياري</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="وضّح المطلوب وطريقة قياس الإنجاز…" /></label>
          </div>
        <section className="goal-create-task-fields" aria-label="مهام الهدف"><div><strong>مهام الهدف <em>مطلوب</em></strong><small>إنجاز المهام يقيس التنفيذ، وموعدها هو 10 من الشهر التالي افتراضيًا.</small></div>{tasks.map((task, index) => <label key={index}><span>المهمة {index + 1}</span><div><input required maxLength={300} value={task.title} onChange={event => setTasks(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} placeholder="مثال: مطابقة مصرف الجمهورية"/><input aria-label={`موعد تسليم المهمة ${index + 1}`} type="date" required value={task.due_date} onChange={event => setTasks(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, due_date: event.target.value } : item))}/><button type="button" aria-label={`حذف المهمة ${index + 1}`} disabled={tasks.length === 1} onClick={() => setTasks(current => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div></label>)}<button type="button" className="goal-create-add-task" onClick={() => setTasks(current => [...current, { title: "", due_date: dueDateFor(month) }])}>＋ إضافة مهمة أخرى</button></section>
        </fieldset>

        {message && <p className="goal-create-message" role="alert">{message}</p>}
        <footer className="goal-create-footer">
          <p>يمكن تسجيل الإنجاز الفعلي بعد إضافة الهدف.</p>
          <div><button type="button" className="goal-create-cancel" disabled={busy} onClick={close}>إلغاء</button><button type="submit" className="goal-create-submit" disabled={busy || !employees.length}>{busy ? "جارٍ حفظ الهدف…" : "حفظ الهدف"}</button></div>
        </footer>
      </form>
    </dialog>
  </>;
}
