import { SUPPORTED_CURRENCIES } from "../_shared/currency.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin } from "../_shared/supabase.ts";

async function isAuthorized(request: Request): Promise<boolean> {
  const cronSecret = Deno.env.get("EXCHANGE_RATE_CRON_SECRET");
  const incomingSecret = request.headers.get("x-cron-secret");

  if (cronSecret && incomingSecret === cronSecret) {
    return true;
  }

  try {
    await requireAdmin(request);
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!["POST", "GET"].includes(request.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authorized = await isAuthorized(request);
    if (!authorized) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      method: "GET"
    });

    if (!response.ok) {
      throw new Error(`Exchange rate API failed with ${response.status}.`);
    }

    const payload = await response.json();
    if (payload?.result !== "success" || !payload.rates) {
      throw new Error("Unexpected exchange rate response.");
    }

    const adminClient = createAdminClient();
    const updates = [];

    for (const code of SUPPORTED_CURRENCIES) {
      if (code === "USD") {
        updates.push({
          currency_code: "USD",
          rate_to_usd: 1,
          updated_at: new Date().toISOString()
        });
        continue;
      }

      const usdToCurrency = Number(payload.rates[code]);
      if (!usdToCurrency || usdToCurrency <= 0) {
        continue;
      }

      updates.push({
        currency_code: code,
        rate_to_usd: Number((1 / usdToCurrency).toFixed(10)),
        updated_at: new Date().toISOString()
      });
    }

    const { error } = await adminClient.from("exchange_rates").upsert(updates, { onConflict: "currency_code" });
    if (error) {
      throw new Error(error.message);
    }

    return jsonResponse({ updated: updates.length, rates: updates });
  } catch (error: any) {
    return jsonResponse({ error: error.message || "Exchange rate sync failed." }, 400);
  }
});
