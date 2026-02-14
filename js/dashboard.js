import { isConfigReady, supabase } from "../supabase/config.js";
import { appState, formatMoney, initBasePage, showToast, usdToCurrency } from "./app.js";
import { initCurrencySelector } from "./currency.js";
import { initReferralSection } from "./referral.js";
import { initWalletSection } from "./wallet.js";

const HERO_IMAGE_URL =
  "https://images.wallpapersden.com/image/download/mobile-legends-bang-bang-2021_bGtpbWeUmZqaraWkpJRmbmdlrWZlbWU.jpg";

const DEMO_PROFILE = {
  email: "demo@mlbb-pro.com",
  role: "demo_user",
  created_at: "2026-01-10T11:20:00Z",
  referral_code: "DEMO5MLBB"
};

const DEMO_WALLET_TX = [
  { created_at: "2026-02-12T09:45:00Z", type: "deposit", amount_usd: 40 },
  { created_at: "2026-02-12T10:03:00Z", type: "payment", amount_usd: -9.49 },
  { created_at: "2026-02-13T07:14:00Z", type: "referral", amount_usd: 1.9 }
];

const DEMO_REFERRALS = [
  { created_at: "2026-02-12T18:10:00Z", email: "player-alpha@mlbb.com", commission_amount_usd: 1.22 },
  { created_at: "2026-02-13T14:42:00Z", email: "mage-core@mlbb.com", commission_amount_usd: 0.68 }
];

const DEMO_ORDERS = [
  {
    id: "d2d6f2fd-2b3e-4dca-94fb-0904de930001",
    player_id: "308716521",
    server_id: "5221",
    amount: 9.49,
    currency: "USD",
    payment_status: "paid",
    order_status: "processing",
    invoice_path: null,
    created_at: "2026-02-13T10:14:00Z",
    product: { name: "Diamond Pack M" }
  },
  {
    id: "d2d6f2fd-2b3e-4dca-94fb-0904de930002",
    player_id: "602381774",
    server_id: "9274",
    amount: 4.99,
    currency: "USD",
    payment_status: "paid",
    order_status: "completed",
    invoice_path: null,
    created_at: "2026-02-12T18:05:00Z",
    product: { name: "Diamond Pack S" }
  }
];

const dashboardState = {
  orders: [],
  mode: isConfigReady ? "live" : "demo",
  switching: false
};

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function setImageTargets() {
  const heroImage = document.getElementById("dashboardHeroImage");
  const profileImage = document.getElementById("profileFeatureImage");

  if (heroImage) {
    heroImage.src = HERO_IMAGE_URL;
  }
  if (profileImage) {
    profileImage.src = HERO_IMAGE_URL;
  }
}

function renderModeUi() {
  const liveBtn = document.getElementById("modeLiveBtn");
  const demoBtn = document.getElementById("modeDemoBtn");
  const modePill = document.getElementById("dashboardModePill");
  const modeText = document.getElementById("dashboardModeText");

  if (liveBtn) {
    liveBtn.classList.toggle("active", dashboardState.mode === "live");
  }
  if (demoBtn) {
    demoBtn.classList.toggle("active", dashboardState.mode === "demo");
  }

  if (modePill) {
    modePill.textContent = dashboardState.mode === "live" ? "Live Mode" : "Demo Mode";
    modePill.className = `badge ${dashboardState.mode === "live" ? "paid" : "pending"}`;
  }

  if (modeText) {
    modeText.textContent =
      dashboardState.mode === "live"
        ? "Connected to your real account, wallet, and order history."
        : "Preview mode with sample account/orders. Connect Supabase to switch fully live.";
  }
}

function renderProfile(profile = appState.profile) {
  document.getElementById("profileEmail").textContent = profile?.email || "-";
  document.getElementById("profileRole").textContent = profile?.role || "user";
  document.getElementById("profileJoined").textContent = profile?.created_at
    ? new Date(profile.created_at).toLocaleString()
    : "-";
}

function convertAmountToCurrentCurrency(amount, amountCurrency) {
  const amountInUsd = Number(amount) * Number(appState.ratesToUsd[amountCurrency] || 1);
  return usdToCurrency(amountInUsd, appState.currency);
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
      const localAmount = convertAmountToCurrentCurrency(order.amount, order.currency);
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
      if (dashboardState.mode === "demo") {
        showToast("Invoices are disabled in demo mode.", "info");
        return;
      }

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

function renderDemoWalletAndReferrals() {
  const walletUsd = 127.85;
  appState.walletUsd = walletUsd;

  const walletBalanceUsd = document.getElementById("walletBalanceUsd");
  const walletBalanceLocal = document.getElementById("walletBalanceLocal");
  if (walletBalanceUsd) {
    walletBalanceUsd.textContent = formatMoney(walletUsd, "USD");
  }
  if (walletBalanceLocal) {
    walletBalanceLocal.textContent = formatMoney(usdToCurrency(walletUsd, appState.currency), appState.currency);
  }

  const walletBody = document.getElementById("walletTransactionsBody");
  if (walletBody) {
    walletBody.innerHTML = DEMO_WALLET_TX.map((row) => {
      const localAmount = usdToCurrency(row.amount_usd, appState.currency);
      return `
        <tr>
          <td>${new Date(row.created_at).toLocaleString()}</td>
          <td>${row.type}</td>
          <td>${formatMoney(row.amount_usd, "USD")}</td>
          <td>${formatMoney(localAmount, appState.currency)}</td>
        </tr>
      `;
    }).join("");
  }

  const refCode = document.getElementById("referralCode");
  const refLink = document.getElementById("referralLink");
  if (refCode) {
    refCode.textContent = DEMO_PROFILE.referral_code;
  }
  if (refLink) {
    refLink.value = `${window.location.origin}${window.location.pathname.replace("dashboard.html", "index.html")}?ref=${
      DEMO_PROFILE.referral_code
    }`;
  }

  const totalRef = DEMO_REFERRALS.length;
  const earnedUsd = DEMO_REFERRALS.reduce((sum, row) => sum + row.commission_amount_usd, 0);

  const refTotal = document.getElementById("refTotal");
  const refUsd = document.getElementById("refEarnedUsd");
  const refLocal = document.getElementById("refEarnedLocal");
  if (refTotal) {
    refTotal.textContent = String(totalRef);
  }
  if (refUsd) {
    refUsd.textContent = formatMoney(earnedUsd, "USD");
  }
  if (refLocal) {
    refLocal.textContent = formatMoney(usdToCurrency(earnedUsd, appState.currency), appState.currency);
  }

  const refBody = document.getElementById("referralBody");
  if (refBody) {
    refBody.innerHTML = DEMO_REFERRALS.map((row) => {
      const local = usdToCurrency(row.commission_amount_usd, appState.currency);
      return `
        <tr>
          <td>${new Date(row.created_at).toLocaleString()}</td>
          <td>${row.email}</td>
          <td>${formatMoney(row.commission_amount_usd, "USD")}</td>
          <td>${formatMoney(local, appState.currency)}</td>
        </tr>
      `;
    }).join("");
  }
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

async function loadLiveDashboard() {
  renderProfile();
  await Promise.all([initWalletSection(), initReferralSection()]);

  try {
    await fetchOrders();
  } catch (error) {
    showToast(error.message || "Failed to load orders.", "error");
  }
}

function loadDemoDashboard() {
  appState.profile = { ...DEMO_PROFILE };
  renderProfile(DEMO_PROFILE);
  renderDemoWalletAndReferrals();
  dashboardState.orders = [...DEMO_ORDERS];
  renderOrders();
}

async function switchMode(nextMode) {
  if (dashboardState.switching || dashboardState.mode === nextMode) {
    return;
  }

  if (nextMode === "live") {
    if (!isConfigReady) {
      showToast("Live mode needs Supabase config in js/runtime-config.js.", "info", 5000);
      return;
    }
    if (!appState.user) {
      showToast("Login required for live account mode.", "info");
      return;
    }
  }

  dashboardState.switching = true;
  dashboardState.mode = nextMode;
  renderModeUi();

  try {
    if (nextMode === "demo") {
      loadDemoDashboard();
    } else {
      await loadLiveDashboard();
    }
  } finally {
    dashboardState.switching = false;
  }
}

function setupModeToggle() {
  const liveButton = document.getElementById("modeLiveBtn");
  const demoButton = document.getElementById("modeDemoBtn");

  liveButton?.addEventListener("click", () => {
    switchMode("live");
  });

  demoButton?.addEventListener("click", () => {
    switchMode("demo");
  });
}

function setupDemoDepositIntercept() {
  const form = document.getElementById("depositForm");
  if (!form || form.dataset.demoInterceptBound === "true") {
    return;
  }

  form.dataset.demoInterceptBound = "true";
  form.addEventListener(
    "submit",
    (event) => {
      if (dashboardState.mode !== "demo") {
        return;
      }
      event.preventDefault();
      showToast("Deposit checkout is disabled in demo mode.", "info", 4000);
    },
    true
  );

  const copyBtn = document.getElementById("copyReferralBtn");
  copyBtn?.addEventListener("click", async () => {
    if (dashboardState.mode !== "demo") {
      return;
    }

    const link = document.getElementById("referralLink")?.value || "";
    if (!link) {
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      showToast("Demo referral link copied.", "success");
    } catch {
      showToast("Unable to copy link.", "error");
    }
  });
}

export async function initDashboardPage() {
  setImageTargets();

  const ready = await initBasePage({ requireAuth: true });
  await initCurrencySelector({ selectorId: "currencySelect" });

  setupModeToggle();
  setupDemoDepositIntercept();
  renderModeUi();

  if (!ready) {
    dashboardState.mode = "demo";
    renderModeUi();
    loadDemoDashboard();
  } else {
    if (dashboardState.mode === "demo") {
      loadDemoDashboard();
    } else {
      await loadLiveDashboard();
    }
    renderModeUi();
  }

  document.addEventListener("mlbb:currency-updated", () => {
    if (dashboardState.mode === "demo") {
      renderDemoWalletAndReferrals();
      renderOrders();
      return;
    }

    renderOrders();
  });
}
