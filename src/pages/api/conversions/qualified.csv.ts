import type { APIRoute } from "astro";
import { GET as feed } from "../google-conversions";

// /api/conversions/qualified.csv -> the "Podio - Qualified Lead" rows of the
// offline conversion feed. Google Ads Data Manager needs a URL ending in .csv.
export const prerender = false;

export const GET: APIRoute = (context) => {
  const url = new URL(context.request.url);
  url.searchParams.set("action", "qualified");
  return feed({ ...context, request: new Request(url, context.request) });
};
