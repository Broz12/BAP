import { supabase } from "../supabase/config.js";
import { initBasePage, preventDoubleSubmit, setButtonLoading, showToast } from "./app.js";

function captureReferralCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const referralCode = params.get("ref");
  if (!referralCode) {
    return;
  }

  localStorage.setItem("mlbb_ref_code", referralCode.trim().toUpperCase());
  showToast("Referral code applied.", "success");
}

function toggleAuthTab(tab) {
  const isLogin = tab === "login";
  document.querySelectorAll("[data-auth-tab]").forEach((item) => {
    item.classList.toggle("active", item.dataset.authTab === tab);
  });

  document.getElementById("loginForm")?.classList.toggle("hidden", !isLogin);
  document.getElementById("signupForm")?.classList.toggle("hidden", isLogin);
}

async function applyStoredReferralCode() {
  const referralCode = localStorage.getItem("mlbb_ref_code");
  if (!referralCode) {
    return;
  }

  const { error } = await supabase.rpc("set_user_referrer", {
    input_referral_code: referralCode
  });

  if (!error) {
    localStorage.removeItem("mlbb_ref_code");
  }
}

function setupLoginForm() {
  const form = document.getElementById("loginForm");
  if (!form) {
    return;
  }

  preventDoubleSubmit(form, async () => {
    const submitButton = form.querySelector("button[type='submit']");
    setButtonLoading(submitButton, true);
    try {
      const email = form.querySelector("#loginEmail")?.value.trim();
      const password = form.querySelector("#loginPassword")?.value.trim();

      if (!email || !password) {
        throw new Error("Email and password are required.");
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }

      await applyStoredReferralCode();
      showToast("Logged in successfully.", "success");
      window.location.href = "topup.html";
    } catch (error) {
      showToast(error.message || "Login failed.", "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

function setupSignupForm() {
  const form = document.getElementById("signupForm");
  if (!form) {
    return;
  }

  preventDoubleSubmit(form, async () => {
    const submitButton = form.querySelector("button[type='submit']");
    setButtonLoading(submitButton, true);

    try {
      const email = form.querySelector("#signupEmail")?.value.trim();
      const password = form.querySelector("#signupPassword")?.value.trim();
      const confirm = form.querySelector("#signupConfirmPassword")?.value.trim();

      if (!email || !password || !confirm) {
        throw new Error("All signup fields are required.");
      }

      if (password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }

      if (password !== confirm) {
        throw new Error("Passwords do not match.");
      }

      const referralCode = localStorage.getItem("mlbb_ref_code");

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            referral_code_used: referralCode || null
          },
          emailRedirectTo: `${window.location.origin}/dashboard.html`
        }
      });

      if (error) {
        throw error;
      }

      if (data.user && referralCode) {
        await applyStoredReferralCode();
      }

      showToast("Signup successful. Check your email if confirmation is enabled.", "success", 4500);
      toggleAuthTab("login");
      form.reset();
    } catch (error) {
      showToast(error.message || "Signup failed.", "error");
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

function setupDemoOnlyAuthForms() {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");

  if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      showToast("Connect Supabase config in js/runtime-config.js to enable login.", "info", 5000);
    });
  }

  if (signupForm) {
    signupForm.addEventListener("submit", (event) => {
      event.preventDefault();
      showToast("Connect Supabase config in js/runtime-config.js to enable signup.", "info", 5000);
    });
  }
}

export async function initAuthPage() {
  captureReferralCodeFromUrl();
  const ready = await initBasePage({ requireAuth: false });

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => toggleAuthTab(button.dataset.authTab));
  });

  toggleAuthTab("login");

  if (!ready) {
    setupDemoOnlyAuthForms();
    return;
  }

  const { data } = await supabase.auth.getSession();
  if (data.session?.user) {
    window.location.href = "dashboard.html";
    return;
  }
  setupLoginForm();
  setupSignupForm();
}
