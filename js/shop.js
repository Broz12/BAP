import { config, deepLinkToWhatsapp, invokeFunction, supabase } from "../supabase/config.js";
import {
  appState,
  formatMoney,
  initBasePage,
  preventDoubleSubmit,
  setButtonLoading,
  showToast,
  usdToCurrency
} from "./app.js";
import { initCurrencySelector } from "./currency.js";

const shopState = {
  products: [],
  selectedProduct: null
};

function renderProducts() {
  const container = document.getElementById("packageGrid");
  if (!container) {
    return;
  }

  container.innerHTML = "";
  for (const product of shopState.products) {
    const card = document.createElement("article");
    card.className = "package-card";
    card.dataset.productId = product.id;
    const convertedPrice = usdToCurrency(product.base_price_usd, appState.currency);

    card.innerHTML = `
      <div class="chip-group">
        <span class="chip">${product.diamond_amount} Diamonds</span>
      </div>
      <h3 class="package-title">${product.name}</h3>
      <div class="package-price">${formatMoney(convertedPrice, appState.currency)}</div>
    `;

    card.addEventListener("click", () => {
      selectProduct(product.id);
    });

    container.appendChild(card);
  }

  if (shopState.products.length > 0 && !shopState.selectedProduct) {
    selectProduct(shopState.products[0].id);
  }
}

function selectProduct(productId) {
  shopState.selectedProduct = shopState.products.find((p) => p.id === productId) || null;
  document.querySelectorAll(".package-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.productId === productId);
  });
  renderSelectedPackage();
}

function renderSelectedPackage() {
  const node = document.getElementById("selectedPackage");
  if (!node) {
    return;
  }

  if (!shopState.selectedProduct) {
    node.textContent = "No package selected";
    return;
  }

  const price = usdToCurrency(shopState.selectedProduct.base_price_usd, appState.currency);
  node.textContent = `${shopState.selectedProduct.name} (${shopState.selectedProduct.diamond_amount} Diamonds) - ${formatMoney(
    price,
    appState.currency
  )}`;
}

async function loadProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, diamond_amount, base_price_usd, active")
    .eq("active", true)
    .order("diamond_amount", { ascending: true });

  if (error) {
    throw error;
  }

  shopState.products = data || [];
  renderProducts();
}

function buildOrderWhatsappMessage(orderLike) {
  return [
    "New MLBB Order",
    `Order ID: ${orderLike.id || "Pending"}`,
    `Player ID: ${orderLike.player_id}`,
    `Server ID: ${orderLike.server_id}`,
    `Package: ${orderLike.product_name || shopState.selectedProduct?.name || "N/A"}`,
    `Amount: ${formatMoney(orderLike.amount || 0, orderLike.currency || appState.currency)}`
  ].join("\n");
}

function setupTopupForm() {
  const form = document.getElementById("topupForm");
  if (!form) {
    return;
  }

  preventDoubleSubmit(form, async () => {
    const submitButton = form.querySelector("button[type='submit']");
    setButtonLoading(submitButton, true);

    try {
      if (!shopState.selectedProduct) {
        throw new Error("Please select a diamond package.");
      }

      const playerId = form.querySelector("#playerId")?.value.trim();
      const serverId = form.querySelector("#serverId")?.value.trim();
      const paymentMethod = form.querySelector("input[name='paymentMethod']:checked")?.value;

      if (!playerId || !serverId) {
        throw new Error("Player ID and Server ID are required.");
      }

      if (!/^[0-9]{4,20}$/.test(playerId)) {
        throw new Error("Player ID must be 4-20 digits.");
      }

      if (!/^[0-9]{2,10}$/.test(serverId)) {
        throw new Error("Server ID must be 2-10 digits.");
      }

      if (!paymentMethod) {
        throw new Error("Choose a payment method.");
      }

      if (paymentMethod === "stripe") {
        const payload = {
          type: "topup",
          productId: shopState.selectedProduct.id,
          playerId,
          serverId,
          currency: appState.currency,
          successUrl: `${config.appBaseUrl}/success.html`,
          cancelUrl: `${config.appBaseUrl}/cancel.html`
        };
        const response = await invokeFunction("create-stripe-session", payload);
        if (!response.checkoutUrl) {
          throw new Error("Stripe checkout URL not returned.");
        }
        window.location.href = response.checkoutUrl;
        return;
      }

      const walletResponse = await invokeFunction("wallet-pay", {
        productId: shopState.selectedProduct.id,
        playerId,
        serverId,
        currency: appState.currency
      });

      const order = walletResponse.order;
      showToast("Order paid from wallet and queued for processing.", "success");

      form.reset();
      renderSelectedPackage();

      const whatsappBtn = document.getElementById("whatsappFallbackBtn");
      if (whatsappBtn) {
        whatsappBtn.href = deepLinkToWhatsapp(
          buildOrderWhatsappMessage({
            ...order,
            product_name: shopState.selectedProduct?.name
          })
        );
        whatsappBtn.classList.remove("hidden");
      }
    } catch (error) {
      showToast(error.message || "Failed to create order.", "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

async function loadRecentOrders() {
  const list = document.getElementById("recentOrders");
  if (!list) {
    return;
  }

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, created_at, amount, currency, payment_status, order_status, player_id, server_id, product:products!orders_product_id_fkey(name)"
    )
    .eq("user_id", appState.user.id)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    list.innerHTML = "<p class='label'>No orders yet.</p>";
    return;
  }

  list.innerHTML = data
    .map((row) => {
      const productName = row.product?.name || "Package";
      return `
      <article class="card">
        <div class="inline-actions" style="justify-content:space-between; align-items:center;">
          <strong>#${row.id.slice(0, 8)}</strong>
          <span class="badge ${row.order_status}">${row.order_status}</span>
        </div>
        <p class="label">${productName} | Player ${row.player_id} (${row.server_id})</p>
        <p>${formatMoney(row.amount, row.currency)} | Payment: <span class="badge ${row.payment_status}">${row.payment_status}</span></p>
      </article>
    `;
    })
    .join("");
}

export async function initTopupPage() {
  await initBasePage({ requireAuth: true });

  await initCurrencySelector({
    selectorId: "currencySelect",
    onChange: () => {
      renderProducts();
      renderSelectedPackage();
    }
  });

  try {
    await loadProducts();
    await loadRecentOrders();
  } catch (error) {
    showToast(error.message || "Failed to load shop data.", "error");
  }

  setupTopupForm();

  document.addEventListener("mlbb:currency-updated", () => {
    renderProducts();
    renderSelectedPackage();
  });
}
