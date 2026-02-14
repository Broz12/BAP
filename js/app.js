import { CONFIG_ERROR_MESSAGE, isConfigReady, supabase } from "../supabase/config.js";

const CURRENCY_FALLBACK_BY_COUNTRY = {
  IN: "INR",
  PH: "PHP",
  ID: "IDR",
  MY: "MYR",
  US: "USD"
};

export const appState = {
  session: null,
  user: null,
  profile: null,
  walletUsd: 0,
  ratesToUsd: {
    USD: 1
  },
  currency: "USD"
};

function ensureToastRoot() {
  let root = document.getElementById("toastRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "toastRoot";
    root.className = "toast-root";
    document.body.appendChild(root);
  }
  return root;
}

export function showToast(message, type = "info", timeoutMs = 3200) {
  const root = ensureToastRoot();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  root.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, timeoutMs);
}

export function setButtonLoading(button, isLoading) {
  if (!button) {
    return;
  }

  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = "Please wait...";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

export function setOverlayLoading(active) {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) {
    return;
  }
  overlay.classList.toggle("active", Boolean(active));
}

export function formatMoney(amount, currency = "USD") {
  const numeric = Number(amount || 0);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: ["IDR"].includes(currency) ? 0 : 2
  }).format(numeric);
}

export function activePath() {
  const file = window.location.pathname.split("/").pop() || "index.html";
  return file || "index.html";
}

export function markActiveNavLinks() {
  const path = activePath();
  document.querySelectorAll("[data-nav-link]").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    anchor.classList.toggle("active", href === path);
  });
}

function parseToastFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const toast = params.get("toast");
  if (toast) {
    showToast(toast, "info");
    params.delete("toast");
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }
}

function inferCountryCode() {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  const maybeCountry = locale.includes("-") ? locale.split("-").pop() : "US";
  return maybeCountry?.toUpperCase() || "US";
}

export function getPreferredCurrency() {
  const local = localStorage.getItem("mlbb_currency");
  if (local) {
    return local;
  }

  const country = inferCountryCode();
  return CURRENCY_FALLBACK_BY_COUNTRY[country] || "USD";
}

export function setPreferredCurrency(currency) {
  appState.currency = currency;
  localStorage.setItem("mlbb_currency", currency);
}

export async function loadExchangeRates() {
  if (!isConfigReady) {
    appState.ratesToUsd = {
      USD: 1,
      INR: 0.012,
      PHP: 0.018,
      IDR: 0.000064,
      MYR: 0.22
    };
    return appState.ratesToUsd;
  }

  const { data, error } = await supabase
    .from("exchange_rates")
    .select("currency_code, rate_to_usd, updated_at")
    .order("currency_code", { ascending: true });

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    appState.ratesToUsd = { USD: 1 };
    return appState.ratesToUsd;
  }

  const result = { USD: 1 };
  for (const row of data) {
    result[row.currency_code] = Number(row.rate_to_usd);
  }
  appState.ratesToUsd = result;
  return result;
}

export function usdToCurrency(amountUsd, currency) {
  const rateToUsd = Number(appState.ratesToUsd[currency] || 1);
  if (!rateToUsd) {
    return Number(amountUsd);
  }
  return Number(amountUsd) / rateToUsd;
}

export function currencyToUsd(amount, currency) {
  const rateToUsd = Number(appState.ratesToUsd[currency] || 1);
  return Number(amount) * rateToUsd;
}

export function setupRevealAnimations() {
  const elements = document.querySelectorAll("[data-animate]");
  if (!elements.length) {
    return;
  }
  document.body.classList.add("animations-enabled");

  if (!("IntersectionObserver" in window)) {
    elements.forEach((item) => item.classList.add("show"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("show");
          observer.unobserve(entry.target);
        }
      }
    },
    {
      threshold: 0.2
    }
  );

  elements.forEach((item) => observer.observe(item));

  // Fail-safe: never leave sections hidden if observer callbacks are blocked.
  window.setTimeout(() => {
    elements.forEach((item) => item.classList.add("show"));
  }, 900);
}

function animateCounter(node, targetValue) {
  const duration = 900;
  const start = performance.now();

  function frame(now) {
    const progress = Math.min((now - start) / duration, 1);
    const value = Math.floor(targetValue * progress);
    node.textContent = value.toLocaleString();
    if (progress < 1) {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

export function initCounters() {
  document.querySelectorAll("[data-counter]").forEach((node) => {
    const target = Number(node.dataset.counter || 0);
    animateCounter(node, target);
  });
}

export function initModalSystem() {
  document.querySelectorAll("[data-modal-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-modal-open");
      document.getElementById(id)?.classList.add("active");
    });
  });

  document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".modal")?.classList.remove("active");
    });
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.classList.remove("active");
      }
    });
  });
}

export async function loadProfileAndWallet() {
  if (!appState.user) {
    return;
  }

  const [{ data: profile, error: profileError }, { data: wallet, error: walletError }] = await Promise.all([
    supabase.from("users").select("id, email, role, referral_code, referred_by, created_at").eq("id", appState.user.id).single(),
    supabase.from("wallets").select("balance").eq("user_id", appState.user.id).single()
  ]);

  if (profileError) {
    throw profileError;
  }

  if (walletError && walletError.code !== "PGRST116") {
    throw walletError;
  }

  appState.profile = profile;
  appState.walletUsd = Number(wallet?.balance || 0);
}

function renderAuthAwareUi() {
  const signedIn = Boolean(appState.user);
  document.querySelectorAll("[data-auth-only]").forEach((node) => node.classList.toggle("hidden", !signedIn));
  document.querySelectorAll("[data-guest-only]").forEach((node) => node.classList.toggle("hidden", signedIn));

  const walletLabel = document.getElementById("walletBadge");
  if (walletLabel) {
    if (signedIn) {
      const display = usdToCurrency(appState.walletUsd, appState.currency);
      walletLabel.textContent = `Wallet ${formatMoney(display, appState.currency)}`;
      walletLabel.classList.remove("hidden");
    } else {
      walletLabel.classList.add("hidden");
    }
  }

  const userEmail = document.getElementById("navUserEmail");
  if (userEmail) {
    userEmail.textContent = signedIn ? appState.user.email : "";
  }
}

export async function initBasePage({ requireAuth = false, requireAdmin = false } = {}) {
  markActiveNavLinks();
  parseToastFromUrl();
  initModalSystem();
  setupRevealAnimations();
  setPreferredCurrency(getPreferredCurrency());

  if (!isConfigReady) {
    const shouldWarn = requireAuth || requireAdmin;
    if (shouldWarn && !sessionStorage.getItem("mlbb_config_warned")) {
      showToast(CONFIG_ERROR_MESSAGE, "info", 6500);
      sessionStorage.setItem("mlbb_config_warned", "1");
    }
    return false;
  }

  await loadExchangeRates();

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }

  appState.session = data.session;
  appState.user = data.session?.user ?? null;

  if (requireAuth && !appState.user) {
    window.location.href = "index.html?toast=Please+login+to+continue";
    return false;
  }

  if (appState.user) {
    await loadProfileAndWallet();

    if (requireAdmin && appState.profile?.role !== "admin") {
      showToast("Admin access required.", "error");
      window.location.href = "dashboard.html";
      return false;
    }
  } else if (requireAdmin) {
    window.location.href = "index.html?toast=Please+login+as+admin";
    return false;
  }

  renderAuthAwareUi();

  document.addEventListener("mlbb:currency-updated", () => {
    renderAuthAwareUi();
  });

  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        showToast(signOutError.message, "error");
        return;
      }
      window.location.href = "index.html?toast=Logged+out+successfully";
    });
  });

  supabase.auth.onAuthStateChange(async (_event, session) => {
    appState.session = session;
    appState.user = session?.user ?? null;
    if (session?.user) {
      await loadProfileAndWallet();
    }
    renderAuthAwareUi();
  });

  return true;
}

export function preventDoubleSubmit(form, callback) {
  let submitting = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    submitting = true;
    try {
      await callback(event);
    } finally {
      submitting = false;
    }
  });
}
