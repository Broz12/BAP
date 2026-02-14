import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

type InvoiceOrder = {
  id: string;
  user_id: string;
  player_id: string;
  server_id: string;
  amount: number;
  currency: string;
  payment_status: string;
  created_at: string;
  product_name: string;
};

export async function buildInvoicePdf(order: InvoiceOrder): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const width = page.getWidth();

  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({
    x: 0,
    y: 760,
    width,
    height: 82,
    color: rgb(0.04, 0.12, 0.26)
  });

  page.drawText("MLBB Pro Top-Up Invoice", {
    x: 40,
    y: 792,
    size: 22,
    font: fontBold,
    color: rgb(0.0, 0.96, 1)
  });

  page.drawText("This website is not affiliated with Moonton or Mobile Legends.", {
    x: 40,
    y: 772,
    size: 10,
    font: fontRegular,
    color: rgb(0.81, 0.85, 0.92)
  });

  let y = 700;
  const lineHeight = 24;

  const rows = [
    ["Order ID", order.id],
    ["Player ID", order.player_id],
    ["Server ID", order.server_id],
    ["Package", order.product_name],
    ["Amount", `${order.amount} ${order.currency}`],
    ["Date", new Date(order.created_at).toLocaleString("en-US")],
    ["Payment Status", order.payment_status]
  ];

  for (const [label, value] of rows) {
    page.drawText(`${label}:`, {
      x: 40,
      y,
      size: 12,
      font: fontBold,
      color: rgb(0.06, 0.12, 0.2)
    });
    page.drawText(String(value), {
      x: 180,
      y,
      size: 12,
      font: fontRegular,
      color: rgb(0.1, 0.12, 0.16)
    });
    y -= lineHeight;
  }

  page.drawText("Thank you for choosing MLBB Pro Top-Up.", {
    x: 40,
    y: y - 18,
    size: 11,
    font: fontRegular,
    color: rgb(0.04, 0.12, 0.26)
  });

  return await pdf.save();
}

export async function generateAndStoreInvoice(adminClient: any, order: InvoiceOrder): Promise<string> {
  const bytes = await buildInvoicePdf(order);
  const path = `${order.user_id}/${order.id}.pdf`;

  const { error: uploadError } = await adminClient.storage.from("invoices").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true
  });

  if (uploadError) {
    throw uploadError;
  }

  const { error: updateError } = await adminClient.from("orders").update({ invoice_path: path }).eq("id", order.id);
  if (updateError) {
    throw updateError;
  }

  return path;
}
