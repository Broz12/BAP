import { invokeFunction, supabase } from "../supabase/config.js";
import {
  appState,
  formatMoney,
  initBasePage,
  setButtonLoading,
  showToast
} from "./app.js";
import { initCurrencySelector } from "./currency.js";

const adminState = {
  orders: [],
  products: [],
  users: [],
  seenPaidOrderIds: new Set(),
  revenueChart: null,
  poller: null
};

function currencyAmountToUsd(amount, currency) {
  const rateToUsd = Number(appState.ratesToUsd[currency] || 1);
  return Number(amount || 0) * rateToUsd;
}

function playNewOrderAlert() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return;
  }

  const context = new AudioCtx();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.value = 820;
  gain.gain.value = 0.02;

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();

  window.setTimeout(() => {
    oscillator.stop();
    context.close();
  }, 180);
}

async function fetchOrders() {
  const statusFilter = document.getElementById("statusFilter")?.value || "all";
  const playerSearch = document.getElementById("playerSearch")?.value.trim();

  let query = supabase
    .from("orders")
    .select(
      "id, user_id, player_id, server_id, amount, currency, payment_status, order_status, stripe_session_id, invoice_path, created_at, product:products!orders_product_id_fkey(name, diamond_amount), customer:users!orders_user_id_fkey(email)"
    )
    .order("created_at", { ascending: false })
    .limit(120);

  if (statusFilter !== "all") {
    query = query.eq("order_status", statusFilter);
  }
  if (playerSearch) {
    query = query.ilike("player_id", `%${playerSearch}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = data || [];
  let hasNewPaid = false;

  for (const row of rows) {
    if (row.payment_status === "paid" && !adminState.seenPaidOrderIds.has(row.id)) {
      hasNewPaid = true;
      adminState.seenPaidOrderIds.add(row.id);
    }
  }

  adminState.orders = rows;

  if (hasNewPaid) {
    playNewOrderAlert();
  }
}

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function renderOrderTable() {
  const body = document.getElementById("orderQueueBody");
  if (!body) {
    return;
  }

  if (!adminState.orders.length) {
    body.innerHTML = `<tr><td colspan="10">No orders found.</td></tr>`;
    return;
  }

  body.innerHTML = adminState.orders
    .map((order) => {
      const paidHighlight = order.payment_status === "paid" && order.order_status !== "completed" ? "highlight-new" : "";
      return `
      <tr class="${paidHighlight}">
        <td>${order.id.slice(0, 8)}</td>
        <td>${order.customer?.email || order.user_id}</td>
        <td>${order.player_id} (${order.server_id})</td>
        <td>${order.product?.name || "Package"}</td>
        <td>${formatMoney(order.amount, order.currency)}</td>
        <td>${statusBadge(order.payment_status)}</td>
        <td>${statusBadge(order.order_status)}</td>
        <td>${new Date(order.created_at).toLocaleString()}</td>
        <td>
          <select class="select" data-order-status="${order.id}">
            ${["pending", "processing", "completed", "cancelled"]
              .map((status) => `<option value="${status}" ${status === order.order_status ? "selected" : ""}>${status}</option>`)
              .join("")}
          </select>
        </td>
        <td>
          <textarea class="textarea" data-order-note="${order.id}" placeholder="Optional note"></textarea>
          <button class="btn secondary" data-order-save="${order.id}" style="margin-top:0.45rem; width:100%;">Save</button>
        </td>
      </tr>
    `;
    })
    .join("");

  body.querySelectorAll("[data-order-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      const orderId = button.getAttribute("data-order-save");
      const status = body.querySelector(`[data-order-status='${orderId}']`)?.value;
      const note = body.querySelector(`[data-order-note='${orderId}']`)?.value?.trim();

      try {
        setButtonLoading(button, true);
        await invokeFunction("admin-update-order", {
          orderId,
          orderStatus: status,
          adminNote: note || null
        });
        showToast("Order updated.", "success");
        await refreshAdminData();
      } catch (error) {
        showToast(error.message || "Order update failed.", "error");
      } finally {
        setButtonLoading(button, false);
      }
    });
  });
}

function renderAnalytics() {
  const paid = adminState.orders.filter((order) => order.payment_status === "paid");
  const revenueUsd = paid.reduce((sum, order) => sum + currencyAmountToUsd(order.amount, order.currency), 0);

  const totalRevenue = document.getElementById("totalRevenue");
  const totalOrders = document.getElementById("totalOrders");
  const pendingOrders = document.getElementById("pendingOrders");

  if (totalRevenue) {
    totalRevenue.textContent = formatMoney(revenueUsd, "USD");
  }
  if (totalOrders) {
    totalOrders.textContent = `${adminState.orders.length}`;
  }
  if (pendingOrders) {
    pendingOrders.textContent = `${adminState.orders.filter((o) => o.order_status !== "completed").length}`;
  }

  const dailyRevenue = new Map();
  for (const order of paid) {
    const day = new Date(order.created_at).toISOString().slice(0, 10);
    const current = dailyRevenue.get(day) || 0;
    dailyRevenue.set(day, current + currencyAmountToUsd(order.amount, order.currency));
  }

  const labels = Array.from(dailyRevenue.keys()).sort();
  const values = labels.map((day) => Number(dailyRevenue.get(day).toFixed(2)));

  const canvas = document.getElementById("revenueChart");
  if (!canvas || !window.Chart) {
    return;
  }

  if (adminState.revenueChart) {
    adminState.revenueChart.destroy();
  }

  adminState.revenueChart = new window.Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Daily Revenue (USD)",
          data: values,
          borderColor: "#00f5ff",
          backgroundColor: "rgba(0, 245, 255, 0.15)",
          pointRadius: 3,
          tension: 0.3,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        x: {
          grid: {
            color: "rgba(255,255,255,0.08)"
          },
          ticks: {
            color: "#9fb8c5"
          }
        },
        y: {
          grid: {
            color: "rgba(255,255,255,0.08)"
          },
          ticks: {
            color: "#9fb8c5"
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: "#e5f9ff"
          }
        }
      }
    }
  });
}

async function fetchProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, diamond_amount, base_price_usd, active, created_at")
    .order("diamond_amount", { ascending: true });

  if (error) {
    throw error;
  }
  adminState.products = data || [];
}

function renderProducts() {
  const body = document.getElementById("productBody");
  if (!body) {
    return;
  }

  if (!adminState.products.length) {
    body.innerHTML = `<tr><td colspan="6">No products yet.</td></tr>`;
    return;
  }

  body.innerHTML = adminState.products
    .map(
      (product) => `
      <tr>
        <td>${product.name}</td>
        <td>${product.diamond_amount}</td>
        <td>${formatMoney(product.base_price_usd, "USD")}</td>
        <td>${product.active ? "Active" : "Disabled"}</td>
        <td>${new Date(product.created_at).toLocaleDateString()}</td>
        <td class="inline-actions">
          <button class="btn secondary" data-product-edit="${product.id}">Edit</button>
          <button class="btn danger" data-product-delete="${product.id}">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");

  body.querySelectorAll("[data-product-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = adminState.products.find((row) => row.id === button.dataset.productEdit);
      if (!product) {
        return;
      }
      document.getElementById("productId").value = product.id;
      document.getElementById("productName").value = product.name;
      document.getElementById("productDiamonds").value = product.diamond_amount;
      document.getElementById("productPriceUsd").value = product.base_price_usd;
      document.getElementById("productActive").checked = product.active;
      showToast("Product loaded into form.", "info");
    });
  });

  body.querySelectorAll("[data-product-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.productDelete;
      if (!window.confirm("Delete this product permanently?")) {
        return;
      }
      try {
        const { error } = await supabase.from("products").delete().eq("id", id);
        if (error) {
          throw error;
        }
        showToast("Product deleted.", "success");
        await fetchProducts();
        renderProducts();
      } catch (error) {
        showToast(error.message || "Delete failed.", "error");
      }
    });
  });
}

function setupProductForm() {
  const form = document.getElementById("productForm");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    setButtonLoading(button, true);

    try {
      const id = document.getElementById("productId").value || null;
      const payload = {
        name: document.getElementById("productName").value.trim(),
        diamond_amount: Number(document.getElementById("productDiamonds").value),
        base_price_usd: Number(document.getElementById("productPriceUsd").value),
        active: document.getElementById("productActive").checked
      };

      if (!payload.name || payload.diamond_amount <= 0 || payload.base_price_usd <= 0) {
        throw new Error("Provide valid product details.");
      }

      let query;
      if (id) {
        query = supabase.from("products").update(payload).eq("id", id);
      } else {
        query = supabase.from("products").insert(payload);
      }

      const { error } = await query;
      if (error) {
        throw error;
      }

      form.reset();
      document.getElementById("productId").value = "";
      showToast("Product saved.", "success");
      await fetchProducts();
      renderProducts();
    } catch (error) {
      showToast(error.message || "Failed to save product.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  });
}

async function fetchUsers() {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, role, referral_code, created_at")
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    throw error;
  }

  adminState.users = data || [];
}

function renderUsers() {
  const body = document.getElementById("usersBody");
  if (!body) {
    return;
  }

  if (!adminState.users.length) {
    body.innerHTML = `<tr><td colspan="5">No users found.</td></tr>`;
    return;
  }

  body.innerHTML = adminState.users
    .map(
      (user) => `
      <tr>
        <td>${user.id.slice(0, 8)}</td>
        <td>${user.email}</td>
        <td>${user.role}</td>
        <td>${user.referral_code || "-"}</td>
        <td>${new Date(user.created_at).toLocaleString()}</td>
      </tr>
    `
    )
    .join("");
}

async function refreshAdminData() {
  await Promise.all([fetchOrders(), fetchProducts(), fetchUsers()]);
  renderOrderTable();
  renderAnalytics();
  renderProducts();
  renderUsers();
}

function setupOrderFilters() {
  document.getElementById("statusFilter")?.addEventListener("change", async () => {
    try {
      await fetchOrders();
      renderOrderTable();
      renderAnalytics();
    } catch (error) {
      showToast(error.message || "Failed to filter orders.", "error");
    }
  });

  document.getElementById("playerSearch")?.addEventListener("input", async () => {
    try {
      await fetchOrders();
      renderOrderTable();
      renderAnalytics();
    } catch (error) {
      showToast(error.message || "Failed to search orders.", "error");
    }
  });
}

export async function initAdminPage() {
  await initBasePage({ requireAuth: true, requireAdmin: true });
  await initCurrencySelector({ selectorId: "currencySelect" });

  setupOrderFilters();
  setupProductForm();

  try {
    await refreshAdminData();
  } catch (error) {
    showToast(error.message || "Failed to load admin dashboard.", "error");
  }

  adminState.poller = window.setInterval(async () => {
    try {
      await fetchOrders();
      renderOrderTable();
      renderAnalytics();
    } catch {
      // Poll failures should not interrupt dashboard usage.
    }
  }, 15000);

  window.addEventListener("beforeunload", () => {
    if (adminState.poller) {
      window.clearInterval(adminState.poller);
    }
  });
}
