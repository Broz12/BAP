import { config, invokeFunction, supabase } from "../supabase/config.js";
import { appState, formatMoney, setButtonLoading, showToast, usdToCurrency } from "./app.js";
import { SUPPORTED_CURRENCIES } from "./currency.js";

const walletState = {
  transactions: []
};

function renderWalletBalance() {
  const usdNode = document.getElementById("walletBalanceUsd");
  const localNode = document.getElementById("walletBalanceLocal");
  if (usdNode) {
    usdNode.textContent = formatMoney(appState.walletUsd, "USD");
  }

  if (localNode) {
    localNode.textContent = formatMoney(usdToCurrency(appState.walletUsd, appState.currency), appState.currency);
  }
}

function renderTransactions() {
  const body = document.getElementById("walletTransactionsBody");
  if (!body) {
    return;
  }

  if (!walletState.transactions.length) {
    body.innerHTML = `<tr><td colspan="4">No wallet transactions.</td></tr>`;
    return;
  }

  body.innerHTML = walletState.transactions
    .map((tx) => {
      const localAmount = usdToCurrency(tx.amount_usd, appState.currency);
      return `
      <tr>
        <td>${new Date(tx.created_at).toLocaleString()}</td>
        <td>${tx.type}</td>
        <td>${formatMoney(tx.amount_usd, "USD")}</td>
        <td>${formatMoney(localAmount, appState.currency)}</td>
      </tr>
    `;
    })
    .join("");
}

async function fetchWalletData() {
  const [walletResult, txResult] = await Promise.all([
    supabase.from("wallets").select("balance").eq("user_id", appState.user.id).single(),
    supabase
      .from("wallet_transactions")
      .select("id, type, amount_usd, created_at")
      .eq("user_id", appState.user.id)
      .order("created_at", { ascending: false })
      .limit(20)
  ]);

  if (walletResult.error && walletResult.error.code !== "PGRST116") {
    throw walletResult.error;
  }
  if (txResult.error) {
    throw txResult.error;
  }

  appState.walletUsd = Number(walletResult.data?.balance || 0);
  walletState.transactions = txResult.data || [];
  renderWalletBalance();
  renderTransactions();
}

function setupDepositForm() {
  const form = document.getElementById("depositForm");
  if (!form) {
    return;
  }

  const currencySelect = form.querySelector("#depositCurrency");
  if (currencySelect) {
    currencySelect.innerHTML = SUPPORTED_CURRENCIES.map((code) => `<option value="${code}">${code}</option>`).join("");
    currencySelect.value = appState.currency;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = form.querySelector("button[type='submit']");
    setButtonLoading(button, true);

    try {
      const amount = Number(form.querySelector("#depositAmount")?.value || 0);
      const currency = form.querySelector("#depositCurrency")?.value || appState.currency;

      if (Number.isNaN(amount) || amount <= 0) {
        throw new Error("Deposit amount must be greater than zero.");
      }

      const response = await invokeFunction("create-stripe-session", {
        type: "wallet_deposit",
        amount,
        currency,
        successUrl: `${config.appBaseUrl}/success.html`,
        cancelUrl: `${config.appBaseUrl}/cancel.html`
      });

      if (!response.checkoutUrl) {
        throw new Error("Unable to start deposit checkout.");
      }

      window.location.href = response.checkoutUrl;
    } catch (error) {
      showToast(error.message || "Deposit failed.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  });
}

export async function initWalletSection() {
  try {
    await fetchWalletData();
  } catch (error) {
    showToast(error.message || "Failed to load wallet.", "error");
  }

  setupDepositForm();

  document.addEventListener("mlbb:currency-updated", () => {
    renderWalletBalance();
    renderTransactions();
  });
}
