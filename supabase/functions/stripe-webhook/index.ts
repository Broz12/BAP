import Stripe from "npm:stripe@16.12.0";
import { jsonResponse } from "../_shared/cors.ts";
import { generateAndStoreInvoice } from "../_shared/invoice.ts";
import { createAdminClient, getEnv } from "../_shared/supabase.ts";
import { buildWhatsappDeepLink, sendWhatsappCloudMessage } from "../_shared/whatsapp.ts";

async function handleTopupPaid(adminClient: any, session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.order_id;
  if (!orderId) {
    throw new Error("Missing order_id metadata.");
  }

  const { data: processedOrder, error: processError } = await adminClient.rpc("process_paid_order", {
    input_order_id: orderId,
    input_stripe_session_id: session.id
  });

  if (processError || !processedOrder) {
    throw new Error(processError?.message || "Failed to process paid order.");
  }

  const { data: orderWithProduct, error: orderError } = await adminClient
    .from("orders")
    .select(
      "id, user_id, player_id, server_id, amount, currency, payment_status, created_at, product:products!orders_product_id_fkey(name)"
    )
    .eq("id", orderId)
    .single();

  if (orderError || !orderWithProduct) {
    throw new Error(orderError?.message || "Failed to load order details.");
  }

  const productName = orderWithProduct.product?.name || "Diamond Package";

  await generateAndStoreInvoice(adminClient, {
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
  return {
    orderId: orderWithProduct.id,
    whatsappSent: whatsappResult.sent,
    whatsappError: whatsappResult.error || null,
    whatsappFallback: buildWhatsappDeepLink(whatsappPayload, Deno.env.get("WHATSAPP_ADMIN_TO"))
  };
}

async function handleWalletDeposit(adminClient: any, session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id || session.client_reference_id;
  const amountRaw = session.metadata?.amount;
  const currency = session.metadata?.currency;

  if (!userId || !amountRaw || !currency) {
    throw new Error("Missing wallet deposit metadata.");
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid wallet deposit amount in metadata.");
  }

  const { data, error } = await adminClient.rpc("credit_wallet_deposit", {
    input_user_id: userId,
    input_amount: amount,
    input_currency: currency,
    input_stripe_session_id: session.id
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    credited: true,
    newBalanceUsd: data
  };
}

async function handlePaymentFailure(adminClient: any, session: Stripe.Checkout.Session) {
  const kind = session.metadata?.kind;
  if (kind !== "topup") {
    return { updated: false };
  }

  const orderId = session.metadata?.order_id;
  if (!orderId) {
    return { updated: false };
  }

  const { error } = await adminClient
    .from("orders")
    .update({ payment_status: "failed", order_status: "cancelled" })
    .eq("id", orderId)
    .neq("payment_status", "paid");

  if (error) {
    throw new Error(error.message);
  }

  return { updated: true };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2024-06-20"
    });

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      throw new Error("Missing Stripe signature header.");
    }

    const webhookSecret = getEnv("STRIPE_WEBHOOK_SECRET");
    const payload = await request.text();

    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    const adminClient = createAdminClient();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const kind = session.metadata?.kind;

        if (kind === "topup") {
          const result = await handleTopupPaid(adminClient, session);
          return jsonResponse({ received: true, event: event.type, result });
        }

        if (kind === "wallet_deposit") {
          const result = await handleWalletDeposit(adminClient, session);
          return jsonResponse({ received: true, event: event.type, result });
        }

        return jsonResponse({ received: true, event: event.type, ignored: true });
      }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const result = await handlePaymentFailure(adminClient, session);
        return jsonResponse({ received: true, event: event.type, result });
      }

      default:
        return jsonResponse({ received: true, event: event.type, ignored: true });
    }
  } catch (error: any) {
    return jsonResponse({ error: error.message || "Webhook handling failed." }, 400);
  }
});
