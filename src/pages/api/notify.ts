import type { APIRoute } from "astro";

// On-demand (server-rendered) route. The rest of the site stays static.
export const prerender = false;

// Triggered by the lead form alongside the existing Zapier/Podio webhook.
// For every admin number it:
//   1. Sends an SMS containing the lead's address + phone.
//   2. Places a call that says "You've got a new lead".

const CALL_MESSAGE = "Hello, I'm testing leads. You've got a new lead. Kindly check your leads dashboard for details. Thank you.";

type TwilioResult = { to: string; ok: boolean; status: number; error?: string };

function twilioForm(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function twilioRequest(
  sid: string,
  auth: string,
  resource: "Messages" | "Calls",
  params: Record<string, string>,
): Promise<TwilioResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/${resource}.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: twilioForm(params),
  });
  let error: string | undefined;
  if (!res.ok) {
    try {
      const body = (await res.json()) as { message?: string };
      error = body?.message;
    } catch {
      error = await res.text();
    }
  }
  return { to: params.To, ok: res.ok, status: res.status, error };
}

export const POST: APIRoute = async ({ request }) => {
  const sid = import.meta.env.TWILIO_ACCOUNT_SID;
  const token = import.meta.env.TWILIO_AUTH_TOKEN;
  const from = import.meta.env.TWILIO_FROM_NUMBER;
  const adminNumbers = (import.meta.env.ADMIN_NUMBERS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  if (!sid || !token || !from) {
    return json(500, { error: "Twilio environment variables are not configured." });
  }
  if (adminNumbers.length === 0) {
    return json(500, { error: "No ADMIN_NUMBERS configured." });
  }

  let address = "";
  let phone = "";
  try {
    const body = (await request.json()) as { address?: string; phone?: string };
    address = (body.address ?? "").toString().slice(0, 200);
    phone = (body.phone ?? "").toString().slice(0, 40);
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const smsBody = `New lead: ${address || "(no address)"}, phone ${phone || "(no phone)"}`;
  const twiml = `<Response><Say>${CALL_MESSAGE}</Say></Response>`;

  const tasks: Promise<TwilioResult>[] = [];
  for (const to of adminNumbers) {
    tasks.push(twilioRequest(sid, auth, "Messages", { From: from, To: to, Body: smsBody }));
    tasks.push(twilioRequest(sid, auth, "Calls", { From: from, To: to, Twiml: twiml }));
  }

  const settled = await Promise.allSettled(tasks);
  const results = settled.map((r) =>
    r.status === "fulfilled" ? r.value : { ok: false, error: String(r.reason) },
  );
  const allOk = results.every((r) => r.ok);

  return json(allOk ? 200 : 207, { ok: allOk, results });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
