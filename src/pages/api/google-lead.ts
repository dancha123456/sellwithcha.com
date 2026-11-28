import type { APIRoute } from "astro";
import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { clean, toE164US } from "../../lib/leadAlerts";
import { podioEnv, saveLeadOrNote } from "../../lib/podio";

// Webhook for the Google Ads Lead Form asset. Google POSTs each submitted lead
// here; we create a Seller Lead in Podio (phone + address + Google click ID) and
// text the admin numbers. The Lead Form's "Key" must match GOOGLE_LEAD_FORM_KEY.
// Payload format: https://developers.google.com/google-ads/webhook/docs/implementation
// Google only waits a few seconds for a 200, and the Podio calls (login, duplicate
// search, create) can take 5-10s. So we check the key, reply 200 straight away and
// save the lead in the background with waitUntil.

export const prerender = false;

type Column = { column_id?: string; column_name?: string; string_value?: string };
type GooglePayload = {
  lead_id?: string;
  user_column_data?: Column[];
  google_key?: string;
  gcl_id?: string;
  is_test?: boolean;
};

const ADDRESS_PARTS = ["STREET_ADDRESS", "CITY", "REGION", "POSTAL_CODE"];

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const POST: APIRoute = async ({ request }) => {
  const expectedKey = import.meta.env.GOOGLE_LEAD_FORM_KEY;
  if (!expectedKey) return json(503, { error: "Lead form key not configured." });

  let payload: GooglePayload;
  try {
    payload = (await request.json()) as GooglePayload;
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }
  if (!keyMatches(String(payload.google_key ?? ""), expectedKey)) {
    return json(401, { error: "Invalid key." });
  }

  const env = podioEnv();
  if (!env) return json(503, { error: "Podio not configured." });

  const columns = new Map<string, string>();
  for (const c of payload.user_column_data ?? []) {
    if (c.column_id) columns.set(c.column_id, clean(c.string_value, 200));
  }
  const address = ADDRESS_PARTS.map((k) => columns.get(k)).filter(Boolean).join(", ");
  const rawPhone = columns.get("PHONE_NUMBER") ?? "";
  const e164 = toE164US(rawPhone);
  const gclid = clean(payload.gcl_id, 200).replace(/[^A-Za-z0-9_-]/g, "");
  const isTest = payload.is_test === true;

  const label = isTest ? "TEST Google lead form" : "Google lead form";
  waitUntil(
    saveAndAlert(env, request.url, { label, address, rawPhone, e164, gclid, isTest }).catch((err) =>
      console.error("Google lead background save failed:", err),
    ),
  );

  return json(200, { ok: true });
};

type ParsedLead = {
  label: string;
  address: string;
  rawPhone: string;
  e164: string | null;
  gclid: string;
  isTest: boolean;
};

async function saveAndAlert(
  env: NonNullable<ReturnType<typeof podioEnv>>,
  requestUrl: string,
  lead: ParsedLead,
): Promise<void> {
  const { label, address, rawPhone, e164, gclid, isTest } = lead;
  const result = await saveLeadOrNote(
    env,
    {
      name: `${label} -- ${address || rawPhone || "no details"}`,
      address,
      phoneDigits: e164 ? e164.slice(2) : "",
      notes:
        `${label} lead (Google Ads) on ${new Date().toISOString()}.` +
        (e164 ? "" : ` Phone as entered: ${rawPhone || "(none)"}.`),
      gclid,
    },
    "Google lead form",
  );
  if (!result.ok) console.error("Podio save failed for Google lead:", result.error);

  // Text the admin numbers like website leads do (seller text needs website consent,
  // so it's not sent here). Skipped for Google's test leads and repeat submissions.
  // Still sent when the Podio save failed, so the lead is never lost.
  if (isTest || (result.ok && result.duplicate)) return;
  try {
    await fetch(new URL("/api/notify", requestUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, phone: rawPhone, consent: false }),
    });
  } catch (err) {
    console.error("Admin alert for Google lead failed:", err);
  }
}
