const STORAGE_KEYS = Object.freeze({ settings: "numberPattern.settings.v1", history: "numberPattern.history.v1" });
const DEFAULTS = Object.freeze({ nBack: 2, trialCount: 24, spoken: false, speechRate: 0.85, trialDelayMs: 0 });
const RULES = Object.freeze([
  { id: "add2", label: "add 2", make: (start) => [start, start + 2, start + 4, start + 6] },
  { id: "add3", label: "add 3", make: (start) => [start, start + 3, start + 6, start + 9] },
  { id: "add5", label: "add 5", make: (start) => [start, start + 5, start + 10, start + 15] },
  { id: "subtract2", label: "subtract 2", make: (start) => [start, start - 2, start - 4, start - 6] },
  { id: "subtract3", label: "subtract 3", make: (start) => [start, start - 3, start - 6, start - 9] },
  { id: "times2", label: "multiply by 2", make: (start) => [start, start * 2, start * 4, start * 8] },
  { id: "times3", label: "multiply by 3", make: (start) => [start, start * 3, start * 9, start * 27] },
  { id: "divide2", label: "divide by 2", starts: [16, 24, 32, 40, 48, 64], make: (start) => [start, start / 2, start / 4, start / 8] },
]);

const state = { settings: load(STORAGE_KEYS.settings, DEFAULTS), history: load(STORAGE_KEYS.history, []), session: [], index: 0, selectedAnswer: null, selectedMatch: null, results: [], locked: false, trialStartedAt: 0, delayTimer: 0 };
const views = ["home", "play", "game", "summary", "progress"];
const $ = (selector) => document.querySelector(selector);
const els = {
  homeButton: $("#home-button"), begin: $("#begin-button"), start: $("#start-game"), nBack: $("#n-back"), trialCount: $("#trial-count"), spoken: $("#spoken-premises"), speechRate: $("#speech-rate"), trialDelay: $("#trial-delay"),
  trialLabel: $("#trial-label"), progressBar: $("#progress-bar"), nBadge: $("#n-badge"), scoreBadge: $("#score-badge"), series: $("#series"), answerOptions: $("#answer-options"), memoryCard: $("#memory-card"), memoryQuestion: $("#memory-question"), warmupNote: $("#warmup-note"), feedback: $("#feedback"), submit: $("#submit-answer"), next: $("#next-trial"), end: $("#end-game"), summaryHeading: $("#summary-heading"), totalScore: $("#total-score"), summaryGrid: $("#summary-grid"), summaryNote: $("#summary-note"), trainAgain: $("#train-again"), historyList: $("#history-list"),
};

initialize();

function initialize() {
  els.nBack.value = String(state.settings.nBack); els.trialCount.value = String(state.settings.trialCount); els.spoken.checked = Boolean(state.settings.spoken); els.speechRate.value = String(state.settings.speechRate); els.trialDelay.value = String(state.settings.trialDelayMs);
  document.addEventListener("click", handleClick); els.homeButton.addEventListener("click", () => show("home")); els.begin.addEventListener("click", () => show("play")); els.start.addEventListener("pointerdown", primeSpeech); els.start.addEventListener("click", startSession); els.submit.addEventListener("click", submitTrial); els.next.addEventListener("click", requestNextTrial); els.end.addEventListener("click", endEarly); els.trainAgain.addEventListener("click", () => show("play"));
  show("home");
}

function load(key, fallback) { try { const parsed = JSON.parse(localStorage.getItem(key) || "null"); return parsed == null ? structuredFallback(fallback) : parsed; } catch { return structuredFallback(fallback); } }
function structuredFallback(value) { return Array.isArray(value) ? [] : { ...value }; }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function show(name) { views.forEach((view) => { $(`#${view}-view`).hidden = view !== name; }); document.querySelectorAll("nav button[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === name)); if (name === "progress") renderHistory(); window.scrollTo({ top: 0, behavior: "auto" }); cancelSpeech(); }

function handleClick(event) {
  const nav = event.target.closest("[data-view]"); if (nav) { show(nav.dataset.view); return; }
  const answer = event.target.closest("button[data-answer]"); if (answer && !state.locked) { state.selectedAnswer = Number(answer.dataset.answer); selectOnly(els.answerOptions, answer); updateSubmit(); return; }
  const match = event.target.closest("button[data-match]"); if (match && !state.locked) { state.selectedMatch = match.dataset.match === "true"; selectOnly(els.memoryCard.querySelector(".match-options"), match); updateSubmit(); }
}

function selectOnly(container, selected) { container.querySelectorAll("button").forEach((button) => button.classList.toggle("selected", button === selected)); }
function settingsFromUi() { return { nBack: Number(els.nBack.value), trialCount: Number(els.trialCount.value), spoken: els.spoken.checked, speechRate: Number(els.speechRate.value), trialDelayMs: Number(els.trialDelay.value) }; }

function startSession() {
  state.settings = settingsFromUi(); save(STORAGE_KEYS.settings, state.settings); state.session = generateSession(state.settings.trialCount, state.settings.nBack); state.index = 0; state.results = []; state.locked = false; show("game"); renderTrial();
}

function generateSession(count, nBack) {
  const trials = []; let priorRule = null;
  for (let index = 0; index < count; index += 1) {
    let rule;
    const canMatch = index >= nBack;
    const forceMatch = canMatch && Math.random() < 0.34;
    if (forceMatch) rule = RULES.find((candidate) => candidate.id === trials[index - nBack].ruleId);
    else {
      const forbidden = canMatch ? trials[index - nBack].ruleId : priorRule;
      const choices = RULES.filter((candidate) => candidate.id !== forbidden);
      rule = choices[Math.floor(Math.random() * choices.length)];
    }
    const start = chooseStart(rule); const numbers = rule.make(start); const correct = numbers[3];
    trials.push({ ruleId: rule.id, ruleLabel: rule.label, numbers, correct, options: makeOptions(correct, numbers), match: canMatch ? rule.id === trials[index - nBack].ruleId : null }); priorRule = rule.id;
  }
  return trials;
}

function chooseStart(rule) {
  if (rule.starts) return rule.starts[Math.floor(Math.random() * rule.starts.length)];
  if (rule.id.startsWith("subtract")) return 12 + Math.floor(Math.random() * 19);
  if (rule.id.startsWith("times3")) return 1 + Math.floor(Math.random() * 3);
  if (rule.id.startsWith("times2")) return 2 + Math.floor(Math.random() * 6);
  return 1 + Math.floor(Math.random() * 18);
}

function makeOptions(correct, numbers) {
  const values = new Set([correct]); const step = Math.max(1, Math.abs(numbers[2] - numbers[1]));
  const candidates = [correct + step, correct - step, correct + 2, correct - 2, correct + 3, correct - 3, numbers[2], numbers[2] + 1].filter(Number.isFinite);
  for (const value of candidates) { if (value >= 0) values.add(value); if (values.size === 4) break; }
  while (values.size < 4) values.add(correct + values.size * 4 + 1);
  return [...values].sort(() => Math.random() - 0.5);
}

function renderTrial() {
  const trial = state.session[state.index]; state.selectedAnswer = null; state.selectedMatch = null; state.locked = false; state.trialStartedAt = performance.now();
  els.trialLabel.textContent = `Trial ${state.index + 1} / ${state.session.length}`; els.progressBar.style.width = `${((state.index + 1) / state.session.length) * 100}%`; els.nBadge.textContent = `${state.settings.nBack}-back`; els.scoreBadge.textContent = liveScore();
  els.series.replaceChildren(...trial.numbers.slice(0, 3).flatMap((number, index) => { const span = document.createElement("span"); span.textContent = String(number); return index ? [document.createTextNode(","), span] : [span]; }), document.createTextNode(","), Object.assign(document.createElement("span"), { textContent: "?", className: "missing" }));
  els.answerOptions.replaceChildren(...trial.options.map((number) => { const button = document.createElement("button"); button.type = "button"; button.dataset.answer = String(number); button.textContent = String(number); return button; }));
  els.memoryQuestion.textContent = `Does this rule match the rule from ${state.settings.nBack} trial${state.settings.nBack === 1 ? "" : "s"} ago?`;
  const warmup = trial.match === null; els.memoryCard.querySelectorAll("button[data-match]").forEach((button) => { button.disabled = warmup; button.className = ""; }); els.warmupNote.textContent = warmup ? `Memory warm-up: comparison begins on trial ${state.settings.nBack + 1}.` : "Compare the abstract generating rule, not the values.";
  els.feedback.hidden = true; els.feedback.replaceChildren(); els.submit.hidden = false; els.submit.disabled = true; els.next.hidden = true; speakTrial(trial.numbers);
}

function updateSubmit() { const needsMatch = state.session[state.index].match !== null; els.submit.disabled = state.selectedAnswer === null || (needsMatch && state.selectedMatch === null); }
function submitTrial() {
  if (els.submit.disabled || state.locked) return; state.locked = true; cancelSpeech(); const trial = state.session[state.index]; const solutionCorrect = state.selectedAnswer === trial.correct; const matchCorrect = trial.match === null ? null : state.selectedMatch === trial.match;
  state.results.push({ solutionCorrect, matchCorrect, responseTimeMs: performance.now() - state.trialStartedAt }); markResults(trial); els.feedback.hidden = false; els.feedback.innerHTML = `<strong>${solutionCorrect && matchCorrect !== false ? "Correct relational reading." : "Review the generating rule."}</strong><span>The series follows <b>${trial.ruleLabel}</b>, so the missing number is <b>${trial.correct}</b>${trial.match === null ? "." : `; the n-back pattern response was <b>${trial.match ? "match" : "different"}</b>.`}</span>`; els.scoreBadge.textContent = liveScore(); els.submit.hidden = true; els.next.hidden = false; els.next.textContent = state.index === state.session.length - 1 ? "Finish session" : "Next trial";
}

function markResults(trial) {
  els.answerOptions.querySelectorAll("button").forEach((button) => { button.disabled = true; const value = Number(button.dataset.answer); button.classList.remove("selected"); if (value === trial.correct) button.classList.add("correct"); else if (value === state.selectedAnswer) button.classList.add("wrong"); });
  els.memoryCard.querySelectorAll("button[data-match]").forEach((button) => { button.disabled = true; if (trial.match === null) return; const value = button.dataset.match === "true"; button.classList.remove("selected"); if (value === trial.match) button.classList.add("correct"); else if (value === state.selectedMatch) button.classList.add("wrong"); });
}

function requestNextTrial() {
  const delay = state.settings.trialDelayMs; els.next.disabled = true;
  if (!delay) { advance(); return; }
  state.delayTimer = window.setTimeout(advance, delay);
}
function advance() { state.delayTimer = 0; els.next.disabled = false; if (state.index >= state.session.length - 1) finishSession(); else { state.index += 1; renderTrial(); } }
function endEarly() { if (!window.confirm("End this session without saving it?")) return; window.clearTimeout(state.delayTimer); show("play"); }

function finishSession() {
  cancelSpeech(); const solution = percentage(state.results.map((result) => result.solutionCorrect)); const match = percentage(state.results.filter((result) => result.matchCorrect !== null).map((result) => result.matchCorrect)); const total = Math.round((solution + match) / 2); const record = { date: new Date().toISOString(), nBack: state.settings.nBack, trials: state.session.length, solution, match, total, spoken: state.settings.spoken, speechRate: state.settings.speechRate, trialDelayMs: state.settings.trialDelayMs }; state.history.unshift(record); state.history = state.history.slice(0, 100); save(STORAGE_KEYS.history, state.history);
  els.totalScore.textContent = `${total}%`; els.summaryHeading.textContent = total >= 85 ? "Pattern memory held" : total >= 70 ? "Proof of principle established" : "Rule discrimination needs reinforcement"; els.summaryGrid.innerHTML = `<article><span>Series solutions</span><strong>${solution}%</strong></article><article><span>Pattern n-back</span><strong>${match}%</strong></article>`; els.summaryNote.textContent = `Completed ${state.session.length} trials at ${state.settings.nBack}-back${state.settings.spoken ? " with auditory premises" : ""}.`; show("summary");
}

function percentage(values) { return values.length ? Math.round((values.filter(Boolean).length / values.length) * 100) : 0; }
function liveScore() { if (!state.results.length) return "Score —"; const values = state.results.flatMap((result) => [result.solutionCorrect, result.matchCorrect].filter((value) => value !== null)); return `Score ${percentage(values)}%`; }
function renderHistory() { if (!state.history.length) { els.historyList.innerHTML = `<article class="history-card"><strong>No completed sessions yet.</strong><p>Finish a session to establish the first baseline.</p></article>`; return; } els.historyList.innerHTML = state.history.map((record) => `<article class="history-card"><header><div><b>${new Date(record.date).toLocaleString()}</b><p>${record.nBack}-back · ${record.trials} trials${record.spoken ? " · auditory" : ""}</p></div><strong>${record.total}%</strong></header><p>Solutions ${record.solution}% · Pattern memory ${record.match}%</p></article>`).join(""); }

function primeSpeech() { if (!els.spoken.checked || !speechSynthesis || !window.SpeechSynthesisUtterance) return; try { speechSynthesis.cancel(); speechSynthesis.resume(); const primer = new SpeechSynthesisUtterance(" "); primer.volume = 0; speechSynthesis.speak(primer); } catch {} }
function speakTrial(numbers) { cancelSpeech(); if (!state.settings.spoken || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return; const text = `${numbers[0]}, ${numbers[1]}, ${numbers[2]}, what is the fourth number?`; const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "en-AU"; utterance.rate = state.settings.speechRate; utterance.volume = 1; utterance.pitch = 1; try { speechSynthesis.speak(utterance); } catch {} }
function cancelSpeech() { if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch {} } }
window.addEventListener("beforeunload", cancelSpeech); document.addEventListener("visibilitychange", () => { if (document.hidden) cancelSpeech(); });
