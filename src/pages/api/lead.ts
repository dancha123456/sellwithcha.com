import type { APIRoute } from 'astro';

export const prerender = false;

const PODIO_API = 'https://api.podio.com';

// Authenticate to Podio using app authentication flow
async function getAccessToken(): Promise<string> {
  const clientId = import.meta.env.PODIO_CLIENT_ID;
  const clientSecret = import.meta.env.PODIO_CLIENT_SECRET;
  const appId = import.meta.env.PODIO_APP_ID;
  const appToken = import.meta.env.PODIO_APP_TOKEN;

const body = new URLSearchParams({
  grant_type: 'app',
  app_id: String(appId),
  app_token: String(appToken),
  client_id: String(clientId),
  client_secret: String(clientSecret),
});

const res = await fetch(`${PODIO_API}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: body.toString(),
});

if (!res.ok) {
  throw new Error(`Podio auth failed: ${res.status} ${await res.text()}`);
}
  const data = await res.json();
  return data.access_token as string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const lead = await request.json();
    const address = (lead.address || '').toString().trim();
    const phone = (lead.phone || '').toString().trim();
    const source = (lead.source || 'website').toString();
    const timestamp = (lead.timestamp || new Date().toISOString()).toString();

  if (!address && !phone) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing address and phone' }), { status: 400 });
  }

  const token = await getAccessToken();
    const appId = import.meta.env.PODIO_APP_ID;

  // Build the Podio item. Field external IDs come from env so they can be
  // adjusted without code changes. Defaults match the Seller Leads app.
  const fLocation = import.meta.env.PODIO_FIELD_ADDRESS || 'property-address-map';
    const fPhone = import.meta.env.PODIO_FIELD_PHONE || 'phone';
    const fNotes = import.meta.env.PODIO_FIELD_NOTES || 'lead-notes';

  const fields: Record<string, unknown> = {};
    if (address) fields[fLocation] = address;
    if (phone) fields[fPhone] = [{ type: 'mobile', value: phone }];
    fields[fNotes] = `Web lead from ${source} at ${timestamp}`;

  const createRes = await fetch(`${PODIO_API}/item/app/${appId}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `OAuth2 ${token}`,
    },
    body: JSON.stringify({ fields }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    return new Response(JSON.stringify({ ok: false, error: errText }), { status: 502 });
  }

  const created = await createRes.json();
    return new Response(JSON.stringify({ ok: true, item_id: created.item_id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 });
  }
};
