import { assertSupportedCurrency } from "../_shared/currency.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { generateAndStoreInvoice } from "../_shared/invoice.ts";
import { createAdminClient, requireUser } from "../_shared/supabase.ts";
import { buildWhatsappDeepLink, sendWhatsappCloudMessage } from "../_shared/whatsapp.ts";

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

    const { data: order, error: rpcError } = await adminClient.rpc("create_wallet_paid_order", {
      input_product_id: productId,
      input_player_id: playerId,
      input_server_id: serverId,
      input_currency: currency
    });

    if (rpcError || !order) {
      throw new Error(rpcError?.message || "Wallet payment failed.");
    }

    const { data: orderWithProduct, error: orderError } = await adminClient
      .from("orders")
      .select(
        "id, user_id, player_id, server_id, amount, currency, payment_status, created_at, product:products!orders_product_id_fkey(name)"
      )
      .eq("id", order.id)
      .single();

    if (orderError || !orderWithProduct) {
      throw new Error(orderError?.message || "Order lookup failed.");
    }

    const productName = orderWithProduct.product?.name || "Diamond Package";

    const invoicePath = await generateAndStoreInvoice(adminClient, {
      id: orderWithProduct.id,
      user_id: orderWithProduct.user_id,
      player_id: orderWithProduct.player_id,
      server_id: orderWithProduct.server_id,
      amount: Number(orderWithProduct.amount),
      currency: orderWithProduct.currency,
      payment_status: orderWithProduct.payment_status,
      created_at: orderWithProduct.created_at,
      product_name: productName
    });

    const whatsappPayload = {
      id: orderWithProduct.id,
      player_id: orderWithProduct.player_id,
      server_id: orderWithProduct.server_id,
      product_name: productName,
      amount: Number(orderWithProduct.amount),
      currency: orderWithProduct.currency
    };

    const whatsappResult = await sendWhatsappCloudMessage(whatsappPayload);
    const whatsappDeepLink = buildWhatsappDeepLink(whatsappPayload, Deno.env.get("WHATSAPP_ADMIN_TO"));

    return jsonResponse({
      order: {
        ...orderWithProduct,
        invoice_path: invoicePath
      },
      whatsapp: {
        sent: whatsappResult.sent,
        error: whatsappResult.error || null,
        deepLink: whatsappDeepLink
      }
    });
  } catch (error: any) {
    return jsonResponse({ error: error.message || "Wallet payment failed." }, 400);
  }
});
