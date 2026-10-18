/** Inclusive calendar days, independent of the browser's timezone. */
export function leaveCalendarDays(start: string, end: string | null): number | null {
  function dateValue(value: string | null) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
  }
  const first = dateValue(start);
  const last = dateValue(end);
  return first === null || last === null || last < first ? null : Math.round((last - first) / 86_400_000) + 1;
}

export function requestDeductionText(status: "pending" | "approved" | "rejected", amount: number | null, unit: string | null): string {
  if (status === "rejected") return "لا يوجد خصم معتمد لهذا الطلب";
  const currency = !unit || unit === "LYD" ? "د.ل" : unit;
  if (amount !== null && Number.isFinite(amount) && amount > 0) {
    return `${status === "pending" ? "خصم مقترح: " : ""}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
  return status === "pending" ? "لم يحدد بعد — بانتظار الاعتماد النهائي" : `بدون خصم (0.00 ${currency})`;
}
