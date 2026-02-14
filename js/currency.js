import { appState, formatMoney, getPreferredCurrency, loadExchangeRates, setPreferredCurrency, usdToCurrency } from "./app.js";

export const SUPPORTED_CURRENCIES = ["USD", "INR", "PHP", "IDR", "MYR"];

function updateDisplayCurrency() {
  document.querySelectorAll("[data-price-usd]").forEach((node) => {
    const usdValue = Number(node.dataset.priceUsd || 0);
    const converted = usdToCurrency(usdValue, appState.currency);
    node.textContent = formatMoney(converted, appState.currency);
  });

  document.dispatchEvent(
    new CustomEvent("mlbb:currency-updated", {
      detail: {
        currency: appState.currency
      }
    })
  );
}

export async function initCurrencySelector({ selectorId = "currencySelect", onChange } = {}) {
  await loadExchangeRates();
  const select = document.getElementById(selectorId);
  if (!select) {
    return;
  }

  select.innerHTML = "";
  for (const code of SUPPORTED_CURRENCIES) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = code;
    select.appendChild(option);
  }

  const preferred = getPreferredCurrency();
  select.value = SUPPORTED_CURRENCIES.includes(preferred) ? preferred : "USD";
  setPreferredCurrency(select.value);
  updateDisplayCurrency();

  select.addEventListener("change", () => {
    const selected = SUPPORTED_CURRENCIES.includes(select.value) ? select.value : "USD";
    setPreferredCurrency(selected);
    updateDisplayCurrency();
    if (onChange) {
      onChange(selected);
    }
  });

  if (onChange) {
    onChange(select.value);
  }
}

export function convertUsdForCurrentCurrency(amountUsd) {
  return usdToCurrency(amountUsd, appState.currency);
}

export function formatUsdConverted(amountUsd) {
  return formatMoney(convertUsdForCurrentCurrency(amountUsd), appState.currency);
}

export function refreshCurrencyDisplays() {
  updateDisplayCurrency();
}
