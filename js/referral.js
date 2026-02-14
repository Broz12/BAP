import { supabase } from "../supabase/config.js";
import { appState, formatMoney, showToast, usdToCurrency } from "./app.js";

const referralState = {
  items: []
};

function referralLink() {
  if (!appState.profile?.referral_code) {
    return "";
  }
  return `${window.location.origin}/index.html?ref=${appState.profile.referral_code}`;
}

function renderReferralInfo() {
  const codeNode = document.getElementById("referralCode");
  const linkNode = document.getElementById("referralLink");
  if (codeNode) {
    codeNode.textContent = appState.profile?.referral_code || "N/A";
  }
  if (linkNode) {
    linkNode.value = referralLink();
  }
}

function renderReferralStats() {
  const totalNode = document.getElementById("refTotal");
  const earnedUsdNode = document.getElementById("refEarnedUsd");
  const earnedLocalNode = document.getElementById("refEarnedLocal");

  const totalReferrals = referralState.items.length;
  const earnedUsd = referralState.items.reduce((sum, row) => sum + Number(row.commission_amount_usd || 0), 0);

  if (totalNode) {
    totalNode.textContent = `${totalReferrals}`;
  }
  if (earnedUsdNode) {
    earnedUsdNode.textContent = formatMoney(earnedUsd, "USD");
  }
  if (earnedLocalNode) {
    earnedLocalNode.textContent = formatMoney(usdToCurrency(earnedUsd, appState.currency), appState.currency);
  }
}

function renderReferralTable() {
  const body = document.getElementById("referralBody");
  if (!body) {
    return;
  }

  if (!referralState.items.length) {
    body.innerHTML = `<tr><td colspan="4">No referral commissions yet.</td></tr>`;
    return;
  }

  body.innerHTML = referralState.items
    .map((item) => {
      const local = usdToCurrency(item.commission_amount_usd, appState.currency);
      return `
        <tr>
          <td>${new Date(item.created_at).toLocaleString()}</td>
          <td>${item.referred_user?.email || "New user"}</td>
          <td>${formatMoney(item.commission_amount_usd, "USD")}</td>
          <td>${formatMoney(local, appState.currency)}</td>
        </tr>
      `;
    })
    .join("");
}

async function fetchReferralData() {
  const { data, error } = await supabase
    .from("referrals")
    .select("id, commission_amount_usd, created_at, referred_user:users!referrals_referred_user_id_fkey(email)")
    .eq("referrer_id", appState.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw error;
  }

  referralState.items = data || [];
  renderReferralStats();
  renderReferralTable();
}

function setupCopyActions() {
  const copyBtn = document.getElementById("copyReferralBtn");
  if (!copyBtn) {
    return;
  }

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(referralLink());
      showToast("Referral link copied.", "success");
    } catch {
      showToast("Failed to copy referral link.", "error");
    }
  });
}

export async function initReferralSection() {
  renderReferralInfo();
  setupCopyActions();

  try {
    await fetchReferralData();
  } catch (error) {
    showToast(error.message || "Failed to load referral stats.", "error");
  }

  document.addEventListener("mlbb:currency-updated", () => {
    renderReferralStats();
    renderReferralTable();
  });
}
