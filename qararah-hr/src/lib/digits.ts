const DIGIT_MAP = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";

export function toWesternDigits(value: unknown): string {
  return String(value ?? "").replace(/[٠-٩۰-۹]/g, (digit) => String(DIGIT_MAP.indexOf(digit) % 10));
}
