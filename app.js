const QUIZ_LENGTH = 10;
const ANSWER_REVEAL_DELAY_MS = 260;
const CARD_ADVANCE_DELAY_MS = 820;

const MODES = {
  woman_trans: {
    question: "Who is this?",
    reel: ["♀", "⚧", "♂"],
    choices: [
      { id: "woman", label: "Woman", symbol: "♀" },
      { id: "trans", label: "Trans", symbol: "⚧" },
    ],
    categories: ["woman", "trans-woman"],
    modeLabel: "Woman / Trans",
    modeIcon: "♀/⚧",
  },
  man_trans: {
    question: "Who is this?",
    reel: ["♂", "⚧", "♀"],
    choices: [
      { id: "man", label: "Man", symbol: "♂" },
      { id: "trans", label: "Trans", symbol: "⚧" },
    ],
    categories: ["man", "trans-man"],
    modeLabel: "Man / Trans",
    modeIcon: "♂/⚧",
  },
};

const LEVELS = [
  "Clueless", "Guessing blind", "Coin flipper", "Below average", "Almost there",
  "Average Joe", "Getting good", "Sharp eye", "Nearly expert", "Eagle eye", "Expert spotter",
];

const DEMO_LEADERBOARD = [
  { name: "monkey", score: 50, avatar: "🐵", avatarClass: "avatar-monkey", featured: true },
  { name: "pipo", score: 90, avatar: "P", avatarClass: "avatar-yellow" },
  { name: "fish54", score: 70, avatar: "F", avatarClass: "avatar-blue" },
  { name: "anna", score: 20, avatar: "A", avatarClass: "avatar-red" },
];

const state = {
  mode: "woman_trans",
  cards: [],
  quizLength: QUIZ_LENGTH,
  index: 0,
  answers: [],
  locked: false,
  sound: false,
  reviewIndex: 0,
  attemptStartedAt: 0,
};

const el = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];

function readLocalValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalValue(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readLocalJSON(key, fallback) {
  try {
    const value = readLocalValue(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeLocalJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readAttempts() {
  const attempts = readLocalJSON("spot-check:attempts", []);
  return Array.isArray(attempts) ? attempts : [];
}

function dateKey(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calculateStreak(attempts) {
  const days = [...new Set(attempts.map((attempt) => dateKey(attempt.createdAt)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
  if (days.length === 0) return 0;

  const toLocalMidnight = (key) => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const dayGap = (newer, older) => Math.round((toLocalMidnight(newer) - toLocalMidnight(older)) / 86400000);
  const today = dateKey(new Date());
  if (dayGap(today, days[0]) > 1) return 0;

  let streak = 1;
  for (let index = 1; index < days.length; index += 1) {
    if (dayGap(days[index - 1], days[index]) !== 1) break;
    streak += 1;
  }
  return streak;
}

const localData = {
  async loadCards() {
    const response = await fetch("assets/manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Image manifest could not be loaded.");
    return response.json();
  },
  async recordAttempt(attempt) {
    const key = "spot-check:attempts";
    const attempts = readAttempts();
    attempts.push(attempt);
    writeLocalJSON(key, attempts.slice(-100));
  },
  async getLeaderboard(mode) {
    const attempts = readAttempts().filter((attempt) => !mode || attempt.mode === mode);
    if (attempts.length === 0) return [];
    const byDevice = {};
    attempts.forEach((a) => {
      if (!byDevice[a.anonymousId] || a.score > byDevice[a.anonymousId].score) {
        byDevice[a.anonymousId] = a;
      }
    });
    return Object.values(byDevice)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((a, i) => ({ rank: i + 1, ...a }));
  },
  async getStats(mode) {
    const attempts = readAttempts()
      .filter((attempt) => attempt.mode === mode && Number.isFinite(Number(attempt.score)))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const scores = attempts.map((attempt) => Number(attempt.score));
    return {
      plays: scores.length,
      best: scores.length ? Math.max(...scores) : null,
      average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      streak: calculateStreak(attempts),
      lastScore: scores.at(-1) ?? null,
      previousScore: scores.at(-2) ?? null,
    };
  },
  async getShownImages(deviceHash, mode) {
    const key = `spot-check:shown:${mode}`;
    const data = readLocalJSON(key, {});
    return data && !Array.isArray(data) && Array.isArray(data[deviceHash]) ? data[deviceHash] : [];
  },
  async setShownImages(deviceHash, mode, shownIds) {
    const key = `spot-check:shown:${mode}`;
    const stored = readLocalJSON(key, {});
    const data = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    data[deviceHash] = shownIds.slice(-200);
    writeLocalJSON(key, data);
  },
};

window.SpotCheckData = window.SpotCheckData || localData;

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getCardFocus(card) {
  const clamp = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
  };
  return `${clamp(card.focus?.x, 50)}% ${clamp(card.focus?.y, 38)}%`;
}

function buildBalancedDeck(cards, mode, limit, shownIds = []) {
  const choiceIds = MODES[mode].choices.map((choice) => choice.id);
  const seen = new Set(shownIds);
  const queues = choiceIds.map((choiceId) => {
    const matchingCards = cards.filter((card) => card.labels[mode] === choiceId);
    const freshCards = shuffle(matchingCards.filter((card) => !seen.has(card.id)));
    const previousCards = shuffle(matchingCards.filter((card) => seen.has(card.id)));
    return [...freshCards, ...previousCards];
  });
  if (queues.some((queue) => queue.length === 0)) {
    throw new Error("This mode needs at least one portrait for each answer.");
  }

  const selected = [];
  while (selected.length < limit && queues.some((queue) => queue.length > 0)) {
    queues.forEach((queue) => {
      if (selected.length < limit && queue.length > 0) selected.push(queue.shift());
    });
  }
  return shuffle(selected);
}

function preloadCards(cards) {
  cards.forEach((card) => {
    const image = new Image();
    image.src = card.src;
  });
}

async function anonymousDeviceHash() {
  let id = readLocalValue("spot-check:device-id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    writeLocalValue("spot-check:device-id", id);
  }
  if (!crypto.subtle) return "local-only";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function showScreen(name) {
  all(".screen").forEach((screen) => {
    const isActive = screen.dataset.screen === name;
    screen.classList.toggle("is-active", isActive);
    screen.setAttribute("aria-hidden", String(!isActive));
  });
  const modeButton = el("[data-action='toggle-mode']");
  if (modeButton) modeButton.disabled = name !== "intro";
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "results") triggerResultsAnimations();
  if (name === "review") renderReview();
}

async function setMode(mode) {
  if (!MODES[mode]) return;
  state.mode = mode;
  writeLocalValue("spot-check:mode", mode);
  const config = MODES[mode];
  el("[data-action='toggle-mode'] .mode-icon").textContent = config.modeIcon;
  el("[data-action='toggle-mode'] .mode-text").textContent = config.modeLabel;
  el("[data-action='toggle-mode']").setAttribute("aria-pressed", mode === "man_trans");
  setupWordReel();
  if (el(".intro-screen").classList.contains("is-active")) {
    await initIntroImage();
    await updateIntroProgress();
  }
}

function renderChoices() {
  const config = MODES[state.mode];
  el("#question-text").textContent = config.question;
  el("#choice-row").innerHTML = config.choices.map((choice, index) => `
    <button class="choice-button" type="button" data-choice="${choice.id}" aria-label="Choose ${choice.label}">
      <span><span class="choice-symbol" aria-hidden="true">${choice.symbol}</span><small>${choice.label}</small></span>
    </button>`).join("");
  el("#stamp-left").textContent = config.choices[0].label.toUpperCase();
  el("#stamp-right").textContent = config.choices[1].label.toUpperCase();
  all("[data-choice]").forEach((button, index) => button.addEventListener("click", () => choose(button.dataset.choice, index ? 1 : -1)));
}

function getCardsForMode(cards, mode) {
  const config = MODES[mode];
  if (!config) return [];
  const allowedCategories = new Set(config.categories);
  const allowedAnswers = new Set(config.choices.map((choice) => choice.id));
  return cards.filter((card) =>
    allowedCategories.has(card.category) && allowedAnswers.has(card.labels?.[mode])
  );
}

async function startQuiz() {
  const launchButtons = all("[data-action='start'], [data-action='again']");
  launchButtons.forEach((button) => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
  try {
    const allCards = await window.SpotCheckData.loadCards();
    const modeCards = getCardsForMode(allCards, state.mode);
    if (modeCards.length < 2) throw new Error("This mode needs at least two valid portrait entries.");

    const deviceHash = await anonymousDeviceHash();
    let shownIds = [];
    try {
      shownIds = await window.SpotCheckData.getShownImages(deviceHash, state.mode);
    } catch {
      shownIds = [];
    }
    const targetLength = Math.min(QUIZ_LENGTH, modeCards.length);
    state.cards = buildBalancedDeck(modeCards, state.mode, targetLength, shownIds);
    state.quizLength = state.cards.length;
    preloadCards(state.cards.slice(0, 3));

    const newShownIds = [...new Set([...shownIds, ...state.cards.map((card) => card.id)])];
    try {
      await window.SpotCheckData.setShownImages(deviceHash, state.mode, newShownIds);
    } catch {
      // Portrait rotation is optional; a round can still run without local storage.
    }

    state.index = 0;
    state.answers = [];
    state.locked = false;
    state.attemptStartedAt = Date.now();
    renderChoices();
    renderCard();
    showScreen("quiz");
  } catch (error) {
    showToast(error.message || "The quiz could not start.");
  } finally {
    launchButtons.forEach((button) => { button.disabled = false; button.removeAttribute("aria-busy"); });
  }
}

function renderCard() {
  const card = state.cards[state.index];
  if (!card) return;
  const active = el("#active-card");
  const behind = el(".card-behind");
  active.className = "swipe-card card-active";
  active.style.cssText = "";
  el("#card-image").src = card.src;
  el("#card-image").alt = "Portrait photo";
  el("#card-image").style.objectPosition = getCardFocus(card);
  el("#card-caption").textContent = card.title || `Portrait ${state.index + 1}`;
  el("#card-number").textContent = state.index + 1;
  el("#card-total").textContent = state.quizLength;
  el("#progress-bar").style.width = `${((state.index + 1) / state.quizLength) * 100}%`;
  el(".progress-track").setAttribute("aria-label", `Quiz progress: card ${state.index + 1} of ${state.quizLength}`);
  el("#stamp-left").style.opacity = 0;
  el("#stamp-right").style.opacity = 0;
  el("[data-action='undo']").disabled = state.index === 0;
  active.classList.remove("correct", "incorrect");

  if (state.index < state.cards.length - 1) {
    const nextCard = state.cards[state.index + 1];
    behind.style.backgroundImage = `url(${nextCard.src})`;
    behind.style.backgroundSize = "cover";
    behind.style.backgroundPosition = getCardFocus(nextCard);
  } else {
    behind.style.backgroundImage = "";
  }
}

function choose(choice, direction) {
  if (state.locked) return;
  state.locked = true;
  const card = state.cards[state.index];
  const correct = card.labels[state.mode] === choice;
  state.answers.push({ imageId: card.id, choice, correct, card });
  const correctLabel = MODES[state.mode].choices.find((item) => item.id === card.labels[state.mode])?.label;
  el("#answer-feedback").textContent = correct ? "Correct." : `Incorrect. The labelled answer was ${correctLabel}.`;
  blip(correct);
  haptic(correct ? "success" : "error");

  const active = el("#active-card");
  active.classList.add(correct ? "correct" : "incorrect");
  el("#stamp-left").style.opacity = direction < 0 ? 1 : 0;
  el("#stamp-right").style.opacity = direction > 0 ? 1 : 0;

  window.setTimeout(() => {
    active.classList.add("is-leaving");
    active.style.transform = `translateX(${direction * 145}%) rotate(${direction * 19}deg)`;
    active.style.opacity = "0";
  }, ANSWER_REVEAL_DELAY_MS);

  window.setTimeout(() => {
    state.index += 1;
    if (state.index >= state.quizLength) finishQuiz();
    else { renderCard(); state.locked = false; }
  }, CARD_ADVANCE_DELAY_MS);
}

function undoLastChoice() {
  if (state.locked || state.index === 0 || state.answers.length === 0) return;
  state.index -= 1;
  state.answers.pop();
  renderCard();
  el("#answer-feedback").textContent = `Answer ${state.index + 1} restored.`;
  haptic("tap");
}

async function finishQuiz() {
  const correctCount = state.answers.filter((answer) => answer.correct).length;
  const score = Math.round((correctCount / state.quizLength) * 100);
  const levelIndex = Math.min(10, Math.floor(score / 10));
  const scoreValue = el("#score-value");
  scoreValue.textContent = `${score}%`;
  scoreValue.className = score < 50 ? "score-low" : "score-high";
  el("#score-message").textContent = score >= 90 ? "Uncanny accuracy!" : score >= 70 ? "Sharp perception!" : score >= 50 ? "Better than chance." : "Room to improve.";
  el("#score-detail").textContent = `${correctCount} of ${state.quizLength} correct.`;
  el("#pin-score").textContent = `${score}%`;
  el("#level-name").textContent = LEVELS[levelIndex];
  el("#rank-low").textContent = LEVELS[0];
  el("#rank-high").textContent = LEVELS[10];
  showScreen("results");
  requestAnimationFrame(() => { el("#meter-pin").style.setProperty("--pin", `${score}%`); });

  if (score >= 70) launchConfetti(score);

  try {
    const deviceHash = await anonymousDeviceHash();
    await window.SpotCheckData.recordAttempt({
      anonymousId: deviceHash,
      mode: state.mode,
      score,
      answers: state.answers.map(a => ({ imageId: a.imageId, choice: a.choice, correct: a.correct })),
      createdAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - state.attemptStartedAt),
      schemaVersion: 2,
    });
  } catch {
    showToast("Score shown, but local saving was unavailable.");
  }

  await Promise.all([renderLeaderboard(), refreshStats(score)]);
}

async function renderLeaderboard() {
  let leaderboard = [];
  try {
    leaderboard = await window.SpotCheckData.getLeaderboard(state.mode);
  } catch {
    showToast("The local leaderboard is unavailable.");
  }
  const list = el("#leaderboard-list");
  const realEntries = leaderboard.map((entry, i) => {
    const initial = "Y";
    const avatarClass = i === 0 ? "avatar-yellow" : i === 1 ? "avatar-blue" : i === 2 ? "avatar-red" : "";
    return `<li class="leaderboard-entry"><span class="avatar ${avatarClass}">${initial}</span><b>You</b><span class="bar"><i style="--score: ${entry.score}%"></i></span><strong>${entry.score}%</strong></li>`;
  }).join("");

  const renderDemoEntry = (entry) => {
    const featuredClass = entry.featured ? " featured-monkey" : "";
    const avatar = entry.featured
      ? `<span class="monkey-face" aria-hidden="true">${entry.avatar}</span>`
      : entry.avatar;
    const detail = entry.featured ? "featured demo" : "demo";
    return `<li class="leaderboard-entry demo${featuredClass}"><span class="avatar ${entry.avatarClass}">${avatar}</span><b>${entry.name}<small>${detail}</small></b><span class="bar"><i style="--score: ${entry.score}%"></i></span><strong>${entry.score}%</strong></li>`;
  };
  const featuredEntries = DEMO_LEADERBOARD.filter((entry) => entry.featured).map(renderDemoEntry).join("");
  const otherDemoEntries = DEMO_LEADERBOARD.filter((entry) => !entry.featured).map(renderDemoEntry).join("");

  list.innerHTML = featuredEntries + realEntries + otherDemoEntries;
  animateLeaderboardEntries();
}

function animateLeaderboardEntries() {
  const entries = all("#leaderboard-list .leaderboard-entry");
  entries.forEach((entry, i) => {
    const finalOpacity = entry.classList.contains("demo") && !entry.classList.contains("featured-monkey") ? "0.7" : "1";
    entry.style.opacity = "0";
    entry.style.transform = "translateY(20px)";
    entry.style.transition = "opacity 0.4s ease, transform 0.4s ease";
    window.setTimeout(() => {
      entry.style.opacity = finalOpacity;
      entry.style.transform = "translateY(0)";
    }, 200 + i * 80);
  });
}

function triggerResultsAnimations() {
  const elements = [
    ".results-heading",
    ".rank-card",
    ".personal-stats",
    ".leaderboard",
    ".result-actions"
  ];
  elements.forEach((selector, i) => {
    const el = document.querySelector(selector);
    if (el) {
      el.style.opacity = "0";
      el.style.transform = "translateY(20px)";
      el.style.transition = "opacity 0.5s ease, transform 0.5s ease";
      window.setTimeout(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      }, 100 + i * 120);
    }
  });

  const scoreEl = el("#score-value");
  if (scoreEl) {
    scoreEl.style.transform = "scale(0.5)";
    scoreEl.style.transition = "transform 0.6s cubic-bezier(.16,.85,.25,1)";
    window.setTimeout(() => { scoreEl.style.transform = "scale(1)"; }, 300);
  }
}

function launchConfetti(score) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#d6ff51", "#ff6685", "#62a9ff", "#ff9f1c", "#4ade80", "#fff"];
  const pieceCount = Math.min(80, 30 + score);
  const container = document.createElement("div");
  container.className = "confetti-container";
  container.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;overflow:hidden;";
  document.body.appendChild(container);

  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("div");
    const size = Math.random() * 8 + 6;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;
    const duration = Math.random() * 2 + 2;
    const delay = Math.random() * 0.5;
    const rotation = Math.random() * 360;
    const sway = (Math.random() - 0.5) * 200;

    piece.style.cssText = `
      position:absolute;top:-20px;left:${left}vw;width:${size}px;height:${size}px;
      background:${color};border-radius:${Math.random() > 0.5 ? "50%" : "4px"};
      opacity:0;animation:confettiFall ${duration}s ease-in ${delay}s forwards;
      --sway:${sway}px;--rotation:${rotation}deg;
    `;
    container.appendChild(piece);
  }

  if (!document.getElementById("confetti-style")) {
    const style = document.createElement("style");
    style.id = "confetti-style";
    style.textContent = `
      @keyframes confettiFall {
        0% { opacity:1; transform:translateY(0) rotate(var(--rotation)); }
        100% { opacity:0; transform:translateY(110vh) translateX(var(--sway)) rotate(calc(var(--rotation) + 720deg)); }
      }
    `;
    document.head.appendChild(style);
  }

  setTimeout(() => container.remove(), 5000);
}

function setupSwipe() {
  const card = el("#active-card");
  let startX = 0, startY = 0, dx = 0, dragging = false;

  card.addEventListener("pointerdown", (event) => {
    if (state.locked || event.clientX < 28 || event.clientX > window.innerWidth - 28) return;
    startX = event.clientX; startY = event.clientY; dx = 0; dragging = true;
    card.classList.add("is-dragging"); card.setPointerCapture(event.pointerId);
  });
  card.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) { dragging = false; card.classList.remove("is-dragging"); card.style.transform = ""; return; }
    card.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
    el("#stamp-left").style.opacity = Math.max(0, Math.min(.95, -dx / 90));
    el("#stamp-right").style.opacity = Math.max(0, Math.min(.95, dx / 90));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false; card.classList.remove("is-dragging");
    if (Math.abs(dx) > 82) {
      const choiceIndex = dx > 0 ? 1 : 0;
      choose(MODES[state.mode].choices[choiceIndex].id, dx > 0 ? 1 : -1);
    } else {
      card.style.transform = "";
      el("#stamp-left").style.opacity = 0; el("#stamp-right").style.opacity = 0;
    }
  };
  card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end);
}

function haptic(type) {
  if (!navigator.vibrate) return;
  if (type === "success") navigator.vibrate([10, 30, 10]);
  else if (type === "error") navigator.vibrate([50]);
  else navigator.vibrate(15);
}

function blip(success) {
  if (!state.sound) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator(); const gain = context.createGain();
  oscillator.frequency.value = success ? 520 : 260; gain.gain.setValueAtTime(.04, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .12);
  oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .12);
  oscillator.addEventListener("ended", () => context.close(), { once: true });
}

async function shareScore() {
  const text = `I scored ${el("#score-value").textContent} on Spot Check — ${el("#level-name").textContent}.`;
  try {
    if (navigator.share) await navigator.share({ title: "Spot Check", text, url: location.href });
    else { await navigator.clipboard.writeText(`${text} ${location.href}`); showToast("Score copied to clipboard."); }
  } catch (error) { if (error.name !== "AbortError") showToast("Sharing was unavailable."); }
}

let toastTimer;
function showToast(message) {
  const toast = el("#toast"); toast.textContent = message; toast.classList.add("is-visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

let wordReelInterval;
function setupWordReel() {
  clearInterval(wordReelInterval);
  const config = MODES[state.mode];
  const words = config.reel;
  let index = 0;
  const wordEl = el("#reel-word");
  wordEl.textContent = words[0];
  wordReelInterval = setInterval(() => {
    index = (index + 1) % words.length;
    wordEl.classList.remove("is-changing");
    void wordEl.offsetWidth;
    wordEl.textContent = words[index];
    wordEl.classList.add("is-changing");
  }, 1000);
}

async function initIntroImage() {
  const cards = await window.SpotCheckData.loadCards();
  const modeCards = getCardsForMode(cards, state.mode);
  el("#intro-meta").textContent = `${Math.min(QUIZ_LENGTH, modeCards.length)} cards · ~1 minute`;
  if (modeCards.length > 0) {
    const randomCard = modeCards[Math.floor(Math.random() * modeCards.length)];
    el("#intro-blur-image").src = randomCard.src;
    el("#intro-blur-image").style.objectPosition = getCardFocus(randomCard);
  }
}

async function getStats() {
  if (typeof window.SpotCheckData.getStats !== "function") return null;
  try {
    return await window.SpotCheckData.getStats(state.mode);
  } catch {
    return null;
  }
}

async function updateIntroProgress() {
  const stats = await getStats();
  const container = el("#intro-progress");
  if (!container) return;
  if (!stats || stats.plays === 0) {
    container.hidden = true;
    return;
  }
  el("#intro-best").textContent = `${stats.best}%`;
  el("#intro-plays").textContent = stats.plays;
  container.hidden = false;
}

async function refreshStats(currentScore) {
  const stats = await getStats();
  if (!stats) return;
  el("#stat-best").textContent = stats.best === null ? "—" : `${stats.best}%`;
  el("#stat-average").textContent = stats.average === null ? "—" : `${stats.average}%`;
  el("#stat-plays").textContent = stats.plays;
  el("#stat-streak").textContent = stats.streak;

  const trend = el("#score-trend");
  if (stats.previousScore === null || stats.previousScore === undefined) {
    trend.textContent = "First run";
    trend.className = "";
  } else {
    const change = currentScore - stats.previousScore;
    trend.textContent = change === 0 ? "Matched last run" : `${change > 0 ? "+" : ""}${change} vs last`;
    trend.className = change > 0 ? "trend-up" : change < 0 ? "trend-down" : "";
  }
  await updateIntroProgress();
}

function renderReview() {
  state.reviewIndex = 0;
  const container = el("#review-list");
  const score = Math.round((state.answers.filter((answer) => answer.correct).length / state.quizLength) * 100);
  container.innerHTML = state.answers.map((answer, i) => {
    const card = answer.card;
    const correctLabel = MODES[state.mode].choices.find(c => c.id === card.labels[state.mode])?.label || "?";
    const userLabel = MODES[state.mode].choices.find(c => c.id === answer.choice)?.label || "?";
    return `
      <li>
        <button class="review-item ${answer.correct ? 'correct' : 'incorrect'}" type="button" data-index="${i}" aria-label="Review ${card.title || `portrait ${i + 1}`}: ${answer.correct ? 'correct' : 'incorrect'}">
          <img class="review-thumb" src="${card.src}" alt="" style="object-position: ${getCardFocus(card)}" />
          <div class="review-info">
            <div class="review-row">
              <span class="review-result ${answer.correct ? 'correct' : 'incorrect'}">${answer.correct ? '✓' : '✗'}</span>
              <span class="review-title">${card.title || `Portrait ${i + 1}`}</span>
            </div>
            <div class="review-row review-labels">
              <span class="label-pair"><span class="label-tag user">${userLabel}</span> <span class="arrow">→</span> <span class="label-tag correct-label">${correctLabel}</span></span>
            </div>
          </div>
        </button>
      </li>
    `;
  }).join("");

  el("#review-score").textContent = `${score}%`;
  el("#review-score").className = score < 50 ? "score-low" : "score-high";

  all(".review-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      const idx = parseInt(e.currentTarget.dataset.index, 10);
      openReviewDetail(idx);
    });
  });
}

function openReviewDetail(index) {
  state.reviewIndex = index;
  const answer = state.answers[index];
  const card = answer.card;
  const correctLabel = MODES[state.mode].choices.find(c => c.id === card.labels[state.mode])?.label || "?";
  const userLabel = MODES[state.mode].choices.find(c => c.id === answer.choice)?.label || "?";

  el("#detail-image").src = card.src;
  el("#detail-image").alt = card.alt || "Portrait";
  el("#detail-image").style.objectPosition = getCardFocus(card);
  el("#detail-card-title").textContent = card.title || `Portrait ${index + 1}`;
  el("#detail-result").textContent = answer.correct ? "Correct" : "Incorrect";
  el("#detail-result").className = `detail-result ${answer.correct ? 'correct' : 'incorrect'}`;
  el("#detail-user-choice").textContent = `You chose: ${userLabel}`;
  el("#detail-correct-answer").textContent = `Correct: ${correctLabel}`;
  el("#detail-nav").textContent = `${index + 1} / ${state.answers.length}`;
  el("[data-action='review-prev']").disabled = index === 0;
  el("[data-action='review-next']").disabled = index === state.answers.length - 1;
  el("#detail-card").style.transform = "";

  if (!el(".review-detail-screen").classList.contains("is-active")) showScreen("review-detail");
}

function navigateReviewDetail(direction) {
  const newIndex = state.reviewIndex + direction;
  if (newIndex >= 0 && newIndex < state.answers.length) {
    openReviewDetail(newIndex);
  }
}

function setupSwipeReviewDetail() {
  const detailCard = el("#detail-card");
  let startX = 0, dx = 0, dragging = false;

  detailCard.addEventListener("pointerdown", (event) => {
    startX = event.clientX; dx = 0; dragging = true;
    detailCard.classList.add("is-dragging"); detailCard.setPointerCapture(event.pointerId);
  });
  detailCard.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    dx = event.clientX - startX;
    detailCard.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false; detailCard.classList.remove("is-dragging");
    if (Math.abs(dx) > 60) {
      navigateReviewDetail(dx > 0 ? -1 : 1);
    } else {
      detailCard.style.transform = "";
    }
  };
  detailCard.addEventListener("pointerup", end); detailCard.addEventListener("pointercancel", end);
}

function handleKeydown(event) {
  if (el(".quiz-screen").classList.contains("is-active")) {
    if (state.locked) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      choose(MODES[state.mode].choices[0].id, -1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      choose(MODES[state.mode].choices[1].id, 1);
    }
  }
  if (el(".review-detail-screen").classList.contains("is-active")) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigateReviewDetail(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      navigateReviewDetail(1);
    } else if (event.key === "Escape") {
      showScreen("review");
    }
  }
}

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "start" || action === "again") startQuiz();
  if (action === "home") { showScreen("intro"); initIntroImage(); updateIntroProgress(); }
  if (action === "share") shareScore();
  if (action === "toggle-mode") {
    const newMode = state.mode === "woman_trans" ? "man_trans" : "woman_trans";
    setMode(newMode);
  }
  if (action === "sound") {
    state.sound = !state.sound;
    writeLocalValue("spot-check:sound", String(state.sound));
    const button = el("[data-action='sound']");
    button.setAttribute("aria-pressed", String(state.sound));
    button.textContent = state.sound ? "♫" : "♪";
  }
  if (action === "review") showScreen("review");
  if (action === "undo") undoLastChoice();
  if (action === "review-back") showScreen("results");
  if (action === "review-prev") navigateReviewDetail(-1);
  if (action === "review-next") navigateReviewDetail(1);
  if (action === "review-close") showScreen("review");
});

document.addEventListener("keydown", handleKeydown);

setupSwipe();
setupSwipeReviewDetail();

const savedSound = readLocalValue("spot-check:sound");
if (savedSound !== null) {
  state.sound = savedSound === "true";
  const button = el("[data-action='sound']");
  if (button) {
    button.setAttribute("aria-pressed", String(state.sound));
    button.textContent = state.sound ? "♫" : "♪";
  }
}

const savedMode = readLocalValue("spot-check:mode");
setMode(MODES[savedMode] ? savedMode : "woman_trans").catch(() => {
  showToast("Portraits could not be loaded. Try refreshing the page.");
});
showScreen("intro");
