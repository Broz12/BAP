import Stripe from "npm:stripe@16.12.0";
import { assertSupportedCurrency, convertUsdToCurrency, toStripeMinorUnits } from "../_shared/currency.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient, getEnv, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { user } = await requireUser(request);
    const adminClient = createAdminClient();
    const body = await request.json();

    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2024-06-20"
    });

    const appBaseUrl = getEnv("APP_BASE_URL").replace(/\/$/, "");
    const successUrl = String(body.successUrl || `${appBaseUrl}/success.html`).replace(/\/$/, "");
    const cancelUrl = String(body.cancelUrl || `${appBaseUrl}/cancel.html`).replace(/\/$/, "");

    const type = String(body.type || "");
    if (!["topup", "wallet_deposit"].includes(type)) {
      throw new Error("Invalid checkout type.");
    }

    if (type === "topup") {
      const productId = String(body.productId || "");
      const playerId = String(body.playerId || "").trim();
      const serverId = String(body.serverId || "").trim();
      const currency = String(body.currency || "USD").toUpperCase();

      assertSupportedCurrency(currency);

      if (!/^[0-9]{4,20}$/.test(playerId)) {
        throw new Error("Invalid player ID.");
      }
      if (!/^[0-9]{2,10}$/.test(serverId)) {
        throw new Error("Invalid server ID.");
      }

      const { data: product, error: productError } = await adminClient
        .from("products")
        .select("id, name, diamond_amount, base_price_usd, active")
        .eq("id", productId)
        .eq("active", true)
        .single();

      if (productError || !product) {
        throw new Error("Selected package is unavailable.");
      }

      const convertedAmount = await convertUsdToCurrency(adminClient, Number(product.base_price_usd), currency);

      const { data: order, error: orderError } = await adminClient
        .from("orders")
        .insert({
          user_id: user.id,
          player_id: playerId,
          server_id: serverId,
          product_id: product.id,
          amount: convertedAmount,
          currency,
          payment_status: "pending",
          order_status: "pending"
        })
        .select("id")
        .single();

      if (orderError || !order) {
        throw new Error(orderError?.message || "Failed to create order.");
      }

      let stripeSession: Stripe.Checkout.Session | null = null;
      try {
        stripeSession = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          client_reference_id: user.id,
          success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: cancelUrl,
          metadata: {
            kind: "topup",
            order_id: order.id,
            user_id: user.id,
            currency
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: currency.toLowerCase(),
                unit_amount: toStripeMinorUnits(convertedAmount, currency),
                product_data: {
                  name: `${product.name} (${product.diamond_amount} Diamonds)`
                }
              }
            }
          ]
        });
      } catch (checkoutError) {
        await adminClient.from("orders").delete().eq("id", order.id).eq("payment_status", "pending");
        throw checkoutError;
      }

      if (!stripeSession) {
        throw new Error("Failed to create Stripe checkout session.");
      }
      if (!stripeSession.url) {
        throw new Error("Stripe checkout URL unavailable.");
      }

      const { error: orderUpdateError } = await adminClient
        .from("orders")
        .update({ stripe_session_id: stripeSession.id })
        .eq("id", order.id);

      if (orderUpdateError) {
        throw new Error(orderUpdateError.message);
      }

      return jsonResponse({
        checkoutUrl: stripeSession.url,
        sessionId: stripeSession.id,
        orderId: order.id
      });
    }

    const amount = Number(body.amount || 0);
    const currency = String(body.currency || "USD").toUpperCase();
    assertSupportedCurrency(currency);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid deposit amount.");
    }

    const normalized = currency === "IDR" ? Math.round(amount) : Number(amount.toFixed(2));

    const stripeSession = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      client_reference_id: user.id,
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      metadata: {
        kind: "wallet_deposit",
        user_id: user.id,
        amount: String(normalized),
        currency
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: toStripeMinorUnits(normalized, currency),
            product_data: {
              name: `Wallet Deposit (${currency})`
            }
          }
        }
      ]
    });

    if (!stripeSession.url) {
      throw new Error("Stripe checkout URL unavailable.");
    }

    return jsonResponse({
      checkoutUrl: stripeSession.url,
      sessionId: stripeSession.id
    });
  } catch (error: any) {
    return jsonResponse({ error: error.message || "Failed to create Stripe session." }, 400);
  }
});
