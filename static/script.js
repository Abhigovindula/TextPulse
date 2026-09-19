"use strict";

/* =========================================================
   TextPulse – frontend logic

   API CONTRACT (taken from the FastAPI backend code)
   ---------------------------------------------------------
   POST /predict
     request  : { "text": string }            (1 to 2000 characters)
     response : {
       "text": string,
       "predicted_emotion": string,           e.g. "joy"
       "confidence": number,                  0 to 1
       "all_probabilites": { [emotion]: number }   (sic: backend spelling)
     }
     errors   : 422 (validation), 503 (model not loaded yet)

   GET /health
     response : { "status": string, "model_loaded": boolean }
   ========================================================= */

/* ---------- Configuration (edit here) ---------- */

// Empty string = same origin (the page is served by the FastAPI app itself).
// If you host the frontend elsewhere, use e.g. "http://localhost:8000".
// The backend already allows cross-origin requests (CORS).
const API_URL = "";

const ENDPOINTS = {
  predict: "/predict",
  health: "/health",
};

const MAX_CHARS = 2000;            // matches TextInput.max_length in the backend
const MODEL_MAX_TOKENS = 50;       // matches max_sequence_length in the backend
const REQUEST_TIMEOUT_MS = 20000;
const HEALTH_TIMEOUT_MS = 5000;
const HEALTH_INTERVAL_MS = 30000;

// Labels and emojis mirror the backend's emotion_labels / EMOTION_EMOJIS.
const EMOTIONS = {
  sadness:  { label: "Sadness",  emoji: "😢" },
  joy:      { label: "Joy",      emoji: "😄" },
  love:     { label: "Love",     emoji: "❤️" },
  anger:    { label: "Anger",    emoji: "😠" },
  fear:     { label: "Fear",     emoji: "😨" },
  surprise: { label: "Surprise", emoji: "😲" },
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 52; // r = 52 in the SVG

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ---------- DOM references ---------- */

const $ = (selector) => document.querySelector(selector);

const dom = {
  header: $("#site-header"),
  nav: $("#site-nav"),
  navToggle: $("#nav-toggle"),
  navLinks: document.querySelectorAll("[data-nav]"),

  status: $("#status"),
  statusText: $("#status-text"),

  form: $("#analyzer-form"),
  input: $("#text-input"),
  charCount: $("#char-count"),
  clearBtn: $("#clear-btn"),
  analyzeBtn: $("#analyze-btn"),
  chips: document.querySelectorAll("[data-example]"),

  panel: $("#result-panel"),
  views: document.querySelectorAll("[data-view]"),
  errorMessage: $("#error-message"),
  retryBtn: $("#retry-btn"),
  successView: $('[data-view="success"]'),
  ringValue: $("#ring-value"),
  confidenceValue: $("#confidence-value"),
  emotionName: $("#emotion-name"),
  emotionEmoji: $("#emotion-emoji"),
  distribution: $("#distribution"),
  distributionList: $("#distribution-list"),
  cleanedNote: $("#cleaned-note"),
  cleanedText: $("#cleaned-text"),
  truncateNote: $("#truncate-note"),

  srStatus: $("#sr-status"),
  toastRegion: $("#toast-region"),
  modelCards: document.querySelectorAll("[data-model]"),
};

let isLoading = false;

/* =========================================================
   API layer
   ========================================================= */

class ApiError extends Error {
  /** kind: "network" | "timeout" | "http" | "invalid" */
  constructor(kind, details = {}) {
    super(kind);
    this.kind = kind;
    this.status = details.status ?? null;
  }
}

/** fetch() with a timeout. Throws the original error on failure. */
async function request(path, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(API_URL + path, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** POST /predict with { text } and return a validated, normalised result. */
async function predictEmotion(text) {
  let response;
  try {
    response = await request(ENDPOINTS.predict, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    throw new ApiError(err.name === "AbortError" ? "timeout" : "network");
  }

  if (!response.ok) {
    throw new ApiError("http", { status: response.status });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("invalid");
  }
  return normalisePrediction(data);
}

/** Check the response really has the shape the backend documents. */
function normalisePrediction(data) {
  if (
    !data ||
    typeof data.predicted_emotion !== "string" ||
    typeof data.confidence !== "number" ||
    !Number.isFinite(data.confidence)
  ) {
    throw new ApiError("invalid");
  }

  // The backend spells this key "all_probabilites". The correct spelling is
  // also accepted in case you fix the typo on the server later.
  const rawProbabilities = data.all_probabilites ?? data.all_probabilities;

  let probabilities = null;
  if (rawProbabilities && typeof rawProbabilities === "object") {
    probabilities = Object.entries(rawProbabilities)
      .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
      .map(([key, value]) => ({ key: key.toLowerCase(), value }))
      .sort((a, b) => b.value - a.value);
    if (probabilities.length === 0) probabilities = null;
  }

  return {
    emotion: data.predicted_emotion.toLowerCase(),
    confidence: clamp(data.confidence, 0, 1),
    probabilities,
  };
}

/** GET /health – drives the "AI Model Online" indicator honestly. */
async function checkHealth() {
  try {
    const response = await request(ENDPOINTS.health, {}, HEALTH_TIMEOUT_MS);
    if (!response.ok) throw new Error("bad status");
    const data = await response.json();

    setStatus(data.model_loaded === true ? "online" : "loading");

    // Optional: if you add a "model" field to /health, the matching card is highlighted.
    if (typeof data.model === "string") markDeployedModel(data.model);
  } catch {
    setStatus("offline");
  }
}

/* =========================================================
   Helpers
   ========================================================= */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getEmotionMeta(key) {
  const known = EMOTIONS[key];
  if (known) return { ...known, color: `var(--${key})`, cssClass: `emo-${key}` };
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return { label, emoji: "💬", color: "var(--accent)", cssClass: "" };
}

function formatPercent(probability) {
  const percent = probability * 100;
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

/** Same cleaning steps as preprocess_text() in the backend. Display only. */
function cleanText(text) {
  return text
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The backend strips everything except a-z and 0-9, so require at least one. */
function hasMeaningfulInput(text) {
  return /[a-z0-9]/i.test(text);
}

function nextFrame(callback) {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

/* =========================================================
   Status indicator
   ========================================================= */

const STATUS_COPY = {
  checking: { text: "Checking model",  title: "Checking the backend" },
  online:   { text: "AI model online", title: "The backend reports the model is loaded" },
  loading:  { text: "Model loading",   title: "The backend is running but the model is still loading" },
  offline:  { text: "Backend offline", title: "The backend could not be reached" },
};

function setStatus(state) {
  const copy = STATUS_COPY[state];
  dom.status.dataset.state = state;
  dom.status.title = copy.title;
  dom.statusText.textContent = copy.text;
}

function markDeployedModel(name) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  dom.modelCards.forEach((card) => {
    card.classList.toggle("is-deployed", card.dataset.model === key);
  });
}

/* =========================================================
   Result panel
   ========================================================= */

function setPanelState(state) {
  dom.panel.dataset.state = state;
  dom.views.forEach((view) => {
    view.hidden = view.dataset.view !== state;
  });
}

function setEmotionTheme(key) {
  const root = document.documentElement;
  if (key && EMOTIONS[key]) {
    root.dataset.emotion = key;
  } else {
    delete root.dataset.emotion;
  }
}

function setLoading(loading) {
  isLoading = loading;
  dom.analyzeBtn.classList.toggle("is-loading", loading);
  dom.analyzeBtn.querySelector(".btn-label").textContent = loading ? "Analyzing…" : "Analyze Emotion";
  dom.analyzeBtn.setAttribute("aria-busy", String(loading));
  updateControls();
}

function renderResult(result, submittedText) {
  const meta = getEmotionMeta(result.emotion);
  const confidencePercent = result.confidence * 100;

  // Colours for this emotion
  dom.panel.classList.remove(...Object.keys(EMOTIONS).map((k) => `emo-${k}`));
  if (meta.cssClass) dom.panel.classList.add(meta.cssClass);
  setEmotionTheme(result.emotion);

  // Headline
  dom.emotionName.textContent = meta.label;
  dom.emotionEmoji.textContent = meta.emoji;

  // Distribution (only if the backend sent it)
  if (result.probabilities) {
    renderDistribution(result.probabilities, result.emotion);
    dom.distribution.hidden = false;
  } else {
    dom.distribution.hidden = true;
  }

  // Notes
  const cleaned = cleanText(submittedText);
  dom.cleanedText.textContent = cleaned;
  dom.cleanedNote.hidden = cleaned.length === 0;
  dom.truncateNote.hidden = cleaned.split(" ").length <= MODEL_MAX_TOKENS;

  // Reveal: reset, then animate on the next frames
  setPanelState("success");
  dom.successView.classList.remove("is-revealed");
  dom.confidenceValue.textContent = "0.0";
  dom.successView.style.setProperty("--ring-target", String(RING_CIRCUMFERENCE));

  nextFrame(() => {
    dom.successView.style.setProperty(
      "--ring-target",
      String(RING_CIRCUMFERENCE * (1 - result.confidence))
    );
    dom.successView.classList.add("is-revealed");
    animateNumber(dom.confidenceValue, confidencePercent, 1300);
  });

  dom.srStatus.textContent =
    `Predicted emotion: ${meta.label}. Confidence ${confidencePercent.toFixed(1)} percent.`;

  // On stacked (mobile/tablet) layouts make sure the result is visible
  if (window.matchMedia("(max-width: 960px)").matches) {
    dom.panel.scrollIntoView({
      behavior: prefersReducedMotion.matches ? "auto" : "smooth",
      block: "nearest",
    });
  }
}

function renderDistribution(items, topKey) {
  dom.distributionList.replaceChildren();

  items.forEach((item, index) => {
    const meta = getEmotionMeta(item.key);

    const row = document.createElement("li");
    row.className = "dist-row" + (item.key === topKey ? " is-top" : "");
    row.style.setProperty("--row-color", meta.color);

    const name = document.createElement("span");
    name.className = "dist-name";
    name.textContent = `${meta.emoji} ${meta.label}`;

    const track = document.createElement("span");
    track.className = "dist-track";
    const fill = document.createElement("span");
    fill.className = "dist-fill";
    fill.style.setProperty("--w", `${clamp(item.value, 0, 1) * 100}%`);
    fill.style.transitionDelay = `${index * 70}ms`;
    track.appendChild(fill);

    const value = document.createElement("span");
    value.className = "dist-value";
    value.textContent = formatPercent(item.value);

    row.append(name, track, value);
    dom.distributionList.appendChild(row);
  });
}

function animateNumber(element, target, duration) {
  if (prefersReducedMotion.matches) {
    element.textContent = target.toFixed(1);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const progress = clamp((now - start) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    element.textContent = (target * eased).toFixed(1);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* =========================================================
   Errors and toasts
   ========================================================= */

function friendlyMessage(error) {
  if (!(error instanceof ApiError)) {
    return "Something unexpected went wrong. Please try again.";
  }
  switch (error.kind) {
    case "network":
      return "We couldn't analyze your text right now. Please make sure the TextPulse backend is running and try again.";
    case "timeout":
      return "The analysis is taking longer than expected. Check that the backend is running, then try again.";
    case "invalid":
      return "The server replied with data TextPulse doesn't recognise. Check that the frontend and backend match.";
    case "http":
      if (error.status === 503) return "The model is still loading. Wait a few seconds and try again.";
      if (error.status === 422) return `The text was rejected. Use between 1 and ${MAX_CHARS.toLocaleString()} characters.`;
      return `The server returned an error (status ${error.status}). Please try again in a moment.`;
    default:
      return "Something unexpected went wrong. Please try again.";
  }
}

let toastTimer = null;

function showToast(message, kind = "error") {
  clearTimeout(toastTimer);
  dom.toastRegion.replaceChildren();

  const toast = document.createElement("div");
  toast.className = "toast" + (kind === "info" ? " is-info" : "");

  const text = document.createElement("p");
  text.textContent = message;

  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss message");
  close.textContent = "×";
  close.addEventListener("click", () => {
    clearTimeout(toastTimer);
    toast.remove();
  });

  toast.append(text, close);
  dom.toastRegion.appendChild(toast);
  toastTimer = setTimeout(() => toast.remove(), 7000);
}

/* =========================================================
   Form behaviour
   ========================================================= */

function updateControls() {
  const value = dom.input.value;
  const length = value.length;

  dom.charCount.textContent = `${length.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`;
  dom.charCount.classList.toggle("is-near-limit", length >= MAX_CHARS * 0.95);

  dom.analyzeBtn.disabled = isLoading || !hasMeaningfulInput(value);
  dom.clearBtn.disabled = length === 0 && dom.panel.dataset.state === "empty";
}

async function analyze() {
  if (isLoading) return;

  const text = dom.input.value.trim();
  if (!hasMeaningfulInput(text)) {
    showToast("Enter a sentence with at least one letter or number, then try again.", "info");
    dom.input.focus();
    return;
  }

  setLoading(true);
  setPanelState("loading");
  setEmotionTheme(null);
  dom.srStatus.textContent = "Analyzing your text.";

  try {
    const result = await predictEmotion(text);
    setStatus("online");
    renderResult(result, text);
  } catch (error) {
    const message = friendlyMessage(error);
    if (error instanceof ApiError && (error.kind === "network" || error.kind === "timeout")) {
      setStatus("offline");
    }
    dom.errorMessage.textContent = message;
    setPanelState("error");
    dom.srStatus.textContent = message;
    showToast(message);
  } finally {
    setLoading(false);
  }
}

function resetAll() {
  dom.input.value = "";
  setPanelState("empty");
  setEmotionTheme(null);
  dom.srStatus.textContent = "";
  updateControls();
  dom.input.focus();
}

dom.form.addEventListener("submit", (event) => {
  event.preventDefault();
  analyze();
});

// Enter adds a new line; Ctrl/Cmd + Enter analyzes.
dom.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    analyze();
  }
});

dom.input.addEventListener("input", updateControls);
dom.clearBtn.addEventListener("click", resetAll);
dom.retryBtn.addEventListener("click", analyze);

dom.chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    dom.input.value = chip.dataset.example;
    updateControls();
    dom.input.focus();
    dom.input.setSelectionRange(dom.input.value.length, dom.input.value.length);
  });
});

/* =========================================================
   Navigation
   ========================================================= */

function setNavOpen(open) {
  dom.nav.classList.toggle("is-open", open);
  dom.navToggle.setAttribute("aria-expanded", String(open));
  dom.navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}

dom.navToggle.addEventListener("click", () => {
  setNavOpen(dom.navToggle.getAttribute("aria-expanded") !== "true");
});

dom.navLinks.forEach((link) => link.addEventListener("click", () => setNavOpen(false)));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setNavOpen(false);
});

// Header background once the page scrolls
function onScroll() {
  dom.header.classList.toggle("is-scrolled", window.scrollY > 8);
}
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Highlight the nav link for the section in view
const observedSections = [...dom.navLinks]
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      dom.navLinks.forEach((link) => {
        const active = link.getAttribute("href") === `#${entry.target.id}`;
        if (active) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    });
  },
  { rootMargin: "-45% 0px -50% 0px" }
);
observedSections.forEach((section) => sectionObserver.observe(section));

/* =========================================================
   Init
   ========================================================= */

updateControls();
checkHealth();
setInterval(checkHealth, HEALTH_INTERVAL_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkHealth();
});
