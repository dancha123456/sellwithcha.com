// Shared Podio helper: creates a Seller Lead item using Podio "app authentication"
// (App ID + App Token) plus an API key (client id/secret). All four values are
// env vars set in Vercel.

const PODIO_OAUTH = "https://podio.com/oauth/token";
const PODIO_API = "https://api.podio.com";

// Text field in Seller Leads that holds the Google Ads click ID (gclid).
export const GCLID_FIELD = "google-click-id";

let cached: { token: string; exp: number } | null = null;

type PodioEnv = { clientId: string; clientSecret: string; appId: string; appToken: string };

export function podioEnv(): PodioEnv | null {
  const clientId = import.meta.env.PODIO_CLIENT_ID;
  const clientSecret = import.meta.env.PODIO_CLIENT_SECRET;
  const appId = import.meta.env.PODIO_APP_ID;
  const appToken = import.meta.env.PODIO_APP_TOKEN;
  if (!clientId || !clientSecret || !appId || !appToken) return null;
  return { clientId, clientSecret, appId, appToken };
}

async function getToken(env: PodioEnv): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(PODIO_OAUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "app",
      app_id: env.appId,
      app_token: env.appToken,
      client_id: env.clientId,
      client_secret: env.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Podio auth failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export type NewLead = {
  name: string;
  address: string;
  phoneDigits: string; // 10-digit US number, or "" if none/invalid
  notes: string;
  gclid?: string;
};

export type CreateResult = { ok: true; itemId?: number } | { ok: false; status: number; error: string };

export async function createSellerLead(env: PodioEnv, lead: NewLead): Promise<CreateResult> {
  const first = await createOnce(env, lead);
  // Never lose a lead over the click ID: if Podio rejects it (e.g. the field was
  // renamed or removed), save the lead without it and keep the ID in the notes.
  if (!first.ok && lead.gclid) {
    return createOnce(env, {
      ...lead,
      gclid: undefined,
      notes: `${lead.notes} Google click ID: ${lead.gclid}`,
    });
  }
  return first;
}

async function createOnce(env: PodioEnv, lead: NewLead): Promise<CreateResult> {
  const fields: Record<string, unknown> = {
    name: lead.name,
    "property-address-map": lead.address,
    "communication-notes": lead.notes,
  };
  if (lead.phoneDigits) fields.phone = [{ type: "mobile", value: lead.phoneDigits }];
  if (lead.gclid) fields[GCLID_FIELD] = lead.gclid;

  try {
    const token = await getToken(env);
    const res = await fetch(`${PODIO_API}/item/app/${env.appId}/`, {
      method: "POST",
      headers: { Authorization: `OAuth2 ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: 502, error: `Podio create failed (${res.status}): ${text.slice(0, 300)}` };
    }
    const item = (await res.json()) as { item_id?: number };
    return { ok: true, itemId: item.item_id };
  } catch (err) {
    return { ok: false, status: 502, error: String(err) };
  }
}
