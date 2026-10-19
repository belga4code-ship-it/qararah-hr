"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type GoalTask = { id: string; goal_id: string; title: string; sort_order: number; is_completed: boolean; employee_note: string | null; review_status: "pending" | "approved" | "changes_requested"; review_note: string | null; due_date: string | null };

function dueDateFor(periodMonth: string) { const date = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(10); return date.toISOString().slice(0, 10); }
function formatDueDate(value: string) { return new Intl.DateTimeFormat("ar-LY", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)); }

export default function GoalTasks({ goalId, periodMonth, tasks, canManage, canComplete, canAddNote }: { goalId: string; periodMonth: string; tasks: GoalTask[]; canManage: boolean; canComplete: boolean; canAddNote: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [dueDate, setDueDate] = useState(dueDateFor(periodMonth));
  const ordered = [...tasks].sort((a, b) => a.sort_order - b.sort_order);
  const completeCount = tasks.filter(task => task.is_completed).length;
  const percentage = tasks.length ? Math.round(completeCount / tasks.length * 100) : 0;

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || busy) return;
    setBusy(true); setMessage("");
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("employee_goal_tasks").insert({ goal_id: goalId, title: cleanTitle, sort_order: tasks.length, due_date: dueDate || null, created_by: auth.user?.id ?? null });
      if (error) { setMessage(`تعذر إضافة المهمة: ${error.message}`); return; }
      setTitle(""); router.refresh();
    } catch { setMessage("تعذر الاتصال لإضافة المهمة."); }
    finally { setBusy(false); }
  }

  async function toggleTask(task: GoalTask) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.from("employee_goal_tasks").update({ is_completed: !task.is_completed }).eq("id", task.id).select("id").maybeSingle();
      if (error) { setMessage(`تعذر تحديث المهمة: ${error.message}`); return; }
      if (!data) { setMessage("لم تُحدّث المهمة. تحقق من صلاحيات حسابك ثم حدّث الصفحة."); return; }
      router.refresh();
    } catch { setMessage("تعذر الاتصال لتحديث المهمة."); }
    finally { setBusy(false); }
  }

  async function removeTask(task: GoalTask) {
    if (busy || !window.confirm(`حذف المهمة «${task.title}»؟`)) return;
    setBusy(true); setMessage("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.from("employee_goal_tasks").delete().eq("id", task.id).select("id").maybeSingle();
      if (error) { setMessage(`تعذر حذف المهمة: ${error.message}`); return; }
      if (!data) { setMessage("لم تُحذف المهمة. تحقق من صلاحيات حسابك ثم حدّث الصفحة."); return; }
      router.refresh();
    } catch { setMessage("تعذر الاتصال لحذف المهمة."); }
    finally { setBusy(false); }
  }

  async function saveNote(task: GoalTask) {
    if (busy) return;
    const note = (notes[task.id] ?? task.employee_note ?? "").trim();
    if (note.length > 2000) { setMessage("الملاحظة طويلة؛ الحد الأقصى 2000 حرف."); return; }
    setBusy(true); setMessage("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.from("employee_goal_tasks").update({ employee_note: note || null }).eq("id", task.id).select("id").maybeSingle();
      if (error) { setMessage(`تعذر حفظ ملاحظة المهمة: ${error.message}`); return; }
      if (!data) { setMessage("لم تُحفظ الملاحظة. تحقق من صلاحيات حسابك."); return; }
      setNotes(current => ({ ...current, [task.id]: note })); router.refresh();
    } catch { setMessage("تعذر الاتصال لحفظ الملاحظة."); }
    finally { setBusy(false); }
  }

  async function reviewTask(task: GoalTask, status: "approved" | "changes_requested") {
    if (busy) return;
    if (!task.employee_note?.trim()) { setMessage("أضف الموظف ملاحظة إنجاز قبل مراجعة المهمة."); return; }
    setBusy(true); setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("review_employee_goal_task", { p_task_id: task.id, p_status: status, p_note: reviewNotes[task.id]?.trim() || null });
      if (error) { setMessage(`تعذرت مراجعة المهمة: ${error.message}`); return; }
      setReviewNotes(current => ({ ...current, [task.id]: "" })); router.refresh();
    } catch { setMessage("تعذر الاتصال لمراجعة المهمة."); }
    finally { setBusy(false); }
  }

  return <section className="goal-task-panel" aria-label="مهام الهدف">
    <header><div><h3>تنفيذ المهام</h3><p>{tasks.length ? `${completeCount} من ${tasks.length} مهام مكتملة · هذا يقيس التنفيذ فقط` : "أضف مهامًا لمتابعة خطوات العمل."}</p></div>{tasks.length > 0 && <strong>{percentage}٪</strong>}</header>
    {tasks.length > 0 && <div className="goal-task-progress" role="progressbar" aria-label="نسبة إنجاز مهام الهدف" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percentage}%` }} /></div>}
    <ul>{ordered.map((task, index) => <li key={task.id} className={task.is_completed ? "is-complete" : ""}>
      {canComplete ? <button type="button" className="goal-task-check" aria-label={`${task.is_completed ? "إلغاء إنجاز" : "تحديد كمكتملة"}: ${task.title}`} aria-pressed={task.is_completed} disabled={busy} onClick={() => void toggleTask(task)}>{task.is_completed ? "✓" : index + 1}</button> : <span className="goal-task-check" aria-hidden="true">{task.is_completed ? "✓" : index + 1}</span>}
      <span className="goal-task-title">{task.title}{task.due_date && <small className="goal-task-due">موعد التسليم: {formatDueDate(task.due_date)}</small>}</span>{task.is_completed && <small>منجزة</small>}{canManage && <button type="button" className="goal-task-remove" disabled={busy} aria-label={`حذف المهمة: ${task.title}`} onClick={() => void removeTask(task)}>×</button>}
      {(canAddNote || task.employee_note) && <div className="goal-task-evidence"><span>ملاحظة الإنجاز</span>{canAddNote ? <><textarea value={notes[task.id] ?? task.employee_note ?? ""} onChange={event => setNotes(current => ({ ...current, [task.id]: event.target.value }))} maxLength={2000} rows={2} placeholder="اكتب ما تم إنجازه، مثل: جمعت 6 عملاء جدد…" disabled={busy}/><button type="button" disabled={busy || (notes[task.id] ?? task.employee_note ?? "").trim() === (task.employee_note ?? "").trim()} onClick={() => void saveNote(task)}>حفظ الملاحظة</button></> : <p>{task.employee_note}</p>}{task.employee_note && <small className={`goal-task-review-status ${task.review_status}`}>{task.review_status === "approved" ? "الملاحظة معتمدة" : task.review_status === "changes_requested" ? "مطلوب توضيح" : "بانتظار مراجعة المسؤول"}</small>}</div>}
      {canManage && task.employee_note && <div className="goal-task-review"><label>ملاحظة المسؤول (اختياري)<textarea rows={2} maxLength={1000} value={reviewNotes[task.id] ?? ""} onChange={event => setReviewNotes(current => ({ ...current, [task.id]: event.target.value }))} placeholder="ملاحظة للمراجعة أو التوضيح…" disabled={busy}/></label><div><button type="button" disabled={busy} onClick={() => void reviewTask(task, "approved")}>اعتماد الملاحظة</button><button type="button" className="request-changes" disabled={busy} onClick={() => void reviewTask(task, "changes_requested")}>طلب توضيح</button></div>{task.review_note && <small>آخر ملاحظة للمسؤول: {task.review_note}</small>}</div>}
    </li>)}</ul>
    {canManage && <form onSubmit={addTask}><label htmlFor={`new-task-${goalId}`}>إضافة مهمة</label><div className="goal-task-add-fields"><input id={`new-task-${goalId}`} value={title} onChange={event => setTitle(event.target.value)} maxLength={300} placeholder="اكتب المهمة المطلوبة…" disabled={busy}/><label><span>موعد التسليم</span><input type="date" required value={dueDate} onChange={event => setDueDate(event.target.value)} disabled={busy}/></label><button type="submit" disabled={busy || !title.trim()}>{busy ? "جارٍ الحفظ…" : "إضافة"}</button></div></form>}
    {message && <p className="goal-task-message" role="alert">{message}</p>}
  </section>;
}
