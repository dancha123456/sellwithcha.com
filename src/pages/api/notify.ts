import type { APIRoute } from "astro";
import {
  SELLER_SMS_ACTIVE,
  SELLER_SMS_AFTER_HOURS,
  clean,
  isCallWindow,
  renderSellerSms,
  toE164US,
} from "../../lib/leadAlerts";
import { legacyTwilioNotify } from "../../lib/legacyTwilio";

// On-demand (server-rendered) route. The rest of the site stays static.
// Called by the lead form after the Zapier/Podio webhook. For every lead it:
//   1. Texts each admin number (address + phone).
//   2. Calls each admin number, only 6 AM - 6 PM Arizona time.
//   3. Instantly texts the seller (only if they ticked the consent box).
// Provider: Signal House REST API (https://v2.signalhouse.io).

export const prerender = false;

type Result = { kind: string; to: string; ok: boolean; status?: number; error?: string };

async function signalHouse(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: unknown,
  kind: string,
  to: string,
): Promise<Result> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let error: string | undefined;
    if (!res.ok) {
      try {
        const data = (await res.json()) as { message?: string; error?: string };
        error = data?.message ?? data?.error;
      } catch {
        error = `HTTP ${res.status}`;
      }
    }
    return { kind, to, ok: res.ok, status: res.status, error };
  } catch (err) {
    return { kind, to, ok: false, error: String(err) };
  }
}

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin requests from some browsers omit it
  try {
    const host = new URL(origin).hostname;
    return (
      host === "sellwithcha.com" ||
      host === "www.sellwithcha.com" ||
      host.endsWith(".vercel.app") || // Vercel preview deployments
      host === "localhost"
    );
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!allowedOrigin(request)) return json(403, { error: "Forbidden." });

  const apiKey = import.meta.env.SIGNALHOUSE_API_KEY;
  const from = import.meta.env.SIGNALHOUSE_FROM_NUMBER;
  const voiceFrom = import.meta.env.SIGNALHOUSE_VOICE_FROM_NUMBER || from;
  const baseUrl = (import.meta.env.SIGNALHOUSE_BASE_URL || "https://v2.signalhouse.io").replace(/\/$/, "");
  const siteUrl = (import.meta.env.SITE_URL || "https://www.sellwithcha.com").replace(/\/$/, "");
  const adminNumbers = ((import.meta.env.ALERT_NUMBERS ?? "") as string)
    .split(",")
    .map((n) => toE164US(n.trim()))
    .filter((n): n is string => Boolean(n));

  // Signal House not configured yet: keep using the existing Twilio alerts.
  if (!apiKey || !from) return legacyTwilioNotify(request);
  if (adminNumbers.length === 0) {
    return json(500, { error: "No valid ALERT_NUMBERS configured." });
  }

  let address = "";
  let phone = "";
  let consent = false;
  try {
    const body = (await request.json()) as {
      address?: string;
      phone?: string;
      consent?: boolean;
    };
    address = clean(body.address, 200);
    phone = clean(body.phone, 40);
    consent = body.consent === true;
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const sellerNumber = toE164US(phone);
  const callWindow = isCallWindow();
  const adminSms = `New lead: ${address || "(no address)"}, phone ${phone || "(no phone)"}`;

  const tasks: Promise<Result>[] = [];

  for (const to of adminNumbers) {
    tasks.push(
      signalHouse(baseUrl, apiKey, "/message/sms", {
        senderPhoneNumber: from,
        recipientPhoneNumber: [to], // raw API field is singular, value is an array
        messageBody: adminSms,
      }, "admin-sms", to),
    );
    if (callWindow) {
      tasks.push(
        signalHouse(baseUrl, apiKey, "/voice/v1/calls", {
          from: voiceFrom,
          to,
          answer_url: `${siteUrl}/api/voice-alert`,
        }, "admin-call", to),
      );
    }
  }

  // Seller text: only with a valid US number AND the ticked consent box.
  if (sellerNumber && consent) {
    const template = callWindow ? SELLER_SMS_ACTIVE : SELLER_SMS_AFTER_HOURS;
    tasks.push(
      signalHouse(baseUrl, apiKey, "/message/sms", {
        senderPhoneNumber: from,
        recipientPhoneNumber: [sellerNumber],
        messageBody: renderSellerSms(template, address),
      }, "seller-sms", sellerNumber),
    );
  }

  const results = await Promise.all(tasks);
  const allOk = results.every((r) => r.ok);
  // Don't echo full phone numbers back to the browser.
  const safe = results.map((r) => ({ ...r, to: `***${r.to.slice(-4)}` }));
  return json(allOk ? 200 : 207, { ok: allOk, callWindow, results: safe });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
