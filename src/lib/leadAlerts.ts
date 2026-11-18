// Pure helpers for the lead-alert route (no network, easy to test).

export const TIME_ZONE = "America/Phoenix"; // Arizona: no daylight saving

// Seller texts. Keep wording in one place so it matches the registered 10DLC samples.
export const SELLER_SMS_ACTIVE =
  "Hi, it's Dan from Cash Homebuyers America. Just got your request for {Street_Address}. Pulling up the property info now and giving you a quick ring in 30 seconds, or is texting easier? Reply STOP to opt out.";
export const SELLER_SMS_AFTER_HOURS =
  "Hi, it's Dan from Cash Homebuyers America. Just got your request for {Street_Address}. Is the property occupied right now, and does it need any major repairs? Reply STOP to opt out.";

export const CALL_MESSAGE =
  "Hello! You've got a new lead. Kindly check your leads dashboard for details. Thank you.";

/** Normalize a US phone to E.164 (+1XXXXXXXXXX). Returns null when it is not a valid 10-digit US number. */
export function toE164US(input: string): string | null {
  let digits = (input ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

/** True between 6:00 AM and 5:00 PM Arizona time (calls allowed). */
export function isCallWindow(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return hour >= 6 && hour < 17;
}

/** Fill {Street_Address} in a seller text template. */
export function renderSellerSms(template: string, address: string): string {
  return template.replace("{Street_Address}", address.trim());
}

/** Strip anything that could break a text/XML body and cap the length. */
export function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f<>&]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
