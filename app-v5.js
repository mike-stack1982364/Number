const SETTINGS_KEY = "numberPattern.settings.v5";
const HISTORY_KEY = "numberPattern.history.v5";

const DEFAULTS = Object.freeze({
  nBack: 2,
  trialCount: 24,
  infinite: false,
  spoken: false,
  speechRate: 0.85,
  trialDelayMs: 0,
});

const RULES = Object.freeze([
  { id: "add2", make: (start) => [start, start + 2, start + 4, start + 6] },
  { id: "add3", make: (start) => [start, start + 3, start + 6, start + 9] },
  { id: "add5", make: (start) => [start, start + 5, start + 10, start + 15] },
  { id: "subtract2", make: (start) => [start, start - 2, start - 4, start - 6] },
  { id: "subtract3", make: (start) => [start, start - 3, start - 6, start - 9] },
  { id: "times2", make: (start) => [start, start * 2, start * 4, start * 8] },
  { id: "times3", make: (start) => [start, start * 3, start * 9, start * 27] },
  { id: "divide2", starts: [16, 24, 32, 40, 48, 64], make: (start) => [start, start / 2, start / 4, start / 8] },
]);

const $ = (selector) => document.querySelector(selector);
const VIEWS = ["home", "play", "game", "summary", "progress"];

const els = {
  home: $("#home-button"), begin: $("#begin-button"), start: $("#start-game"), nBack: $("#n-back"),
  trialCount: $("#trial-count"), customTrialCount: $("#custom-trial-count"), spoken: $("#spoken-premises"),
  speechRate: $("#speech-rate"), trialDelay: $("#trial-delay"), trialLabel: $("#trial-label"),
  progressBar: $("#progress-bar"), nBadge: $("#n-badge"), scoreBadge: $("#score-badge"), series: $("#series"),
  memoryCard: $("#memory-card"), memoryQuestion: $("#memory-question"), warmupNote: $("#warmup-note"),
  feedback: $("#feedback"), submit: $("#submit-answer"), next: $("#next-trial"), end: $("#end-game"),
  summaryHeading: $("#summary-heading"), totalScore: $("#total-score"), summaryGrid: $("#summary-grid"),
  summaryNote: $("#summary-note"), trainAgain: $("#train-again"), historyList: $("#history-list"),
};

const state = {
  settings: loadObject(SETTINGS_KEY, DEFAULTS), history: loadArray(HISTORY_KEY), trials: [], index: 0,
  selectedMatch: null, results: [], submitted: false, active: false, trialTimer: 0, speechFallbackTimer: 0,
  trialStartedAt: 0, advancing: false, presentationToken: 0, speechInProgress: false,
};

initialize();

function initialize() {
  setTrialCountUi();
  els.nBack.value = String(state.settings.nBack);
  els.spoken.checked = Boolean(state.settings.spoken);
  els.speechRate.value = String(state.settings.speechRate);
  els.trialDelay.value = String(state.settings.trialDelayMs);
  document.addEventListener("click", handleDocumentClick);
  els.home.addEventListener("click", () => showView("home"));
  els.begin.addEventListener("click", () => showView("play"));
  els.trialCount.addEventListener("change", syncCustomTrialInput);
  els.start.addEventListener("pointerdown", primeSpeech);
  els.start.addEventListener("click", startSession);
  els.submit.addEventListener("click", submitResponse);
  els.next.addEventListener("click", advanceFromUser);
  els.end.addEventListener("click", endSession);
  els.trainAgain.addEventListener("click", () => showView("play"));
  showView("home");
}

function loadObject(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value && typeof value === "object" && !Array.isArray(value) ? { ...fallback, ...value } : { ...fallback }; } catch { return { ...fallback }; } }
function loadArray(key) { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }

function showView(name) {
  clearAllTiming();
  for (const view of VIEWS) $(`#${view}-view`).hidden = view !== name;
  for (const button of document.querySelectorAll("nav button[data-view]")) button.classList.toggle("active", button.dataset.view === name);
  if (name === "progress") renderHistory();
  if (name !== "game") cancelSpeech();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function handleDocumentClick(event) {
  const navigation = event.target.closest("[data-view]");
  if (navigation) { showView(navigation.dataset.view); return; }
  const matchButton = event.target.closest("button[data-match]");
  if (!matchButton || state.submitted || matchButton.disabled || state.advancing || state.speechInProgress) return;
  state.selectedMatch = matchButton.dataset.match === "true";
  for (const button of els.memoryCard.querySelectorAll("button[data-match]")) {
    const selected = button === matchButton;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  els.submit.disabled = false;
}

function setTrialCountUi() {
  if (state.settings.infinite) { els.trialCount.value = "infinite"; els.customTrialCount.hidden = true; return; }
  const count = state.settings.trialCount || 24;
  const preset = [...els.trialCount.options].some((option) => option.value === String(count));
  els.trialCount.value = preset ? String(count) : "custom";
  els.customTrialCount.hidden = preset;
  els.customTrialCount.value = preset ? "" : String(count);
}

function syncCustomTrialInput() {
  const custom = els.trialCount.value === "custom";
  els.customTrialCount.hidden = !custom;
  if (custom) { if (!els.customTrialCount.value) els.customTrialCount.value = String(state.settings.trialCount || 24); els.customTrialCount.focus(); }
}

function readSettings() {
  const infinite = els.trialCount.value === "infinite";
  let trialCount = state.settings.trialCount || 24;
  if (!infinite) {
    trialCount = els.trialCount.value === "custom" ? Number(els.customTrialCount.value) : Number(els.trialCount.value);
    if (!Number.isInteger(trialCount) || trialCount < 1) throw new Error("Enter a whole number of trials greater than zero.");
  }
  return { nBack: Number(els.nBack.value), trialCount, infinite, spoken: els.spoken.checked, speechRate: Number(els.speechRate.value), trialDelayMs: Number(els.trialDelay.value) };
}

function startSession() {
  try { state.settings = readSettings(); } catch (error) { window.alert(error.message); return; }
  save(SETTINGS_KEY, state.settings);
  clearAllTiming();
  state.trials = []; state.results = []; state.index = 0; state.active = true; state.advancing = false;
  ensureTrial(0); showView("game"); renderTrial();
}

function ensureTrial(index) { while (state.trials.length <= index) state.trials.push(makeTrial(state.trials.length)); }
function makeTrial(index) {
  const nBack = state.settings.nBack, canMatch = index >= nBack, targetMatch = canMatch && Math.random() < 0.34;
  let rule;
  if (targetMatch) rule = RULES.find((candidate) => candidate.id === state.trials[index - nBack].ruleId);
  else {
    const forbidden = canMatch ? state.trials[index - nBack].ruleId : state.trials.at(-1)?.ruleId;
    const choices = RULES.filter((candidate) => candidate.id !== forbidden);
    rule = choices[Math.floor(Math.random() * choices.length)];
  }
  const start = chooseStart(rule);
  return { ruleId: rule.id, numbers: rule.make(start), match: canMatch ? rule.id === state.trials[index - nBack].ruleId : null };
}
function chooseStart(rule) {
  if (rule.starts) return rule.starts[Math.floor(Math.random() * rule.starts.length)];
  if (rule.id.startsWith("subtract")) return 12 + Math.floor(Math.random() * 19);
  if (rule.id.startsWith("times3")) return 1 + Math.floor(Math.random() * 3);
  if (rule.id.startsWith("times2")) return 2 + Math.floor(Math.random() * 6);
  return 1 + Math.floor(Math.random() * 18);
}

function renderTrial() {
  clearAllTiming();
  const token = ++state.presentationToken;
  const trial = state.trials[state.index];
  state.selectedMatch = null; state.submitted = false; state.advancing = false; state.speechInProgress = false;

  els.trialLabel.textContent = state.settings.infinite ? `Trial ${state.index + 1} · Infinite` : `Trial ${state.index + 1} / ${state.settings.trialCount}`;
  els.progressBar.style.width = state.settings.infinite ? "100%" : `${((state.index + 1) / state.settings.trialCount) * 100}%`;
  els.nBadge.textContent = `${state.settings.nBack}-back`; els.scoreBadge.textContent = liveScore();
  els.series.replaceChildren(...trial.numbers.flatMap((number, index) => { const span = document.createElement("span"); span.textContent = String(number); return index === 0 ? [span] : [document.createTextNode(","), span]; }));

  els.memoryQuestion.textContent = `Does this rule match the rule from ${state.settings.nBack} trial${state.settings.nBack === 1 ? "" : "s"} ago?`;
  const warmup = trial.match === null;
  for (const button of els.memoryCard.querySelectorAll("button[data-match]")) { button.disabled = true; button.className = ""; button.setAttribute("aria-pressed", "false"); }
  els.warmupNote.textContent = state.settings.spoken
    ? "Listen to the complete premise. The response interval begins after the final number is spoken."
    : warmup
      ? `Memory warm-up: infer and retain this rule. Comparison begins on trial ${state.settings.nBack + 1}.`
      : "Respond only whether the inferred rule matches n trials back.";
  els.feedback.hidden = true; els.feedback.replaceChildren(); els.submit.hidden = warmup; els.submit.disabled = true;
  els.next.hidden = !warmup; els.next.disabled = state.settings.spoken;
  els.next.textContent = state.settings.infinite ? "Next trial" : state.index === state.settings.trialCount - 1 ? "Finish session" : "Next trial";

  presentPremise(trial.numbers, token, () => beginResponseInterval(token));
}

function beginResponseInterval(token) {
  if (!state.active || token !== state.presentationToken || state.advancing) return;
  state.speechInProgress = false;
  state.trialStartedAt = performance.now();
  const trial = state.trials[state.index];
  const warmup = trial.match === null;
  for (const button of els.memoryCard.querySelectorAll("button[data-match]")) button.disabled = warmup;
  els.next.disabled = false;
  els.warmupNote.textContent = warmup
    ? `Memory warm-up: infer and retain this rule. Comparison begins on trial ${state.settings.nBack + 1}.`
    : "Respond only whether the inferred rule matches n trials back.";
  scheduleTrialExpiry(token);
}

function scheduleTrialExpiry(token) {
  const duration = state.settings.trialDelayMs;
  if (!state.active || duration <= 0 || token !== state.presentationToken) return;
  state.trialTimer = window.setTimeout(() => {
    state.trialTimer = 0;
    if (token === state.presentationToken) handleTrialExpiry();
  }, duration);
}

function handleTrialExpiry() {
  if (!state.active || state.advancing || state.speechInProgress) return;
  const trial = state.trials[state.index];
  if (trial.match !== null && !state.submitted) state.results.push({ correct: false, omitted: true, responseTimeMs: performance.now() - state.trialStartedAt });
  advanceTrial();
}

function submitResponse() {
  if (state.submitted || els.submit.disabled || state.advancing || state.speechInProgress) return;
  state.submitted = true;
  const trial = state.trials[state.index], correct = state.selectedMatch === trial.match;
  state.results.push({ correct, omitted: false, responseTimeMs: performance.now() - state.trialStartedAt });
  for (const button of els.memoryCard.querySelectorAll("button[data-match]")) {
    const value = button.dataset.match === "true"; button.disabled = true; button.classList.remove("selected");
    if (value === trial.match) button.classList.add("correct"); else if (value === state.selectedMatch) button.classList.add("wrong");
  }
  els.feedback.hidden = false;
  els.feedback.innerHTML = `<strong>${correct ? "Correct pattern comparison." : "Incorrect pattern comparison."}</strong><span>The current hidden rule was ${trial.match ? "the same as" : "different from"} the rule ${state.settings.nBack} trial${state.settings.nBack === 1 ? "" : "s"} ago.</span>`;
  els.scoreBadge.textContent = liveScore(); els.submit.hidden = true; els.next.hidden = false;
}

function advanceFromUser() { if (!state.active || state.advancing || state.speechInProgress) return; advanceTrial(); }
function advanceTrial() {
  if (!state.active || state.advancing) return;
  state.advancing = true; clearAllTiming(); cancelSpeech(); els.next.disabled = true;
  if (!state.settings.infinite && state.index >= state.settings.trialCount - 1) { finishSession(); return; }
  state.index += 1; ensureTrial(state.index); renderTrial();
}

function endSession() {
  if (!state.active) return;
  const confirmed = window.confirm(state.settings.infinite ? "End the infinite session and save completed scored comparisons?" : "End this session now and save completed scored comparisons?");
  if (!confirmed) return;
  clearAllTiming(); cancelSpeech();
  if (state.results.length > 0) finishSession(); else { state.active = false; showView("play"); }
}

function finishSession() {
  clearAllTiming(); cancelSpeech(); state.active = false;
  const accuracy = percentage(state.results.map((result) => result.correct));
  const scoredComparisons = state.results.length, omissions = state.results.filter((result) => result.omitted).length;
  const presentedTrials = Math.min(state.index + 1, state.trials.length);
  const record = { date: new Date().toISOString(), nBack: state.settings.nBack, trials: presentedTrials, scoredComparisons, omissions, infinite: state.settings.infinite, accuracy, spoken: state.settings.spoken, speechRate: state.settings.speechRate, trialDelayMs: state.settings.trialDelayMs };
  state.history.unshift(record); state.history = state.history.slice(0, 100); save(HISTORY_KEY, state.history);
  els.totalScore.textContent = `${accuracy}%`;
  els.summaryHeading.textContent = accuracy >= 85 ? "Pattern memory held" : accuracy >= 70 ? "Pattern memory is forming" : "Pattern discrimination needs reinforcement";
  els.summaryGrid.innerHTML = `<article><span>Pattern n-back</span><strong>${accuracy}%</strong></article><article><span>Scored comparisons</span><strong>${scoredComparisons}</strong></article><article><span>Omissions</span><strong>${omissions}</strong></article>`;
  els.summaryNote.textContent = `Presented ${presentedTrials} trial${presentedTrials === 1 ? "" : "s"} at ${state.settings.nBack}-back${state.settings.infinite ? " in infinite mode" : ""}. The response timer began only after auditory presentation completed.`;
  showView("summary");
}

function clearTrialTimer() { if (state.trialTimer) { window.clearTimeout(state.trialTimer); state.trialTimer = 0; } }
function clearSpeechFallback() { if (state.speechFallbackTimer) { window.clearTimeout(state.speechFallbackTimer); state.speechFallbackTimer = 0; } }
function clearAllTiming() { clearTrialTimer(); clearSpeechFallback(); }
function percentage(values) { return values.length ? Math.round((values.filter(Boolean).length / values.length) * 100) : 0; }
function liveScore() { return state.results.length === 0 ? "Score —" : `Score ${percentage(state.results.map((result) => result.correct))}%`; }
function renderHistory() {
  els.historyList.innerHTML = state.history.length
    ? state.history.map((record) => `<article class="history-card"><header><div><b>${new Date(record.date).toLocaleString()}</b><p>${record.nBack}-back · ${record.trials} presented trials${record.infinite ? " · infinite mode" : ""}${record.spoken ? " · auditory" : ""}</p></div><strong>${record.accuracy}%</strong></header><p>Pattern n-back ${record.accuracy}% · ${record.scoredComparisons} scored comparisons · ${record.omissions || 0} omissions</p></article>`).join("")
    : `<article class="history-card"><strong>No completed sessions yet.</strong><p>Finish a session to establish the first pattern-memory baseline.</p></article>`;
}

function primeSpeech() {
  if (!els.spoken.checked || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  try { speechSynthesis.cancel(); speechSynthesis.resume(); const utterance = new SpeechSynthesisUtterance(" "); utterance.volume = 0; speechSynthesis.speak(utterance); } catch {}
}

function presentPremise(numbers, token, onComplete) {
  clearSpeechFallback();
  cancelSpeech();
  if (!state.settings.spoken || !window.speechSynthesis || !window.SpeechSynthesisUtterance) { onComplete(); return; }
  state.speechInProgress = true;
  const utterance = new SpeechSynthesisUtterance(numbers.join(", "));
  utterance.lang = "en-AU"; utterance.rate = state.settings.speechRate; utterance.volume = 1; utterance.pitch = 1;
  let completed = false;
  const completeOnce = () => {
    if (completed || token !== state.presentationToken) return;
    completed = true; clearSpeechFallback(); onComplete();
  };
  utterance.onend = completeOnce;
  utterance.onerror = completeOnce;
  const estimatedMs = Math.max(2500, (numbers.join(", ").length * 95) / Math.max(0.5, state.settings.speechRate));
  state.speechFallbackTimer = window.setTimeout(completeOnce, estimatedMs + 2000);
  try { speechSynthesis.speak(utterance); } catch { completeOnce(); }
}

function cancelSpeech() { try { window.speechSynthesis?.cancel(); } catch {} state.speechInProgress = false; }
window.addEventListener("beforeunload", () => { clearAllTiming(); cancelSpeech(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { clearAllTiming(); cancelSpeech(); }
  else if (state.active && !state.advancing) renderTrial();
});
