import { toWesternDigits } from "@/lib/digits";

export function lateMinutesAfter915(value: string | null | undefined) {
  if (!value) return null;
  const match = toWesternDigits(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutesAfterMidnight = Number(match[1]) * 60 + Number(match[2]);
  const lateMinutes = minutesAfterMidnight - (9 * 60 + 15);
  return lateMinutes > 0 ? lateMinutes : null;
}
