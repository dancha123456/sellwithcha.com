import type { APIRoute } from "astro";
import { clean, toE164US } from "../../lib/leadAlerts";

// On-demand route. Creates a lead straight in Podio (Seller Leads app) when the
// website form is submitted. Uses Podio "app authentication" (App ID + App Token)
// plus an API key (client id/secret). All four values are env vars set in Vercel.

export const prerender = false;

const PODIO_OAUTH = "https://podio.com/oauth/token";
const PODIO_API = "https://api.podio.com";

let cached: { token: string; exp: number } | null = null;

async function getToken(
  clientId: string,
  clientSecret: string,
  appId: string,
  appToken: string,
): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(PODIO_OAUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "app",
      app_id: appId,
      app_token: appToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Podio auth failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

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

  const clientId = import.meta.env.PODIO_CLIENT_ID;
  const clientSecret = import.meta.env.PODIO_CLIENT_SECRET;
  const appId = import.meta.env.PODIO_APP_ID;
  const appToken = import.meta.env.PODIO_APP_TOKEN;
  if (!clientId || !clientSecret || !appId || !appToken) {
    return json(503, { error: "Podio not configured." });
  }

  let address = "";
  let phone = "";
  let consent = false;
  let timestamp = "";
  try {
    const body = (await request.json()) as {
      address?: string;
      phone?: string;
      consent?: boolean;
      timestamp?: string;
    };
    address = clean(body.address, 200);
    phone = clean(body.phone, 40);
    consent = body.consent === true;
    timestamp = clean(body.timestamp, 40) || new Date().toISOString();
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const e164 = toE164US(phone);
  if (!address || !e164) return json(400, { error: "Address and a valid US phone are required." });
  const digits = e164.slice(2); // 10-digit national number

  try {
    const token = await getToken(clientId, clientSecret, appId, appToken);
    const res = await fetch(`${PODIO_API}/item/app/${appId}/`, {
      method: "POST",
      headers: { Authorization: `OAuth2 ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          name: `Website lead -- ${address}`,
          phone: [{ type: "mobile", value: digits }],
          "property-address-map": address,
          "communication-notes": `Website lead from sellwithcha.com on ${timestamp}. SMS/call consent: ${consent ? "yes" : "no"}.`,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return json(502, { error: `Podio create failed (${res.status})`, detail: text.slice(0, 300) });
    }
    const item = (await res.json()) as { item_id?: number };
    return json(200, { ok: true, itemId: item.item_id });
  } catch (err) {
    return json(502, { error: String(err) });
  }
};
