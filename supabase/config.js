import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";

function meta(name) {
  return document.querySelector(`meta[name="${name}"]`)?.content?.trim() ?? "";
}

function readConfig() {
  const runtime = window.__APP_CONFIG ?? {};
  const inferredBaseUrl = new URL(".", window.location.href).href.replace(/\/$/, "");
  const supabaseUrl = runtime.SUPABASE_URL || meta("supabase-url");
  const supabaseAnonKey = runtime.SUPABASE_ANON_KEY || meta("supabase-anon-key");
  const stripePublishableKey = runtime.STRIPE_PUBLISHABLE_KEY || meta("stripe-publishable-key");
  const appBaseUrl = runtime.APP_BASE_URL || meta("app-base-url") || inferredBaseUrl;
  const functionsBaseUrl = runtime.SUPABASE_FUNCTIONS_URL || `${supabaseUrl}/functions/v1`;

  return {
    supabaseUrl,
    supabaseAnonKey,
    stripePublishableKey,
    appBaseUrl,
    functionsBaseUrl,
    adminWhatsappNumber: runtime.ADMIN_WHATSAPP_NUMBER || meta("admin-whatsapp-number") || ""
  };
}

export const config = Object.freeze(readConfig());

export const CONFIG_ERROR_MESSAGE =
  "Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY in js/runtime-config.js and redeploy.";

export const isConfigReady = Boolean(config.supabaseUrl && config.supabaseAnonKey);

function unconfiguredClient() {
  const fail = () => {
    throw new Error(CONFIG_ERROR_MESSAGE);
  };

  return {
    from: fail,
    rpc: fail,
    storage: {
      from: fail
    },
    auth: {
      getSession: fail,
      signOut: fail,
      signInWithPassword: fail,
      signUp: fail,
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe() {}
          }
        }
      })
    }
  };
}

if (!isConfigReady) {
  console.warn(CONFIG_ERROR_MESSAGE);
}

export const supabase = isConfigReady
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : unconfiguredClient();

export async function getSession() {
  if (!isConfigReady) {
    throw new Error(CONFIG_ERROR_MESSAGE);
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function invokeFunction(name, payload, method = "POST") {
  if (!isConfigReady) {
    throw new Error(CONFIG_ERROR_MESSAGE);
  }
  const session = await getSession();
  if (!session?.access_token) {
    throw new Error("You must be logged in.");
  }

  const response = await fetch(`${config.functionsBaseUrl}/${name}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`
    },
    body: method === "GET" ? undefined : JSON.stringify(payload ?? {})
  });

  const raw = await response.text();
  const parsed = raw ? JSON.parse(raw) : {};

  if (!response.ok) {
    const message = parsed?.error || parsed?.message || `Function ${name} failed.`;
    throw new Error(message);
  }

  return parsed;
}

export function deepLinkToWhatsapp(message) {
  const text = encodeURIComponent(message);
  if (!config.adminWhatsappNumber) {
    return `https://wa.me/?text=${text}`;
  }
  return `https://wa.me/${config.adminWhatsappNumber.replace(/\D/g, "")}?text=${text}`;
}
