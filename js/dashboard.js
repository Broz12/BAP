import { supabase } from "../supabase/config.js";
import { appState, formatMoney, initBasePage, showToast, usdToCurrency } from "./app.js";
import { initCurrencySelector } from "./currency.js";
import { initReferralSection } from "./referral.js";
import { initWalletSection } from "./wallet.js";

const dashboardState = {
  orders: []
};

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function renderProfile() {
  document.getElementById("profileEmail").textContent = appState.profile?.email || "-";
  document.getElementById("profileRole").textContent = appState.profile?.role || "user";
  document.getElementById("profileJoined").textContent = appState.profile?.created_at
    ? new Date(appState.profile.created_at).toLocaleString()
    : "-";
}

function renderOrders() {
  const body = document.getElementById("orderHistoryBody");
  if (!body) {
    return;
  }

  if (!dashboardState.orders.length) {
    body.innerHTML = `<tr><td colspan="9">No orders yet.</td></tr>`;
    return;
  }

  body.innerHTML = dashboardState.orders
    .map((order) => {
      const localAmount = usdToCurrency(order.amount * (appState.ratesToUsd[order.currency] || 1), appState.currency);
      return `
      <tr>
        <td>${order.id.slice(0, 8)}</td>
        <td>${order.product?.name || "Package"}</td>
        <td>${order.player_id} (${order.server_id})</td>
        <td>${formatMoney(order.amount, order.currency)}</td>
        <td>${formatMoney(localAmount, appState.currency)}</td>
        <td>${statusBadge(order.payment_status)}</td>
        <td>${statusBadge(order.order_status)}</td>
        <td>${new Date(order.created_at).toLocaleString()}</td>
        <td>
          ${
            order.invoice_path
              ? `<button class="btn secondary" data-invoice-path="${order.invoice_path}">Download</button>`
              : "-"
          }
        </td>
      </tr>
    `;
    })
    .join("");

  body.querySelectorAll("[data-invoice-path]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const path = button.getAttribute("data-invoice-path");
        const { data, error } = await supabase.storage.from("invoices").createSignedUrl(path, 120);
        if (error) {
          throw error;
        }
        if (!data?.signedUrl) {
          throw new Error("Invoice URL not available.");
        }
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      } catch (error) {
        showToast(error.message || "Unable to download invoice.", "error");
      }
    });
  });
}

async function fetchOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, player_id, server_id, amount, currency, payment_status, order_status, invoice_path, created_at, product:products!orders_product_id_fkey(name)"
    )
    .eq("user_id", appState.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw error;
  }

  dashboardState.orders = data || [];
  renderOrders();
}

export async function initDashboardPage() {
  const ready = await initBasePage({ requireAuth: true });
  if (!ready) {
    return;
  }
  await initCurrencySelector({ selectorId: "currencySelect" });

  renderProfile();
  await Promise.all([initWalletSection(), initReferralSection()]);

  try {
    await fetchOrders();
  } catch (error) {
    showToast(error.message || "Failed to load orders.", "error");
  }

  document.addEventListener("mlbb:currency-updated", () => {
    renderOrders();
  });
}
