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

// Authenticated call to the Podio API (JSON in, JSON out).
export async function podioApi<T>(env: PodioEnv, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const token = await getToken(env);
  const res = await fetch(`${PODIO_API}${path}`, {
    method,
    headers: { Authorization: `OAuth2 ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Podio ${method} ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

// ---- Duplicate check -------------------------------------------------------

type SearchResult = { results?: { id: number; type: string }[] };
type ItemFields = { item_id: number; fields: { values?: { value?: unknown }[] }[] };

function hasPhone(item: ItemFields, digits: string): boolean {
  for (const field of item.fields) {
    for (const v of field.values ?? []) {
      if (typeof v.value !== "string") continue;
      let d = v.value.replace(/\D/g, "");
      if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
      if (d === digits) return true;
    }
  }
  return false;
}

// Finds the newest Seller Lead with this 10-digit phone number, or null.
// Searches Podio for the number, then double-checks each hit's phone values,
// so a partial text match never counts as a duplicate.
export async function findLeadByPhone(env: PodioEnv, digits: string): Promise<number | null> {
  const query = encodeURIComponent(digits);
  const found = await podioApi<SearchResult>(
    env,
    "GET",
    `/search/app/${env.appId}/v2?query=${query}&ref_type=item&limit=10`,
  );
  const ids = (found.results ?? []).filter((r) => r.type === "item").map((r) => r.id);
  let newest: number | null = null;
  for (const id of ids) {
    const item = await podioApi<ItemFields>(env, "GET", `/item/${id}`);
    if (hasPhone(item, digits) && (newest === null || id > newest)) newest = id;
  }
  return newest;
}

// Adds a comment ("note") to an existing item.
export async function addNote(env: PodioEnv, itemId: number, text: string): Promise<void> {
  await podioApi(env, "POST", `/comment/item/${itemId}/`, { value: text });
}

export type NewLead = {
  name: string;
  address: string;
  phoneDigits: string; // 10-digit US number, or "" if none/invalid
  notes: string;
  gclid?: string;
};

export type CreateResult = { ok: true; itemId?: number } | { ok: false; status: number; error: string };

export type SaveResult =
  | { ok: true; duplicate: boolean; itemId?: number }
  | { ok: false; status: number; error: string };

// If a lead with this phone already exists, add a note to it instead of creating
// a new one. If the check itself fails, create the lead anyway (never lose a lead).
export async function saveLeadOrNote(env: PodioEnv, lead: NewLead, source: string): Promise<SaveResult> {
  if (lead.phoneDigits) {
    try {
      const existing = await findLeadByPhone(env, lead.phoneDigits);
      if (existing !== null) {
        await addNote(
          env,
          existing,
          `Repeat submission (${source}) on ${new Date().toISOString()}. ` +
            `Address entered: ${lead.address || "(none)"}.` +
            (lead.gclid ? ` Google click ID: ${lead.gclid}` : "") +
            " No new lead was created.",
        );
        return { ok: true, duplicate: true, itemId: existing };
      }
    } catch (err) {
      console.error("Duplicate check failed, creating lead anyway:", err);
    }
  }
  const created = await createSellerLead(env, lead);
  return created.ok ? { ok: true, duplicate: false, itemId: created.itemId } : created;
}

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
