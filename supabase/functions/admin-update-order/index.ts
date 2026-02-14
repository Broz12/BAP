import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin } from "../_shared/supabase.ts";

const ALLOWED_ORDER_STATUS = ["pending", "processing", "completed", "cancelled"];

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    await requireAdmin(request);
    const adminClient = createAdminClient();
    const body = await request.json();

    const orderId = String(body.orderId || "");
    const orderStatus = String(body.orderStatus || "").toLowerCase();
    const adminNote = body.adminNote ? String(body.adminNote).trim() : "";

    if (!orderId) {
      throw new Error("orderId is required.");
    }

    if (!ALLOWED_ORDER_STATUS.includes(orderStatus)) {
      throw new Error("Invalid order status.");
    }

    const { data: order, error: updateError } = await adminClient
      .from("orders")
      .update({ order_status: orderStatus })
      .eq("id", orderId)
      .select("id, order_status, payment_status")
      .single();

    if (updateError || !order) {
      throw new Error(updateError?.message || "Order update failed.");
    }

    if (adminNote) {
      const { error: noteError } = await adminClient.from("order_notes").insert({
        order_id: orderId,
        admin_note: adminNote
      });

      if (noteError) {
        throw new Error(noteError.message);
      }
    }

    return jsonResponse({
      order,
      noteSaved: Boolean(adminNote)
    });
  } catch (error: any) {
    return jsonResponse({ error: error.message || "Failed to update order." }, 400);
  }
});
