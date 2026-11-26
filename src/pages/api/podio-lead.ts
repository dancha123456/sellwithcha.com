import type { APIRoute } from "astro";
import { clean, toE164US } from "../../lib/leadAlerts";
import { createSellerLead, podioEnv } from "../../lib/podio";

// On-demand route. Creates a lead straight in Podio (Seller Leads app) when the
// website form is submitted, including the Google Ads click ID when present.

export const prerender = false;

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return (
      host === "sellwithcha.com" ||
      host === "www.sellwithcha.com" ||
      host.endsWith(".vercel.app") ||
      host === "localhost"
    );
  } catch {
    return false;
  }
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!allowedOrigin(request)) return json(403, { error: "Forbidden." });

  const env = podioEnv();
  if (!env) return json(503, { error: "Podio not configured." });

  let address = "";
  let phone = "";
  let consent = false;
  let timestamp = "";
  let gclid = "";
  try {
    const body = (await request.json()) as {
      address?: string;
      phone?: string;
      consent?: boolean;
      timestamp?: string;
      gclid?: string;
    };
    address = clean(body.address, 200);
    phone = clean(body.phone, 40);
    consent = body.consent === true;
    timestamp = clean(body.timestamp, 40) || new Date().toISOString();
    gclid = clean(body.gclid, 200).replace(/[^A-Za-z0-9_-]/g, "");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const e164 = toE164US(phone);
  if (!address || !e164) return json(400, { error: "Address and a valid US phone are required." });

  const result = await createSellerLead(env, {
    name: `Website lead -- ${address}`,
    address,
    phoneDigits: e164.slice(2),
    notes: `Website lead from sellwithcha.com on ${timestamp}. SMS/call consent: ${consent ? "yes" : "no"}.${gclid ? " Came from a Google ad." : ""}`,
    gclid,
  });
  if (!result.ok) return json(result.status, { error: result.error });
  return json(200, { ok: true, itemId: result.itemId });
};
