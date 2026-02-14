export type WhatsappOrderPayload = {
  id: string;
  player_id: string;
  server_id: string;
  product_name: string;
  amount: number;
  currency: string;
};

export function buildWhatsappMessage(order: WhatsappOrderPayload): string {
  return [
    "MLBB Pro Top-Up: Paid Order",
    `Order ID: ${order.id}`,
    `Player ID: ${order.player_id}`,
    `Server ID: ${order.server_id}`,
    `Package: ${order.product_name}`,
    `Amount: ${order.amount} ${order.currency}`
  ].join("\n");
}

export function buildWhatsappDeepLink(order: WhatsappOrderPayload, phone?: string): string {
  const message = encodeURIComponent(buildWhatsappMessage(order));
  const formattedPhone = (phone || "").replace(/\D/g, "");
  if (!formattedPhone) {
    return `https://wa.me/?text=${message}`;
  }
  return `https://wa.me/${formattedPhone}?text=${message}`;
}

export async function sendWhatsappCloudMessage(order: WhatsappOrderPayload): Promise<{ sent: boolean; error?: string }> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const adminRecipient = Deno.env.get("WHATSAPP_ADMIN_TO");
  const apiVersion = Deno.env.get("WHATSAPP_API_VERSION") || "v20.0";

  if (!token || !phoneNumberId || !adminRecipient) {
    return { sent: false, error: "WhatsApp env vars are missing." };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const messageText = buildWhatsappMessage(order);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: adminRecipient,
      type: "text",
      text: {
        preview_url: false,
        body: messageText
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    return { sent: false, error: text || "WhatsApp API request failed." };
  }

  return { sent: true };
}
