"use strict";

/*
 * PUBLIC BROWSER CONFIGURATION
 * Replace only these four labeled placeholders. These values ship publicly.
 * Never put Supabase service-role keys or Stripe secret keys in this file.
 */
const CONFIG = Object.freeze({
  SUPABASE_URL: "YOUR_SUPABASE_URL",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",
  STRIPE_BUY_BUTTON_ID: "YOUR_STRIPE_BUY_BUTTON_ID",
  STRIPE_PUBLISHABLE_KEY: "YOUR_STRIPE_PUBLISHABLE_KEY"
});

const form = document.querySelector("#enrollment-form");
const submitButton = document.querySelector("#submit-button");
const formStatus = document.querySelector("#form-status");
const checkout = document.querySelector("#checkout");
const stripeContainer = document.querySelector("#stripe-button-container");
const referenceOutput = document.querySelector("#enrollment-reference");

const messages = {
  first_name: "Enter your first name.",
  last_name: "Enter your last name.",
  email: "Enter a valid email address.",
  company: "Enter your company name.",
  product: "Select a program.",
  consent: "Consent is required to continue."
};

document.querySelector("#current-year").textContent = new Date().getFullYear();

function isConfigured(value) {
  return Boolean(value) && !value.startsWith("YOUR_");
}

function setFieldError(field, message = "") {
  const error = document.querySelector(`#${field.id}-error`);
  field.setAttribute("aria-invalid", message ? "true" : "false");
  if (error) error.textContent = message;
}

function validateField(field) {
  let valid = field.checkValidity();
  if (field.type !== "checkbox" && !field.value.trim()) valid = false;
  setFieldError(field, valid ? "" : messages[field.name]);
  return valid;
}

function validateForm() {
  const fields = [...form.querySelectorAll("input, select")];
  const valid = fields.map(validateField).every(Boolean);
  if (!valid) {
    const firstInvalid = form.querySelector('[aria-invalid="true"]');
    firstInvalid?.focus();
    showStatus("Check the highlighted fields and try again.", "error");
  }
  return valid;
}

function showStatus(message, type = "") {
  formStatus.textContent = message;
  formStatus.className = `form-status ${type}`.trim();
}

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.classList.toggle("is-loading", loading);
  submitButton.setAttribute("aria-busy", String(loading));
}

function getPayload() {
  const data = new FormData(form);
  return {
    first_name: data.get("first_name").trim(),
    last_name: data.get("last_name").trim(),
    email: data.get("email").trim().toLowerCase(),
    company: data.get("company").trim(),
    product: data.get("product"),
    consent: data.get("consent") === "on"
  };
}

async function createEnrollment(payload) {
  if (!isConfigured(CONFIG.SUPABASE_URL) || !isConfigured(CONFIG.SUPABASE_ANON_KEY)) {
    throw new Error("Enrollment is not configured yet. Add the public Supabase URL and anon key in app.js.");
  }

  const baseUrl = CONFIG.SUPABASE_URL.replace(/\/$/, "");
  let response;
  try {
    response = await fetch(`${baseUrl}/rest/v1/rpc/create_enrollment`, {
      method: "POST",
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_first_name: payload.first_name,
        p_last_name: payload.last_name,
        p_email: payload.email,
        p_company: payload.company,
        p_product: payload.product,
        p_consent: payload.consent
      })
    });
  } catch {
    throw new Error("We couldn’t reach enrollment services. Check your connection and try again.");
  }

  if (!response.ok) {
    throw new Error("We couldn’t save your enrollment. Please wait a moment and try again.");
  }

  const enrollmentId = await response.json();
  if (typeof enrollmentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(enrollmentId)) {
    throw new Error("Your enrollment was saved, but its reference could not be confirmed. Contact support before paying.");
  }
  return enrollmentId;
}

function revealCheckout(enrollmentId, email) {
  referenceOutput.textContent = enrollmentId;
  stripeContainer.replaceChildren();

  const stripeReady = isConfigured(CONFIG.STRIPE_BUY_BUTTON_ID) && isConfigured(CONFIG.STRIPE_PUBLISHABLE_KEY);
  if (stripeReady) {
    const buyButton = document.createElement("stripe-buy-button");
    buyButton.setAttribute("buy-button-id", CONFIG.STRIPE_BUY_BUTTON_ID);
    buyButton.setAttribute("publishable-key", CONFIG.STRIPE_PUBLISHABLE_KEY);
    buyButton.setAttribute("client-reference-id", enrollmentId);
    buyButton.setAttribute("customer-email", email);
    stripeContainer.append(buyButton);
  } else {
    const notice = document.createElement("p");
    notice.className = "form-status error";
    notice.textContent = "Checkout is not configured yet. Your enrollment is saved; contact support to continue.";
    stripeContainer.append(notice);
  }

  form.hidden = true;
  checkout.hidden = false;
  checkout.setAttribute("tabindex", "-1");
  checkout.focus();
}

form.addEventListener("input", (event) => {
  if (event.target.matches("input, select") && event.target.getAttribute("aria-invalid") === "true") {
    validateField(event.target);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus("");
  if (!validateForm()) return;

  const payload = getPayload();
  setLoading(true);
  showStatus("Saving your enrollment…");

  try {
    const enrollmentId = await createEnrollment(payload);
    showStatus("Enrollment saved.", "success");
    revealCheckout(enrollmentId, payload.email);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Something went wrong. Please try again.", "error");
    formStatus.focus();
  } finally {
    setLoading(false);
  }
});
