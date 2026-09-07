const QUIZ_LENGTH = 10;
const MAX_IMAGE_ZOOM = 1.8;
let interfaceBeatMs = 60000 / 74;
let quizPinchZoom;
let reviewPinchZoom;

const MODES = {
  woman_trans: {
    question: "Your call",
    choices: [
      { id: "woman", label: "Lady", tone: "lady" },
      { id: "trans", label: "Ladyboy", tone: "ladyboy" },
    ],
    categories: ["woman", "trans-woman"],
    modeLabel: "Lady / Ladyboy",
  },
  man_trans: {
    question: "Your call",
    choices: [
      { id: "man", label: "Man", tone: "man" },
      { id: "trans", label: "Trans man", tone: "ladyboy" },
    ],
    categories: ["man", "trans-man"],
    modeLabel: "Man / Trans man",
  },
};

const INTRO_REEL = [
  { label: "lady", tone: "lady" },
  { label: "ladyboy", tone: "ladyboy" },
  { label: "man", tone: "man" },
];

const LEVELS = [
  "Clueless", "Guessing blind", "Coin flipper", "Below average", "Almost there",
  "Average Joe", "Getting good", "Sharp eye", "Nearly expert", "Eagle eye", "Expert spotter",
];

const SCORE_COMMENTS = {
  perfect: [
    "Perfect. The monkey has left the chat.",
    "100%. No notes—only suspiciously good eyesight.",
    "A clean sweep. Even the monkey is impressed.",
    "Bangkok blinked first.",
    "Flawless. Customs waves you through on reputation alone.",
    "You could probably give the monkey directions.",
    "The street signs are asking you for directions now.",
    "Perfect score. Try not to become unbearable about it.",
  ],
  high: [
    "So close—can you make it a clean 100%?",
    "Sharp. Can you come even closer to 100%?",
    "The monkey is safely behind you. Keep climbing.",
    "Excellent eyes. One more run for perfection?",
    "Bangkok survival odds: surprisingly respectable.",
    "You may roam Bangkok without a chaperone. Probably.",
    "One mistake away from insufferable. Go again.",
    "The monkey has quietly deleted your number.",
    "Very sharp. Annoyingly sharp.",
  ],
  aboveChance: [
    "You beat the monkey. It was closer than it looked.",
    "Above chance. Now make the monkey nervous.",
    "Humanity keeps a narrow lead.",
    "Solid. Can you push this closer to 100%?",
    "You would probably survive Bangkok. Keep your phone charged.",
    "Bangkok privileges: provisionally approved.",
    "Decent—but do not start acting like a local.",
    "The monkey has stopped laughing, but not for long.",
    "You have earned cautious independence.",
    "Competent enough to get lost with confidence.",
    "Not bad. Your tour guide can take lunch.",
  ],
  tied: [
    "A perfect tie with the monkey. Awkward.",
    "The monkey matched you without reading the rules.",
    "Dead heat. The monkey wants a rematch.",
    "Exactly 50%. Humanity is asking for another attempt.",
    "Coin-flip territory—the monkey looks comfortable here.",
    "Bangkok would eat this confidence for breakfast.",
    "Book the flight, but keep a responsible adult on speed dial.",
    "Fifty-fifty: also your odds of finding the hotel again.",
    "The monkey says this could have been an email.",
    "Your instincts flipped a coin and called it expertise.",
    "Bangkok status: chaperone recommended.",
    "You and chance are officially business partners.",
  ],
  belowChance: [
    "We were told humans are smarter than monkeys.",
    "The monkey is trying very hard not to look smug.",
    "Below chance. Bold strategy.",
    "The monkey has started giving you hints.",
    "Humanity would like this score kept off the record.",
    "The banana-powered opponent is currently ahead.",
    "You would not fare well in Bangkok.",
    "Make sure an adult accompanies you to Bangkok—you clearly will not make it alone.",
    "Your Bangkok itinerary now includes adult supervision.",
    "The monkey just volunteered to chaperone you through Bangkok.",
    "Even the coin is embarrassed for you.",
    "You did not read the room; the room read you.",
    "Confidence: elite. Accuracy: still at baggage claim.",
    "Bangkok would send you home with a name tag.",
    "The monkey is pricing flights just to supervise you.",
    "This score needs a helmet and an emergency contact.",
  ],
  veryLow: [
    "The monkey is now running the tutorial.",
    "At this point, ask the monkey for coaching.",
    "A brave attack on statistical probability.",
    "The good news: improvement is almost guaranteed.",
    "Do not attempt Bangkok without a guide, a map, and the monkey.",
    "At this score, Bangkok is not a holiday; it is a rescue mission.",
    "Please remain where you are. A responsible adult has been notified.",
    "The monkey has taken custody of the itinerary.",
    "You could get lost in a one-way hallway.",
    "Even random guessing wants a formal apology.",
    "Your instincts have entered witness protection.",
    "Bangkok called. It said absolutely not.",
    "The tutorial would like to start over.",
    "You are now statistically impressive for the wrong reason.",
  ],
};

const state = {
  mode: "woman_trans",
  availableModes: [],
  cards: [],
  quizLength: QUIZ_LENGTH,
  index: 0,
  answers: [],
  locked: false,
  sound: true,
  reviewIndex: 0,
  attemptStartedAt: 0,
  deviceHash: null,
  imageMemory: {},
  viewedInRound: new Set(),
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
  async getImageMemory(deviceHash, mode) {
    const key = `spot-check:image-memory:${mode}`;
    const stored = readLocalJSON(key, {});
    const data = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    if (Object.prototype.hasOwnProperty.call(data, deviceHash)) {
      const memory = data[deviceHash];
      return memory && typeof memory === "object" && !Array.isArray(memory) ? memory : {};
    }

    // Migrate the original seen-ID list and completed attempts once, without
    // making people replay portraits they have already encountered.
    const legacy = readLocalJSON(`spot-check:shown:${mode}`, {});
    const shownIds = legacy && !Array.isArray(legacy) && Array.isArray(legacy[deviceHash])
      ? legacy[deviceHash]
      : [];
    const memory = Object.fromEntries(shownIds.map((imageId) => [imageId, {
      views: 1,
      correct: 0,
      wrong: 0,
      lastCorrect: null,
      lastViewedAt: null,
      lastAnsweredAt: null,
    }]));
    const answerHistory = {};
    readAttempts()
      .filter((attempt) => attempt.anonymousId === deviceHash && attempt.mode === mode && Array.isArray(attempt.answers))
      .forEach((attempt) => {
        attempt.answers.forEach((answer) => {
          if (!answer?.imageId) return;
          const previous = answerHistory[answer.imageId] || { views: 0, correct: 0, wrong: 0 };
          previous.views += 1;
          previous.correct += answer.correct ? 1 : 0;
          previous.wrong += answer.correct ? 0 : 1;
          previous.lastCorrect = Boolean(answer.correct);
          previous.lastViewedAt = attempt.createdAt || previous.lastViewedAt || null;
          previous.lastAnsweredAt = attempt.createdAt || previous.lastAnsweredAt || null;
          answerHistory[answer.imageId] = previous;
        });
      });
    Object.entries(answerHistory).forEach(([imageId, history]) => {
      memory[imageId] = {
        views: Math.max(memory[imageId]?.views || 0, history.views),
        correct: history.correct,
        wrong: history.wrong,
        lastCorrect: history.lastCorrect,
        lastViewedAt: history.lastViewedAt,
        lastAnsweredAt: history.lastAnsweredAt,
      };
    });
    data[deviceHash] = memory;
    writeLocalJSON(key, data);
    return memory;
  },
  async recordImageView(deviceHash, mode, imageId, viewedAt) {
    const key = `spot-check:image-memory:${mode}`;
    const stored = readLocalJSON(key, {});
    const data = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    const memory = data[deviceHash] && typeof data[deviceHash] === "object" ? data[deviceHash] : {};
    const previous = memory[imageId] || {};
    memory[imageId] = {
      views: (Number(previous.views) || 0) + 1,
      correct: Number(previous.correct) || 0,
      wrong: Number(previous.wrong) || 0,
      lastCorrect: typeof previous.lastCorrect === "boolean" ? previous.lastCorrect : null,
      lastViewedAt: viewedAt,
      lastAnsweredAt: previous.lastAnsweredAt || null,
    };
    data[deviceHash] = memory;
    writeLocalJSON(key, data);
  },
  async recordImageResults(deviceHash, mode, answers, answeredAt) {
    const key = `spot-check:image-memory:${mode}`;
    const stored = readLocalJSON(key, {});
    const data = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    const memory = data[deviceHash] && typeof data[deviceHash] === "object" ? data[deviceHash] : {};
    answers.forEach((answer) => {
      if (!answer?.imageId) return;
      const previous = memory[answer.imageId] || {};
      memory[answer.imageId] = {
        views: Math.max(1, Number(previous.views) || 0),
        correct: (Number(previous.correct) || 0) + (answer.correct ? 1 : 0),
        wrong: (Number(previous.wrong) || 0) + (answer.correct ? 0 : 1),
        lastCorrect: Boolean(answer.correct),
        lastViewedAt: previous.lastViewedAt || answeredAt,
        lastAnsweredAt: answeredAt,
      };
    });
    data[deviceHash] = memory;
    writeLocalJSON(key, data);
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

function normalizedMemoryEntry(entry = {}) {
  return {
    views: Number(entry.views) || 0,
    correct: Number(entry.correct) || 0,
    wrong: Number(entry.wrong) || 0,
    lastCorrect: typeof entry.lastCorrect === "boolean" ? entry.lastCorrect : null,
    lastViewedAt: entry.lastViewedAt || null,
    lastAnsweredAt: entry.lastAnsweredAt || null,
  };
}

function oldestFirst(cards, imageMemory, preferMoreMistakes = false) {
  return shuffle(cards).sort((left, right) => {
    const leftMemory = normalizedMemoryEntry(imageMemory[left.id]);
    const rightMemory = normalizedMemoryEntry(imageMemory[right.id]);
    const leftViewed = Date.parse(leftMemory.lastViewedAt || "") || 0;
    const rightViewed = Date.parse(rightMemory.lastViewedAt || "") || 0;
    if (leftViewed !== rightViewed) return leftViewed - rightViewed;
    if (preferMoreMistakes && leftMemory.wrong !== rightMemory.wrong) {
      return rightMemory.wrong - leftMemory.wrong;
    }
    return leftMemory.views - rightMemory.views;
  });
}

function takeBalanced(cards, mode, choiceIds, limit) {
  const queues = choiceIds.map((choiceId) =>
    cards.filter((card) => card.labels[mode] === choiceId)
  );
  const selected = [];
  while (selected.length < limit && queues.some((queue) => queue.length > 0)) {
    queues.forEach((queue) => {
      if (selected.length < limit && queue.length > 0) selected.push(queue.shift());
    });
  }
  return selected;
}

function getCardFocus(card) {
  const clamp = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
  };
  return `${clamp(card.focus?.x, 50)}% 0%`;
}

function setPortraitPresentation(container, image, backdrop, card, alt) {
  const focus = getCardFocus(card);
  const portraitId = card.id;
  container.classList.remove("is-wide-image");
  image.dataset.portraitId = portraitId;
  image.alt = alt;
  image.style.objectPosition = focus;
  backdrop.src = card.src;
  backdrop.style.objectPosition = focus;

  const updateFit = () => {
    if (image.dataset.portraitId !== portraitId || !image.naturalWidth || !image.naturalHeight) return;
    const isWide = image.naturalWidth / image.naturalHeight >= 1.15;
    container.classList.toggle("is-wide-image", isWide);
    image.style.objectPosition = isWide ? "50% 50%" : focus;
  };
  image.onload = updateFit;
  image.src = card.src;
  if (image.complete) requestAnimationFrame(updateFit);
}

function buildBalancedDeck(cards, mode, limit, imageMemory = {}) {
  const choiceIds = MODES[mode].choices.map((choice) => choice.id);
  if (choiceIds.some((choiceId) => !cards.some((card) => card.labels[mode] === choiceId))) {
    throw new Error("This mode needs at least one portrait for each answer.");
  }

  const unseen = shuffle(cards.filter((card) => normalizedMemoryEntry(imageMemory[card.id]).views === 0));
  const missed = oldestFirst(cards.filter((card) => {
    const memory = normalizedMemoryEntry(imageMemory[card.id]);
    return memory.views > 0 && memory.lastCorrect === false;
  }), imageMemory, true);
  const answeredOrSeen = oldestFirst(cards.filter((card) => {
    const memory = normalizedMemoryEntry(imageMemory[card.id]);
    return memory.views > 0 && memory.lastCorrect !== false;
  }), imageMemory);

  const selected = takeBalanced(unseen, mode, choiceIds, limit);
  if (selected.length < limit) {
    selected.push(...takeBalanced(missed, mode, choiceIds, limit - selected.length));
  }
  if (selected.length < limit) {
    selected.push(...takeBalanced(answeredOrSeen, mode, choiceIds, limit - selected.length));
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
  if (modeButton) modeButton.disabled = name !== "intro" || state.availableModes.length < 2;
  window.scrollTo({ top: 0, behavior: "smooth" });
  const musicScene = name === "intro" ? "waiting" : name === "quiz" ? "battle" : "results";
  window.SpotCheckMusic?.setScene(musicScene);
  if (name === "results") triggerResultsAnimations();
  if (name === "review") renderReview();
}

async function setMode(mode) {
  if (!MODES[mode] || !state.availableModes.includes(mode)) return;
  state.mode = mode;
  writeLocalValue("spot-check:mode", mode);
  const config = MODES[mode];
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
    <button class="choice-button tone-${choice.tone}" type="button" data-choice="${choice.id}" aria-label="Choose ${choice.label}">
      <span class="choice-arrow" aria-hidden="true">${index ? "→" : "←"}</span>
      <span class="choice-copy"><strong>${choice.label}</strong><small>Swipe ${index ? "right" : "left"}</small></span>
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

function updateAvailableModes(cards) {
  state.availableModes = Object.keys(MODES).filter((mode) => {
    const modeCards = getCardsForMode(cards, mode);
    return MODES[mode].choices.every((choice) =>
      modeCards.some((card) => card.labels?.[mode] === choice.id)
    );
  });
  const modeButton = el("[data-action='toggle-mode']");
  modeButton.hidden = state.availableModes.length < 2;
  modeButton.disabled = state.availableModes.length < 2 || !el(".intro-screen").classList.contains("is-active");
  if (state.availableModes.length === 0) throw new Error("Add at least one portrait for each answer to start a round.");
}

async function startQuiz() {
  const launchButtons = all("[data-action='start'], [data-action='again']");
  launchButtons.forEach((button) => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
  try {
    const allCards = await window.SpotCheckData.loadCards();
    updateAvailableModes(allCards);
    const modeCards = getCardsForMode(allCards, state.mode);
    if (modeCards.length < 2) throw new Error("This mode needs at least two valid portrait entries.");

    const deviceHash = await anonymousDeviceHash();
    let imageMemory = {};
    try {
      if (typeof window.SpotCheckData.getImageMemory === "function") {
        imageMemory = await window.SpotCheckData.getImageMemory(deviceHash, state.mode);
      } else if (typeof window.SpotCheckData.getShownImages === "function") {
        const shownIds = await window.SpotCheckData.getShownImages(deviceHash, state.mode);
        imageMemory = Object.fromEntries(shownIds.map((imageId) => [imageId, { views: 1 }]));
      }
    } catch {
      imageMemory = {};
    }
    const targetLength = Math.min(QUIZ_LENGTH, modeCards.length);
    state.cards = buildBalancedDeck(modeCards, state.mode, targetLength, imageMemory);
    state.quizLength = state.cards.length;
    preloadCards(state.cards.slice(0, 3));

    state.index = 0;
    state.answers = [];
    state.locked = false;
    state.attemptStartedAt = Date.now();
    state.deviceHash = deviceHash;
    state.imageMemory = imageMemory && typeof imageMemory === "object" ? imageMemory : {};
    state.viewedInRound = new Set();
    renderChoices();
    renderCard();
    showScreen("quiz");
  } catch (error) {
    showToast(error.message || "The quiz could not start.");
  } finally {
    launchButtons.forEach((button) => { button.disabled = false; button.removeAttribute("aria-busy"); });
  }
}

async function rememberCardView(card) {
  if (!card?.id || !state.deviceHash || state.viewedInRound.has(card.id)) return;
  state.viewedInRound.add(card.id);
  const viewedAt = new Date().toISOString();
  const previous = normalizedMemoryEntry(state.imageMemory[card.id]);
  state.imageMemory[card.id] = {
    ...previous,
    views: previous.views + 1,
    lastViewedAt: viewedAt,
  };

  try {
    if (typeof window.SpotCheckData.recordImageView === "function") {
      await window.SpotCheckData.recordImageView(state.deviceHash, state.mode, card.id, viewedAt);
    } else if (typeof window.SpotCheckData.setShownImages === "function") {
      const shownIds = Object.entries(state.imageMemory)
        .filter(([, memory]) => normalizedMemoryEntry(memory).views > 0)
        .map(([imageId]) => imageId);
      await window.SpotCheckData.setShownImages(state.deviceHash, state.mode, shownIds);
    }
  } catch {
    // Viewing and answering still work when browser storage is unavailable.
  }
}

function renderCard() {
  const card = state.cards[state.index];
  if (!card) return;
  const active = el("#active-card");
  const behind = el(".card-behind");
  quizPinchZoom?.reset();
  active.className = "swipe-card card-active";
  active.style.cssText = "";
  setPortraitPresentation(active, el("#card-image"), el("#card-backdrop"), card, "Portrait photo");
  el("#card-number").textContent = state.index + 1;
  el("#card-total").textContent = state.quizLength;
  el("#progress-bar").style.width = `${((state.index + 1) / state.quizLength) * 100}%`;
  el(".progress-track").setAttribute("aria-label", `Quiz progress: card ${state.index + 1} of ${state.quizLength}`);
  el("#stamp-left").style.opacity = 0;
  el("#stamp-right").style.opacity = 0;
  el("[data-action='undo']").disabled = state.index === 0;
  active.classList.remove("correct", "incorrect");
  void rememberCardView(card);

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
  const answerRevealDelayMs = Math.round(interfaceBeatMs * 0.5);
  const cardAdvanceDelayMs = Math.max(820, Math.round(interfaceBeatMs * 1.5));

  window.setTimeout(() => {
    active.classList.add("is-leaving");
    active.style.transform = `translateX(${direction * 145}%) rotate(${direction * 19}deg)`;
    active.style.opacity = "0";
  }, answerRevealDelayMs);

  window.setTimeout(() => {
    state.index += 1;
    if (state.index >= state.quizLength) finishQuiz();
    else { renderCard(); state.locked = false; }
  }, cardAdvanceDelayMs);
}

function undoLastChoice() {
  if (state.locked || state.index === 0 || state.answers.length === 0) return;
  state.index -= 1;
  state.answers.pop();
  renderCard();
  el("#answer-feedback").textContent = `Answer ${state.index + 1} restored.`;
  haptic("tap");
}

let lastScoreComment = "";

function pickComment(comments) {
  const freshComments = comments.filter((comment) => comment !== lastScoreComment);
  const choices = freshComments.length > 0 ? freshComments : comments;
  const comment = choices[Math.floor(Math.random() * choices.length)];
  lastScoreComment = comment;
  return comment;
}

function getScoreComment(score) {
  if (score === 100) return pickComment(SCORE_COMMENTS.perfect);
  if (score >= 80) return pickComment(SCORE_COMMENTS.high);
  if (score >= 60) return pickComment(SCORE_COMMENTS.aboveChance);
  if (score >= 50) return pickComment(SCORE_COMMENTS.tied);
  if (score >= 30) return pickComment(SCORE_COMMENTS.belowChance);
  return pickComment(SCORE_COMMENTS.veryLow);
}

function getScoreClass(score) {
  if (score < 50) return "score-low";
  if (score <= 60) return "score-mid";
  return "score-high";
}

function updateMonkeyBenchmark(score) {
  const benchmark = el("#monkey-benchmark");
  const difference = score - 50;
  benchmark.classList.toggle("is-close", Math.abs(difference) <= 10);
  benchmark.classList.toggle("is-tied", difference === 0);
  el("#monkey-gap").textContent = difference === 0
    ? "You are tied at 50%"
    : difference > 0
      ? `You are ${difference} points ahead`
      : `The monkey is ${Math.abs(difference)} points ahead`;
}

async function finishQuiz() {
  const correctCount = state.answers.filter((answer) => answer.correct).length;
  const score = Math.round((correctCount / state.quizLength) * 100);
  const levelIndex = Math.min(10, Math.floor(score / 10));
  const scoreValue = el("#score-value");
  scoreValue.textContent = `${score}%`;
  scoreValue.className = getScoreClass(score);
  el("#score-message").textContent = getScoreComment(score);
  el("#score-detail").textContent = `${correctCount} of ${state.quizLength} correct.`;
  el("#pin-score").textContent = `${score}%`;
  el("#level-name").textContent = LEVELS[levelIndex];
  el("#rank-low").textContent = LEVELS[0];
  el("#rank-high").textContent = LEVELS[10];
  updateMonkeyBenchmark(score);
  showScreen("results");
  requestAnimationFrame(() => { el("#meter-pin").style.setProperty("--pin", `${score}%`); });

  if (score >= 70) launchConfetti(score);

  const completedAt = new Date().toISOString();
  let saveFailed = false;
  try {
    const deviceHash = state.deviceHash || await anonymousDeviceHash();
    await window.SpotCheckData.recordAttempt({
      anonymousId: deviceHash,
      mode: state.mode,
      score,
      answers: state.answers.map(a => ({ imageId: a.imageId, choice: a.choice, correct: a.correct })),
      createdAt: completedAt,
      durationMs: Math.max(0, Date.now() - state.attemptStartedAt),
      schemaVersion: 2,
    });
  } catch {
    saveFailed = true;
  }

  try {
    if (state.deviceHash && typeof window.SpotCheckData.recordImageResults === "function") {
      await window.SpotCheckData.recordImageResults(
        state.deviceHash,
        state.mode,
        state.answers.map(({ imageId, correct }) => ({ imageId, correct })),
        completedAt,
      );
    }
  } catch {
    saveFailed = true;
  }
  if (saveFailed) showToast("Score shown, but some local history could not be saved.");

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

  el(".leaderboard").hidden = leaderboard.length === 0;
  list.innerHTML = realEntries;
  animateLeaderboardEntries();
}

function animateLeaderboardEntries() {
  const entries = all("#leaderboard-list .leaderboard-entry");
  entries.forEach((entry, i) => {
    entry.style.opacity = "0";
    entry.style.transform = "translateY(20px)";
    entry.style.transition = "opacity 0.4s ease, transform 0.4s ease";
    window.setTimeout(() => {
      entry.style.opacity = "1";
      entry.style.transform = "translateY(0)";
    }, 200 + i * 80);
  });
}

function triggerResultsAnimations() {
  const elements = [
    ".results-heading",
    ".rank-card",
    ".personal-stats",
    ".monkey-benchmark",
    ".leaderboard",
    ".result-actions"
  ];
  const openingDelay = Math.round(interfaceBeatMs * 0.25);
  const stepDelay = Math.round(interfaceBeatMs / 6);
  elements.forEach((selector, i) => {
    const el = document.querySelector(selector);
    if (el) {
      el.style.opacity = "0";
      el.style.transform = "translateY(20px)";
      el.style.transition = `opacity ${interfaceBeatMs * 0.65}ms ease, transform ${interfaceBeatMs * 0.65}ms ease`;
      window.setTimeout(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      }, openingDelay + i * stepDelay);
    }
  });

  const scoreEl = el("#score-value");
  if (scoreEl) {
    scoreEl.style.transform = "scale(0.5)";
    scoreEl.style.transition = `transform ${interfaceBeatMs * 0.75}ms cubic-bezier(.16,.85,.25,1)`;
    window.setTimeout(() => { scoreEl.style.transform = "scale(1)"; }, Math.round(interfaceBeatMs * 0.5));
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

  const resetDrag = () => {
    dragging = false;
    dx = 0;
    card.classList.remove("is-dragging");
    card.style.transform = "";
    el("#stamp-left").style.opacity = 0;
    el("#stamp-right").style.opacity = 0;
  };

  card.addEventListener("pointerdown", (event) => {
    if (state.locked || card.classList.contains("is-pinching") || event.clientX < 28 || event.clientX > window.innerWidth - 28) return;
    startX = event.clientX; startY = event.clientY; dx = 0; dragging = true;
    card.classList.add("is-dragging"); card.setPointerCapture(event.pointerId);
  });
  card.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    if (card.classList.contains("is-pinching")) {
      resetDrag();
      return;
    }
    dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) { dragging = false; card.classList.remove("is-dragging"); card.style.transform = ""; return; }
    card.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
    el("#stamp-left").style.opacity = Math.max(0, Math.min(.95, -dx / 90));
    el("#stamp-right").style.opacity = Math.max(0, Math.min(.95, dx / 90));
  });
  const end = () => {
    if (!dragging) return;
    if (card.classList.contains("is-pinching")) {
      resetDrag();
      return;
    }
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

function setupPinchZoom(containerSelector, imageSelector) {
  const container = el(containerSelector);
  const image = el(imageSelector);
  const touchPointers = new Map();
  let zoom = 1;
  let startingZoom = 1;
  let startingDistance = 0;
  let pinching = false;

  const pointerPair = () => Array.from(touchPointers.values()).slice(0, 2);
  const distanceBetween = ([first, second]) => Math.hypot(second.x - first.x, second.y - first.y);
  const applyZoom = (nextZoom) => {
    zoom = Math.max(1, Math.min(MAX_IMAGE_ZOOM, nextZoom));
    image.style.setProperty("--image-zoom", zoom.toFixed(3));
    container.classList.toggle("is-zoomed", zoom > 1.005);
  };
  const stopPinching = () => {
    pinching = false;
    container.classList.remove("is-pinching");
  };
  const reset = () => {
    touchPointers.clear();
    stopPinching();
    zoom = 1;
    startingZoom = 1;
    startingDistance = 0;
    image.style.setProperty("--image-zoom", "1");
    image.style.setProperty("--zoom-origin-x", "50%");
    image.style.setProperty("--zoom-origin-y", "50%");
    container.classList.remove("is-zoomed");
  };

  container.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    if (touchPointers.size >= 2) return;
    touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointers.size < 2) return;

    const pair = pointerPair();
    startingDistance = distanceBetween(pair);
    if (!startingDistance) return;
    startingZoom = zoom;
    pinching = true;
    container.classList.add("is-pinching");
    container.classList.remove("is-dragging");
    container.style.transform = "";

    if (container.id === "active-card") {
      el("#stamp-left").style.opacity = 0;
      el("#stamp-right").style.opacity = 0;
    }

    if (zoom <= 1.005) {
      const bounds = container.getBoundingClientRect();
      const midpointX = (pair[0].x + pair[1].x) / 2;
      const midpointY = (pair[0].y + pair[1].y) / 2;
      const originX = Math.max(0, Math.min(100, ((midpointX - bounds.left) / bounds.width) * 100));
      const originY = Math.max(0, Math.min(100, ((midpointY - bounds.top) / bounds.height) * 100));
      image.style.setProperty("--zoom-origin-x", `${originX.toFixed(1)}%`);
      image.style.setProperty("--zoom-origin-y", `${originY.toFixed(1)}%`);
    }
  });

  container.addEventListener("pointermove", (event) => {
    if (!touchPointers.has(event.pointerId)) return;
    touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinching || touchPointers.size < 2 || !startingDistance) return;
    event.preventDefault();
    applyZoom(startingZoom * (distanceBetween(pointerPair()) / startingDistance));
  }, { passive: false });

  const releasePointer = (event) => {
    if (!touchPointers.has(event.pointerId)) return;
    touchPointers.delete(event.pointerId);
    if (touchPointers.size < 2) stopPinching();
  };

  container.addEventListener("pointerup", releasePointer);
  container.addEventListener("pointercancel", releasePointer);
  container.addEventListener("lostpointercapture", releasePointer);

  reset();
  return { reset };
}

function haptic(type) {
  if (!navigator.vibrate) return;
  if (type === "success") navigator.vibrate([10, 30, 10]);
  else if (type === "error") navigator.vibrate([50]);
  else navigator.vibrate(15);
}

function blip(success) {
  if (!state.sound) return;
  window.SpotCheckMusic?.playEffect(success);
}

function updateSoundButton() {
  const button = el("[data-action='sound']");
  if (!button) return;
  button.setAttribute("aria-pressed", String(state.sound));
  button.setAttribute("aria-label", state.sound ? "Turn music off" : "Turn music on");
  button.classList.toggle("is-on", state.sound);
  button.textContent = state.sound ? "♫" : "♪";
  button.title = state.sound ? "Music on" : "Music off";
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
let wordReelIndex = 0;
let wordReelPeriodMs = interfaceBeatMs * 2;

function setupWordReel({ reset = true, periodMs = wordReelPeriodMs } = {}) {
  clearInterval(wordReelInterval);
  wordReelPeriodMs = periodMs;
  const wordEl = el("#reel-word");
  if (reset) {
    wordReelIndex = 0;
    wordEl.textContent = INTRO_REEL[0].label;
    wordEl.className = `tone-${INTRO_REEL[0].tone}`;
  }
  wordReelInterval = setInterval(() => {
    wordReelIndex = (wordReelIndex + 1) % INTRO_REEL.length;
    const word = INTRO_REEL[wordReelIndex];
    wordEl.className = `tone-${word.tone}`;
    void wordEl.offsetWidth;
    wordEl.textContent = word.label;
    wordEl.classList.add("is-changing");
  }, wordReelPeriodMs);
}

function syncInterfaceToBeat(beatMs, scene) {
  if (!Number.isFinite(beatMs) || beatMs <= 0) return;
  interfaceBeatMs = beatMs;
  document.documentElement.style.setProperty("--music-beat", `${beatMs}ms`);
  document.documentElement.style.setProperty("--music-half-beat", `${beatMs * 0.5}ms`);
  document.documentElement.style.setProperty("--music-double-beat", `${beatMs * 2}ms`);
  document.documentElement.style.setProperty("--music-bar", `${beatMs * 4}ms`);
  if (scene === "waiting" && el(".intro-screen").classList.contains("is-active")) {
    setupWordReel({ reset: false, periodMs: beatMs * 2 });
  }
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
        <button class="review-item ${answer.correct ? 'correct' : 'incorrect'}" type="button" data-index="${i}" aria-label="Review answer ${i + 1}: ${answer.correct ? 'correct' : 'incorrect'}">
          <img class="review-thumb" src="${card.src}" alt="" style="object-position: ${getCardFocus(card)}" />
          <div class="review-info">
            <div class="review-row">
              <span class="review-result ${answer.correct ? 'correct' : 'incorrect'}">${answer.correct ? '✓' : '✗'}</span>
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
  el("#review-score").className = getScoreClass(score);

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

  setPortraitPresentation(el("#detail-card"), el("#detail-image"), el("#detail-backdrop"), card, card.alt || "Portrait");
  el("#detail-result").textContent = answer.correct ? "Correct" : "Incorrect";
  el("#detail-result").className = `detail-result ${answer.correct ? 'correct' : 'incorrect'}`;
  el("#detail-user-choice").textContent = `You chose: ${userLabel}`;
  el("#detail-correct-answer").textContent = `Correct: ${correctLabel}`;
  el("#detail-nav").textContent = `${index + 1} / ${state.answers.length}`;
  el("[data-action='review-prev']").disabled = index === 0;
  el("[data-action='review-next']").disabled = index === state.answers.length - 1;
  reviewPinchZoom?.reset();
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

  const resetDrag = () => {
    dragging = false;
    dx = 0;
    detailCard.classList.remove("is-dragging");
    detailCard.style.transform = "";
  };

  detailCard.addEventListener("pointerdown", (event) => {
    if (detailCard.classList.contains("is-pinching")) return;
    startX = event.clientX; dx = 0; dragging = true;
    detailCard.classList.add("is-dragging"); detailCard.setPointerCapture(event.pointerId);
  });
  detailCard.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    if (detailCard.classList.contains("is-pinching")) {
      resetDrag();
      return;
    }
    dx = event.clientX - startX;
    detailCard.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (!dragging) return;
    if (detailCard.classList.contains("is-pinching")) {
      resetDrag();
      return;
    }
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
    const currentIndex = state.availableModes.indexOf(state.mode);
    const newMode = state.availableModes[(currentIndex + 1) % state.availableModes.length];
    if (newMode) setMode(newMode);
  }
  if (action === "sound") {
    state.sound = !state.sound;
    writeLocalValue("spot-check:sound", String(state.sound));
    updateSoundButton();
    window.SpotCheckMusic?.setEnabled(state.sound);
    if (state.sound) window.SpotCheckMusic?.unlock().catch(() => {});
    showToast(state.sound ? "Music on." : "Music off.");
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
quizPinchZoom = setupPinchZoom("#active-card", "#card-image");
reviewPinchZoom = setupPinchZoom("#detail-card", "#detail-image");

const savedSound = readLocalValue("spot-check:sound");
state.sound = savedSound === null ? true : savedSound === "true";
updateSoundButton();
window.SpotCheckMusic?.setEnabled(state.sound);

window.addEventListener("spotcheckmusicchange", (event) => {
  syncInterfaceToBeat(Number(event.detail?.beatMs), event.detail?.scene);
  if (!state.sound) return;
  const button = el("[data-action='sound']");
  if (button && event.detail?.title) button.title = `Music on · ${event.detail.title}`;
});

document.addEventListener("pointerdown", () => {
  if (state.sound) window.SpotCheckMusic?.unlock().catch(() => {});
}, { once: true, passive: true });

showScreen("intro");

async function initializeApp() {
  const cards = await window.SpotCheckData.loadCards();
  updateAvailableModes(cards);
  const savedMode = readLocalValue("spot-check:mode");
  const initialMode = state.availableModes.includes(savedMode) ? savedMode : state.availableModes[0];
  await setMode(initialMode);
}

initializeApp().catch(() => {
  showToast("Portraits could not be loaded. Try refreshing the page.");
});
