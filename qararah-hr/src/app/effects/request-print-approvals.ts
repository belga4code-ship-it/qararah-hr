import type { ApprovalStep } from "./EffectsWorkspace";

export type PrintApproval = { name: string; status: "approved" | "rejected" | "pending" | "skipped"; date: string | null; reason: string | null };
export function requestPrintApprovals({ responsibleIds, approvalSteps, approvalNames, requestStatus, decisionBy, decisionAt, decisionReason }: {
  responsibleIds: string[]; approvalSteps: ApprovalStep[]; approvalNames: Record<string, string>; requestStatus: "pending" | "approved" | "rejected";
  decisionBy: string | null; decisionAt: string | null; decisionReason: string | null;
}): PrintApproval[] {
  const ids = [...new Set([...responsibleIds, ...approvalSteps.flatMap((step) => step.approver_profile_ids?.length ? step.approver_profile_ids : step.approver_profile_id ? [step.approver_profile_id] : [])])];
  const decisions = new Map<string, PrintApproval>();
  for (const step of [...approvalSteps].sort((a, b) => a.step_order - b.step_order)) {
    // A group approval records only the actor's decision, never every member's.
    if (step.decided_by && (step.status === "approved" || step.status === "rejected")) {
      decisions.set(step.decided_by, { name: approvalNames[step.decided_by] || "مسؤول مسجل للقرار", status: step.status, date: step.decided_at, reason: step.reason });
      if (!ids.includes(step.decided_by)) ids.push(step.decided_by);
    }
  }
  if (decisionBy && requestStatus !== "pending" && !decisions.has(decisionBy)) {
    decisions.set(decisionBy, { name: approvalNames[decisionBy] || "مسؤول مسجل للقرار", status: requestStatus, date: decisionAt, reason: decisionReason });
    if (!ids.includes(decisionBy)) ids.push(decisionBy);
  }
  const rows: PrintApproval[] = ids.map((id, index) => decisions.get(id) || { name: approvalNames[id] || `المسؤول المعيّن ${index + 1}`, status: approvalSteps.some((step) => step.approver_profile_id === id && step.status === "skipped") ? "skipped" : "pending", date: null, reason: approvalSteps.find((step) => step.approver_profile_id === id && step.status === "skipped")?.reason ?? null });
  for (const step of approvalSteps.filter((step) => !step.decided_by && !step.approver_profile_id && !step.approver_profile_ids?.length)) {
    const name = step.approver_role === "branch_manager" ? "مدير الفرع" : step.approver_role === "auditor" ? "مراجع الحسابات" : step.approver_role === "hr" ? "الموارد البشرية" : "المسؤول المعيّن";
    rows.push({ name, status: step.status === "skipped" ? "skipped" : "pending", date: null, reason: null });
  }
  while (rows.length < 2) rows.push({ name: `المسؤول ${rows.length + 1} / ................................`, status: "pending", date: null, reason: null });
  return rows;
}
