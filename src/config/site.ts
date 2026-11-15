// Single source of truth for the phone number shown on the site.
// To change the number everywhere (main page, thank-you, footer/legal pages),
// edit only PHONE_DIGITS below.
const PHONE_DIGITS = "6234006767"; // 10-digit US number, digits only

const area = PHONE_DIGITS.slice(0, 3);
const prefix = PHONE_DIGITS.slice(3, 6);
const line = PHONE_DIGITS.slice(6);

export const PHONE = {
  /** Shown to visitors, e.g. (623) 400-6767 */
  display: `(${area}) ${prefix}-${line}`,
  /** E.164, e.g. +16234006767 */
  e164: `+1${PHONE_DIGITS}`,
  /** Link targets */
  tel: `tel:+1${PHONE_DIGITS}`,
  sms: `sms:+1${PHONE_DIGITS}`,
} as const;
