import type { APIRoute } from "astro";
import { CALL_MESSAGE } from "../../lib/leadAlerts";

// Fetched by Signal House when an admin answers the lead-alert call.
// Returns call-control instructions that read the alert message aloud.
// NOTE: SHML format is assumed to be Twilio-style <Response><Say>; confirm in a live test.
export const prerender = false;

const body = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${CALL_MESSAGE}</Say></Response>`;
const respond = () => new Response(body, { status: 200, headers: { "Content-Type": "application/xml" } });

export const GET: APIRoute = respond;
export const POST: APIRoute = respond;
