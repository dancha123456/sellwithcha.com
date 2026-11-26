import type { APIRoute } from "astro";
import { createHash, timingSafeEqual } from "node:crypto";
import { GCLID_FIELD, podioApi, podioEnv } from "../../lib/podio";

// Offline conversion feed for Google Ads "scheduled uploads" (HTTPS source).
// Google Ads fetches this CSV on a schedule. It lists every Seller Lead whose
// "Google Lead Quality" is set and that has a Google Click ID and/or a phone:
//   - Qualified Lead  -> one "Qualified Lead" conversion
//   - Contract        -> a "Qualified Lead" AND a "Contract" conversion
// Conversion time = when the lead was created in Podio, so each row stays the
// same on every fetch and Google de-duplicates repeats.
// Each row carries the GCLID plus the SHA-256 hashed phone (E.164), so Google can
// match it with "Enhanced conversions for leads" even when the click ID is missing.
// Protected with HTTP Basic auth: user "google", password GOOGLE_CONVERSIONS_PASSWORD.

export const prerender = false;

const QUALITY_FIELD = "google-lead-quality";
const LOOKBACK_DAYS = 90; // Google only accepts clicks from the last 90 days
const TIME_ZONE = "America/Phoenix";

// Must match the conversion action names in Google Ads exactly.
const CONVERSION_QUALIFIED = "Qualified Lead";
const CONVERSION_CONTRACT = "Contract";

type FieldValue = { value?: unknown };
type Field = { external_id: string; values?: FieldValue[] };
type Item = { item_id: number; created_on: string; fields: Field[] };
type FilterResult = { items: Item[]; filtered: number };

function authorized(request: Request, password: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  const given = Buffer.from(header.slice(6), "base64").toString("utf8");
  const expected = `google:${password}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Podio created_on is UTC "YYYY-MM-DD HH:MM:SS" -> Arizona local time, same format.
function toArizona(utc: string): string {
  const d = new Date(`${utc.replace(" ", "T")}Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
}

function textValue(item: Item, externalId: string): string {
  const v = item.fields.find((f) => f.external_id === externalId)?.values?.[0]?.value;
  return typeof v === "string" ? v.replace(/<[^>]*>/g, "").trim() : "";
}

function categoryText(item: Item, externalId: string): string {
  const v = item.fields.find((f) => f.external_id === externalId)?.values?.[0]?.value as
    | { text?: string }
    | undefined;
  return v?.text?.trim() ?? "";
}

// First phone value on the item as a SHA-256 hash of +1XXXXXXXXXX, or "".
function hashedPhone(item: Item): string {
  for (const v of item.fields.find((f) => f.external_id === "phone")?.values ?? []) {
    let d = String(v.value ?? "").replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    if (/^[2-9]\d{9}$/.test(d)) return createHash("sha256").update(`+1${d}`).digest("hex");
  }
  return "";
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET: APIRoute = async ({ request }) => {
  const password = import.meta.env.GOOGLE_CONVERSIONS_PASSWORD;
  if (!password) return new Response("Not configured.", { status: 503 });
  if (!authorized(request, password)) {
    return new Response("Unauthorized.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="conversions"' },
    });
  }

  const env = podioEnv();
  if (!env) return new Response("Podio not configured.", { status: 503 });

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows: string[] = [];
  try {
    for (let offset = 0; ; offset += 500) {
      const page = await podioApi<FilterResult>(env, "POST", `/item/app/${env.appId}/filter/`, {
        filters: { created_on: { from: since } },
        sort_by: "created_on",
        sort_desc: true,
        limit: 500,
        offset,
      });
      for (const item of page.items) {
        const quality = categoryText(item, QUALITY_FIELD);
        const gclid = textValue(item, GCLID_FIELD);
        const phone = hashedPhone(item);
        if (!quality || (!gclid && !phone)) continue;
        const time = toArizona(item.created_on);
        const names =
          quality === "Contract"
            ? [CONVERSION_QUALIFIED, CONVERSION_CONTRACT]
            : quality === "Qualified Lead"
              ? [CONVERSION_QUALIFIED]
              : [];
        for (const name of names) {
          rows.push([gclid, phone, name, time, "", ""].map(csvCell).join(","));
        }
      }
      if (page.items.length < 500) break;
    }
  } catch (err) {
    return new Response(`Podio error: ${String(err)}`, { status: 502 });
  }

  const csv = [
    `Parameters:TimeZone=${TIME_ZONE}`,
    "Google Click ID,Phone Number,Conversion Name,Conversion Time,Conversion Value,Conversion Currency",
    ...rows,
  ].join("\n");

  return new Response(`${csv}\n`, {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" },
  });
};
