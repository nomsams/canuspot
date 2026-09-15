import { createEvent, getRelaySockets, joinRoom, subscribe } from "trystero";
import QRCode from "qrcode";
import jsQR from "jsqr";

const BATTLE_PROTOCOL = 2;
const APP_ID = "com.nomsams.canuspot.live-battle.v2";
const MODE = "woman_trans";
const CARD_COUNTS = [10, 20, 30];
const DEFAULT_CARD_COUNT = 20;
const DEFAULT_DURATION = 180;
const PASS_PHONE_DEFAULT_CARDS = 10;
const PASS_PHONE_DEFAULT_DURATION = 90;
const PASS_PHONE_MIN_PLAYERS = 2;
const PASS_PHONE_MAX_PLAYERS = 8;
const MAX_WAGER = 3;
const MAX_SPEED_BONUS = 5;
const MAX_COMBO_BONUS = 3;
const MAX_CORRECT_POINTS = 10 + MAX_SPEED_BONUS + MAX_WAGER + MAX_COMBO_BONUS;
const COUNTDOWN_MS = 5500;
const HOST_GRACE_MS = 45000;
const STALE_PLAYER_MS = 60000;
const CHAT_LIMIT = 80;
const DISCOVERY_RETRY_MS = 2800;
const RELAY_HEARTBEAT_MS = 6500;
const SIGNAL_RELAY_URLS = [
  "wss://nos.lol",
  "wss://purplerelay.com",
  "wss://relay.mostr.pub",
  "wss://schnorr.me",
  "wss://nostr.data.haus",
  "wss://nostr.vulpem.com",
];
const REACTIONS = new Set(["😂", "🤔", "😱", "🔥", "🙈"]);
const PLAYER_COLORS = ["#dfbd2e", "#ec6a86", "#5b9cea", "#5dbf89", "#a879e0", "#e78a43", "#4db9b4", "#d467c5"];
const TITLE_STORAGE_KEY = "spot-check:battle-titles:v1";
const BATTLE_TITLES = [
  { id: "guess-merchant", name: "Unlicensed Guess Merchant", roast: "No training. No permit. Plenty of opinions.", test: () => true },
  { id: "human-coin", name: "Human Coin Toss", roast: "Statistically alive. Tactically absent.", test: ({ accuracy }) => accuracy >= 0.45 && accuracy <= 0.55 },
  { id: "monkey-contact", name: "Monkey's Emergency Contact", roast: "The monkey asked us to stop comparing you two.", test: ({ accuracy }) => accuracy > 0 && accuracy < 0.5 },
  { id: "bangkok-chaperone", name: "Needs a Bangkok Chaperone", roast: "Do not attempt Sukhumvit without adult supervision.", test: ({ accuracy }) => accuracy > 0 && accuracy <= 0.35 },
  { id: "eyes-optional", name: "Eyes Apparently Optional", roast: "A flawless commitment to being completely wrong.", test: ({ correct }) => correct === 0 },
  { id: "confidence-evidence", name: "Confidence Without Evidence", roast: "Bet first. Think never. Regret immediately.", test: ({ wagerLost }) => wagerLost >= 5 },
  { id: "all-gas", name: "All Gas, No Eyeballs", roast: "Fast hands. Questionable relationship with reality.", test: ({ bestCombo, wagerWon }) => bestCombo >= 5 && wagerWon >= 4 },
  { id: "built-different", name: "Built Different (Allegedly)", roast: "The streak was real. The humility was not.", test: ({ bestCombo }) => bestCombo >= 5 },
  { id: "dangerous-streak", name: "Certified Menace", roast: "Ten straight. Somebody confiscate the phone.", test: ({ bestCombo }) => bestCombo >= 10 },
  { id: "no-supervision", name: "No Adult Supervision Needed", roast: "Against all available evidence, you can be trusted outside.", test: ({ accuracy }) => accuracy >= 0.9 && accuracy < 1 },
  { id: "bangkok-boss", name: "Bangkok Final Boss", roast: "Perfect score. Absolutely unbearable now.", test: ({ accuracy, correct }) => correct > 0 && accuracy === 1 },
];
const HANDOFF_ROASTS = [
  "Take the phone. Everyone else: stop feeding them answers.",
  "Your turn. Try not to lower the average too violently.",
  "Phone unlocked. Dignity not guaranteed.",
  "Step up. The monkey benchmark is watching.",
  "No coaching. Let them fail in their own unique way.",
];

const el = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function readStorage(storage, key, fallback = null) {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readJSON(key, fallback = null) {
  try {
    const value = readStorage(localStorage, key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  return writeStorage(localStorage, key, JSON.stringify(value));
}

function randomToken(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesFromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function encodeInvite(invite) {
  return toBase64Url(JSON.stringify({ v: BATTLE_PROTOCOL, r: invite.roomId, s: invite.secret }));
}

function parseInvite(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("Paste a battle invite link first.");
  let token = input;
  try {
    const url = new URL(input, location.href);
    const match = url.hash.match(/(?:^#|[&#])battle=([^&]+)/);
    if (match) token = decodeURIComponent(match[1]);
  } catch {
    const match = input.match(/battle=([^&\s]+)/);
    if (match) token = match[1];
  }
  if (token.startsWith("#")) token = token.slice(1);
  if (token.startsWith("battle=")) token = token.slice(7);
  let decoded;
  try {
    decoded = JSON.parse(fromBase64Url(token));
  } catch {
    throw new Error("That does not look like a valid battle invite.");
  }
  if (decoded?.v !== BATTLE_PROTOCOL || !/^[a-f0-9]{24,64}$/i.test(decoded.r) || !/^[a-f0-9]{24,64}$/i.test(decoded.s)) {
    throw new Error("That battle invite is invalid or unsupported.");
  }
  return { roomId: decoded.r, secret: decoded.s, token };
}

function inviteUrl(invite) {
  const url = new URL(location.href);
  url.hash = `battle=${encodeInvite(invite)}`;
  return url.href;
}

function roomCode(roomId) {
  return roomId.slice(0, 6).toUpperCase();
}

function cleanName(value) {
  return String(value || "").replace(/[<>\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

function cleanMessage(value) {
  return String(value || "").replace(/[<>\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 220);
}

function initials(name) {
  return cleanName(name).split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function hashNumber(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function makeDeck(cards, cardCount, seed) {
  const random = mulberry32(hashNumber(seed));
  const groups = ["woman", "trans"].map((answer) =>
    seededShuffle(cards.filter((card) => card.labels?.[MODE] === answer), random)
  );
  if (groups.some((group) => group.length < Math.floor(cardCount / 2))) {
    throw new Error("There are not enough portraits for this battle size.");
  }
  const selected = [];
  while (selected.length < cardCount && groups.some((group) => group.length)) {
    for (const group of groups) {
      if (selected.length < cardCount && group.length) selected.push(group.shift());
    }
  }
  return seededShuffle(selected, random).map((card) => card.id);
}

function comboBonus(combo) {
  if (combo >= 10) return 3;
  if (combo >= 5) return 2;
  if (combo >= 3) return 1;
  return 0;
}

function scoreBounds(answered, correct) {
  const safeAnswered = Math.max(0, Math.trunc(Number(answered) || 0));
  const safeCorrect = clamp(Math.trunc(Number(correct) || 0), 0, safeAnswered);
  return {
    minimum: -(safeAnswered - safeCorrect) * MAX_WAGER,
    maximum: safeCorrect * MAX_CORRECT_POINTS,
  };
}

function safeScore(points, answered, correct) {
  const bounds = scoreBounds(answered, correct);
  return clamp(Math.trunc(Number(points) || 0), bounds.minimum, bounds.maximum);
}

function titleStats(result, deckLength) {
  const answered = clamp(Math.trunc(Number(result?.answered) || 0), 0, Math.max(0, deckLength));
  const correct = clamp(Math.trunc(Number(result?.correct) || 0), 0, answered);
  return {
    answered,
    correct,
    accuracy: answered ? correct / answered : 0,
    bestCombo: clamp(Math.trunc(Number(result?.bestCombo) || 0), 0, correct),
    wagerWon: clamp(Math.trunc(Number(result?.wagerWon) || 0), 0, correct * MAX_WAGER),
    wagerLost: clamp(Math.trunc(Number(result?.wagerLost) || 0), 0, (answered - correct) * MAX_WAGER),
  };
}

function earnedTitles(result, deckLength) {
  const stats = titleStats(result, deckLength);
  return BATTLE_TITLES.filter((title) => title.test(stats));
}

function bestTitle(result, deckLength) {
  return earnedTitles(result, deckLength).at(-1) || BATTLE_TITLES[0];
}

function readUnlockedTitles() {
  const stored = readJSON(TITLE_STORAGE_KEY, []);
  const validIds = new Set(BATTLE_TITLES.map((title) => title.id));
  return new Set(Array.isArray(stored) ? stored.filter((id) => validIds.has(id)) : []);
}

function formatClock(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatFinish(milliseconds, timedOut = false) {
  if (timedOut || !Number.isFinite(milliseconds)) return "DNF";
  const totalSeconds = Math.max(0, milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

function focusFor(card) {
  const x = clamp(Number(card?.focus?.x) || 50, 0, 100);
  return `${x}% 0%`;
}

function showToast(message) {
  const toast = el("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

const runtime = {
  invite: null,
  inviteLink: "",
  creator: false,
  manifest: [],
  cardsById: new Map(),
  transport: null,
  identityChannel: null,
  identityLockRelease: null,
  self: null,
  players: new Map(),
  peerPlayers: new Map(),
  roomState: null,
  messages: [],
  reactions: {},
  game: null,
  clockOffset: 0,
  clockSamples: [],
  countdownStarted: false,
  musicStarted: false,
  unread: 0,
  scannerStream: null,
  scannerFrame: null,
  ticker: null,
  stateBroadcastTimer: null,
  disconnectedAt: null,
  lastDiscoveryHello: 0,
  stateReplies: new Map(),
  entering: false,
  hotSeat: null,
  passSetup: { names: ["Player 1", "Player 2"], cardCount: PASS_PHONE_DEFAULT_CARDS, durationSec: PASS_PHONE_DEFAULT_DURATION },
  raceSnapshot: new Map(),
  lastCalloutAt: 0,
  lastCalloutKey: "",
  newlyUnlockedTitles: new Set(),
};

function playerColor(playerId) {
  return PLAYER_COLORS[hashNumber(playerId) % PLAYER_COLORS.length];
}

function selfPresence() {
  const result = runtime.roomState?.results?.[runtime.self.playerId] || {};
  return {
    playerId: runtime.self.playerId,
    name: runtime.self.name,
    color: runtime.self.color,
    joinedAt: runtime.self.joinedAt,
    lastSeen: Date.now(),
    connected: true,
    readyGameId: runtime.self.readyGameId || null,
    progress: Number(result.index ?? runtime.game?.index) || 0,
    points: Number(result.points ?? runtime.game?.points) || 0,
    correct: Number(result.correct ?? runtime.game?.correct) || 0,
    combo: Number(result.combo ?? runtime.game?.combo) || 0,
    bestCombo: Number(result.bestCombo ?? runtime.game?.bestCombo) || 0,
    wagerWon: Number(result.wagerWon ?? runtime.game?.wagerWon) || 0,
    wagerLost: Number(result.wagerLost ?? runtime.game?.wagerLost) || 0,
    finishedAt: result.finishedAt ?? runtime.game?.finishedAt ?? null,
    elapsedMs: result.elapsedMs ?? (runtime.game?.finishedAt ? runtime.game.finishedAt - runtime.roomState.startAt : null),
    timedOut: Boolean(result.timedOut ?? runtime.game?.timedOut),
  };
}

async function resolvePlayerId(roomId, connectionId) {
  const sessionKey = `spot-check:battle-session:${roomId}`;
  const existingSession = readStorage(sessionStorage, sessionKey);
  const primaryKey = `spot-check:battle-player:${roomId}`;
  // A freshly opened tab can inherit sessionStorage from its opener. Probe even
  // when a session id exists so that two simultaneous tabs become two players,
  // while a real refresh still reclaims the same identity after the old page exits.
  const candidate = existingSession || readStorage(localStorage, primaryKey) || randomToken(12);
  if (navigator.locks?.request) {
    const claim = async (playerId) => {
      let releaseLock;
      const acquired = await new Promise((resolve) => {
        navigator.locks.request(`canuspot-battle-player-${roomId}-${playerId}`, { ifAvailable: true }, async (lock) => {
          resolve(Boolean(lock));
          if (lock) await new Promise((release) => { releaseLock = release; });
        }).catch(() => resolve(false));
      });
      if (acquired) runtime.identityLockRelease = () => releaseLock?.();
      return acquired;
    };
    if (await claim(candidate)) {
      writeStorage(sessionStorage, sessionKey, candidate);
      writeStorage(localStorage, primaryKey, candidate);
      return candidate;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const separatePlayer = randomToken(12);
      if (await claim(separatePlayer)) {
        writeStorage(sessionStorage, sessionKey, separatePlayer);
        return separatePlayer;
      }
    }
  }
  if (typeof BroadcastChannel !== "function") {
    writeStorage(sessionStorage, sessionKey, candidate);
    writeStorage(localStorage, primaryKey, candidate);
    return candidate;
  }

  const channel = new BroadcastChannel(`canuspot-battle-identity-${roomId}`);
  let collision = false;
  channel.onmessage = ({ data }) => {
    if (!data || data.connectionId === connectionId || data.candidate !== candidate) return;
    if (data.type === "probe") {
      collision = true;
      channel.postMessage({ type: "active", candidate, connectionId });
    }
    if (data.type === "active") collision = true;
  };
  channel.postMessage({ type: "probe", candidate, connectionId });
  await delay(180);
  channel.close();
  const playerId = collision ? randomToken(12) : candidate;
  writeStorage(sessionStorage, sessionKey, playerId);
  if (!collision) writeStorage(localStorage, primaryKey, playerId);
  return playerId;
}

class BattleTransport {
  constructor(invite, self, onPacket, onPeerLeave) {
    this.invite = invite;
    this.self = self;
    this.onPacket = onPacket;
    this.onPeerLeaveCallback = onPeerLeave;
    this.seen = new Set();
    this.closed = false;
    this.relayBindings = new Map();
    this.relayQueue = [];
    this.relaySendChain = Promise.resolve();
    this.relaySubscriptionId = `canuspot-${randomToken(8)}`;
    this.lastRelayHeartbeatAt = 0;
    this.lastRelayReceivedAt = 0;
    const search = new URLSearchParams(location.search);
    this.relayOnly = search.has("battle-relay-only");
    this.channel = typeof BroadcastChannel === "function" && !search.has("battle-p2p-only") && !this.relayOnly
      ? new BroadcastChannel(`canuspot-battle-data-${invite.roomId}`)
      : null;
    if (this.channel) this.channel.onmessage = ({ data }) => this.receive(data, null);

    this.room = joinRoom({
      appId: APP_ID,
      password: invite.secret,
      relayConfig: { urls: SIGNAL_RELAY_URLS, warnOnRelayFailure: false },
    }, invite.roomId, {
      onJoinError: () => this.onStatus?.("p2p-warning"),
    });
    this.action = this.room.makeAction("battle-packet");
    this.action.onMessage = (data, { peerId }) => this.receive(data, peerId);
    this.room.onPeerJoin = (peerId) => {
      this.onStatus?.("connected");
      this.onPeerJoin?.(peerId);
    };
    this.room.onPeerLeave = (peerId) => {
      this.onPeerLeaveCallback?.(peerId);
      if (Object.keys(this.room.getPeers()).length === 0) {
        this.onStatus?.(this.lastRelayReceivedAt ? "relay-connected" : "discovering");
      }
    };
    this.relayReady = this.initializeRelayFallback();
  }

  async initializeRelayFallback() {
    if (!crypto.subtle) return;
    try {
      const material = `${APP_ID}|${this.invite.roomId}|${this.invite.secret}`;
      const [topicBytes, keyBytes] = await Promise.all([
        sha256Bytes(`topic|${material}`),
        sha256Bytes(`key|${material}`),
      ]);
      if (this.closed) return;
      this.relayTopic = `canuspot-${bytesToBase64Url(topicBytes)}`;
      this.relayKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
      this.syncRelaySockets();
      this.relaySyncTimer = setInterval(() => this.syncRelaySockets(), 1800);
    } catch {
      this.onStatus?.("relay-warning");
    }
  }

  syncRelaySockets() {
    if (this.closed || !this.relayTopic) return;
    const sockets = getRelaySockets();
    this.relayBindings.forEach((binding, url) => {
      if (sockets[url] === binding.socket) return;
      this.detachRelaySocket(url, binding);
    });
    Object.entries(sockets).forEach(([url, socket]) => {
      if (!socket || this.relayBindings.has(url)) return;
      const onOpen = () => {
        this.subscribeRelaySocket(socket);
        this.onStatus?.("relay-ready");
        this.flushRelayQueue();
      };
      const onMessage = (event) => { void this.receiveRelayMessage(event.data); };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("message", onMessage);
      const binding = { socket, onOpen, onMessage };
      this.relayBindings.set(url, binding);
      if (socket.readyState === 1) onOpen();
    });
  }

  subscribeRelaySocket(socket) {
    if (socket.readyState !== 1 || !this.relayTopic) return;
    try { socket.send(subscribe(this.relaySubscriptionId, this.relayTopic)); } catch { /* Another relay remains available. */ }
  }

  detachRelaySocket(url, binding) {
    binding.socket.removeEventListener("open", binding.onOpen);
    binding.socket.removeEventListener("message", binding.onMessage);
    this.relayBindings.delete(url);
  }

  async encryptRelayEnvelope(envelope) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(envelope));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.relayKey, plaintext));
    return `${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
  }

  async decryptRelayEnvelope(content) {
    const [ivPart, ciphertextPart] = String(content || "").split(".");
    if (!ivPart || !ciphertextPart) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesFromBase64Url(ivPart) },
      this.relayKey,
      bytesFromBase64Url(ciphertextPart),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  async receiveRelayMessage(data) {
    if (this.closed || !this.relayKey || !this.relayTopic) return;
    try {
      const [type, subscriptionId, event] = JSON.parse(String(data));
      if (type !== "EVENT" || subscriptionId !== this.relaySubscriptionId || typeof event?.content !== "string") return;
      if (!event.tags?.some((tag) => tag?.[0] === "x" && tag?.[1] === this.relayTopic)) return;
      const envelope = await this.decryptRelayEnvelope(event.content);
      if (!envelope || Math.abs(Date.now() - Number(envelope.sentAt)) > 6 * 60 * 60 * 1000) return;
      this.lastRelayReceivedAt = Date.now();
      this.receive(envelope, null, true);
    } catch {
      // Invalid, expired, or unrelated public relay events are ignored.
    }
  }

  openRelaySockets() {
    return [...this.relayBindings.values()].map((binding) => binding.socket).filter((socket) => socket.readyState === 1);
  }

  queueRelayEnvelope(envelope) {
    this.relaySendChain = this.relaySendChain.then(async () => {
      await this.relayReady;
      if (this.closed || !this.relayKey || !this.relayTopic) return;
      this.syncRelaySockets();
      const sockets = this.openRelaySockets();
      if (sockets.length === 0) {
        this.relayQueue.push(envelope);
        this.relayQueue = this.relayQueue.slice(-30);
        return;
      }
      const event = await createEvent(this.relayTopic, await this.encryptRelayEnvelope(envelope));
      sockets.forEach((socket) => {
        try { socket.send(event); } catch { /* The next heartbeat retries room discovery. */ }
      });
    }).catch(() => {});
  }

  flushRelayQueue() {
    const queued = this.relayQueue.splice(0);
    queued.forEach((envelope) => this.queueRelayEnvelope(envelope));
  }

  receive(envelope, peerId, viaRelay = false) {
    if (!envelope || envelope.roomId !== this.invite.roomId || envelope.connectionId === this.self.connectionId) return;
    if (envelope.target && envelope.target !== this.self.playerId) return;
    if (peerId && envelope.from) runtime.peerPlayers.set(peerId, envelope.from);
    if (this.seen.has(envelope.messageId)) return;
    this.seen.add(envelope.messageId);
    if (this.seen.size > 600) this.seen.delete(this.seen.values().next().value);
    if (viaRelay) this.onStatus?.(this.peerCount() > 0 ? "connected" : "relay-connected");
    this.onPacket(envelope, peerId);
  }

  send(type, payload, target = null) {
    if (this.closed) return;
    const envelope = {
      messageId: randomToken(9),
      roomId: this.invite.roomId,
      type,
      from: this.self.playerId,
      connectionId: this.self.connectionId,
      target,
      sentAt: Date.now(),
      payload,
    };
    this.channel?.postMessage(envelope);
    const targetPeer = target
      ? [...runtime.peerPlayers.entries()].find(([, playerId]) => playerId === target)?.[0]
      : null;
    if (!this.relayOnly) this.action.send(envelope, targetPeer ? { target: targetPeer } : undefined).catch(() => {});
    if (type !== "heartbeat" || Date.now() - this.lastRelayHeartbeatAt >= RELAY_HEARTBEAT_MS) {
      if (type === "heartbeat") this.lastRelayHeartbeatAt = Date.now();
      this.queueRelayEnvelope(envelope);
    }
  }

  peerCount() {
    return Object.keys(this.room.getPeers()).length;
  }

  diagnostics() {
    return {
      p2pPeers: this.peerCount(),
      openRelays: this.openRelaySockets().length,
      relayActive: this.lastRelayReceivedAt > 0,
      localBridge: Boolean(this.channel),
      relayOnly: this.relayOnly,
    };
  }

  async close() {
    this.closed = true;
    clearInterval(this.relaySyncTimer);
    this.relayBindings.forEach((binding, url) => {
      if (binding.socket.readyState === 1) {
        try { binding.socket.send(JSON.stringify(["CLOSE", this.relaySubscriptionId])); } catch { /* Socket already closing. */ }
      }
      this.detachRelaySocket(url, binding);
    });
    this.relayQueue = [];
    this.channel?.close();
    try { await this.room.leave(); } catch { /* Already disconnected. */ }
  }
}

function stateKey() {
  return runtime.invite ? `spot-check:battle-state:${runtime.invite.roomId}` : "";
}

function progressKey() {
  return runtime.invite && runtime.self
    ? `spot-check:battle-progress:${runtime.invite.roomId}:${runtime.self.playerId}`
    : "";
}

function saveRoomState() {
  if (!runtime.roomState) return;
  writeJSON(stateKey(), runtime.roomState);
}

function saveProgress() {
  if (!runtime.game || !progressKey()) return;
  writeJSON(progressKey(), {
    gameId: runtime.game.gameId,
    index: runtime.game.index,
    points: runtime.game.points,
    correct: runtime.game.correct,
    combo: runtime.game.combo,
    bestCombo: runtime.game.bestCombo,
    wagerWon: runtime.game.wagerWon,
    wagerLost: runtime.game.wagerLost,
    answers: runtime.game.answers,
    pendingChoice: runtime.game.pendingChoice,
    questionShownAt: runtime.game.questionShownAt,
    finishedAt: runtime.game.finishedAt,
    elapsedMs: runtime.game.finishedAt ? Math.max(0, runtime.game.finishedAt - runtime.roomState.startAt) : null,
    timedOut: runtime.game.timedOut,
  });
}

function createLobbyState(hostId) {
  return {
    protocol: BATTLE_PROTOCOL,
    roomId: runtime.invite.roomId,
    epoch: 1,
    revision: 1,
    updatedAt: Date.now(),
    hostId,
    viceHostId: null,
    phase: "lobby",
    settings: { cardCount: DEFAULT_CARD_COUNT, durationSec: DEFAULT_DURATION },
    gameId: null,
    seed: null,
    deck: [],
    startAt: null,
    endAt: null,
    musicTune: 0,
    results: {},
    reactions: {},
    messages: [],
  };
}

function validRoomState(state) {
  return state
    && state.protocol === BATTLE_PROTOCOL
    && state.roomId === runtime.invite?.roomId
    && /^[a-f0-9]{24,64}$/i.test(state.hostId || "")
    && ["lobby", "countdown", "playing", "finished"].includes(state.phase)
    && CARD_COUNTS.includes(Number(state.settings?.cardCount))
    && Number(state.settings?.durationSec) >= 30
    && Number(state.settings?.durationSec) <= 3600
    && Array.isArray(state.deck)
    && state.deck.length <= 30;
}

function newerState(incoming, current) {
  if (!current) return true;
  if (Number(incoming.epoch) !== Number(current.epoch)) return Number(incoming.epoch) > Number(current.epoch);
  if (Number(incoming.revision) !== Number(current.revision)) return Number(incoming.revision) > Number(current.revision);
  return Number(incoming.updatedAt) > Number(current.updatedAt);
}

function connectedPlayers() {
  const now = Date.now();
  return [...runtime.players.values()].filter((player) =>
    player.playerId === runtime.self?.playerId || (player.connected && now - player.lastSeen < STALE_PLAYER_MS)
  );
}

function chooseViceHost(hostId = runtime.roomState?.hostId) {
  return connectedPlayers()
    .filter((player) => player.playerId !== hostId)
    .sort((left, right) => left.joinedAt - right.joinedAt || left.playerId.localeCompare(right.playerId))[0]?.playerId || null;
}

function isHost() {
  return Boolean(runtime.self && runtime.roomState?.hostId === runtime.self.playerId);
}

function isViceHost() {
  return Boolean(runtime.self && runtime.roomState?.viceHostId === runtime.self.playerId);
}

function updateSelfResult() {
  if (!runtime.roomState || !runtime.game) return;
  runtime.roomState.results ||= {};
  runtime.roomState.results[runtime.self.playerId] = {
    playerId: runtime.self.playerId,
    name: runtime.self.name,
    index: runtime.game.index,
    points: runtime.game.points,
    correct: runtime.game.correct,
    combo: runtime.game.combo,
    bestCombo: runtime.game.bestCombo,
    wagerWon: runtime.game.wagerWon,
    wagerLost: runtime.game.wagerLost,
    answered: runtime.game.answers.length,
    finishedAt: runtime.game.finishedAt,
    elapsedMs: runtime.game.finishedAt ? Math.max(0, runtime.game.finishedAt - runtime.roomState.startAt) : null,
    timedOut: runtime.game.timedOut,
    lastUpdate: nowHost(),
  };
}

function broadcastState(immediate = false) {
  if (!isHost() || !runtime.roomState) return;
  clearTimeout(runtime.stateBroadcastTimer);
  const send = () => {
    runtime.roomState.updatedAt = Date.now();
    saveRoomState();
    runtime.transport?.send("state", runtime.roomState);
  };
  if (immediate) send();
  else runtime.stateBroadcastTimer = setTimeout(send, 140);
}

function commitHostState(mutator, immediate = true) {
  if (!isHost() || !runtime.roomState) return false;
  mutator(runtime.roomState);
  runtime.roomState.revision = Number(runtime.roomState.revision || 0) + 1;
  runtime.roomState.updatedAt = Date.now();
  saveRoomState();
  broadcastState(immediate);
  renderLobby();
  return true;
}

function mergePlayer(presence) {
  if (!presence || !/^[a-f0-9]{24,64}$/i.test(presence.playerId || "")) return;
  const previous = runtime.players.get(presence.playerId) || {};
  const player = {
    ...previous,
    ...presence,
    name: cleanName(presence.name) || previous.name || "Player",
    color: /^#[a-f0-9]{6}$/i.test(presence.color || "") ? presence.color : playerColor(presence.playerId),
    joinedAt: Number(presence.joinedAt) || previous.joinedAt || Date.now(),
    lastSeen: Date.now(),
    connected: true,
  };
  runtime.players.set(player.playerId, player);
  if (runtime.roomState) {
    runtime.roomState.results ||= {};
    const currentResult = runtime.roomState.results[player.playerId];
    if (currentResult) currentResult.name = player.name;
    if (runtime.roomState.gameId && presence.readyGameId === runtime.roomState.gameId) {
      const index = clamp(Math.trunc(Number(presence.progress) || 0), 0, runtime.roomState.deck.length);
      const correct = clamp(Math.trunc(Number(presence.correct) || 0), 0, index);
      const points = safeScore(presence.points, index, correct);
      const combo = clamp(Math.trunc(Number(presence.combo) || 0), 0, correct);
      const bestCombo = clamp(Math.trunc(Number(presence.bestCombo) || 0), combo, correct);
      const wagerWon = clamp(Math.trunc(Number(presence.wagerWon) || 0), 0, correct * MAX_WAGER);
      const wagerLost = clamp(Math.trunc(Number(presence.wagerLost) || 0), 0, (index - correct) * MAX_WAGER);
      const proposedFinish = Number(presence.finishedAt);
      const timedOut = Boolean(presence.timedOut || currentResult?.timedOut);
      const finishIsPlausible = Number.isFinite(proposedFinish)
        && proposedFinish >= runtime.roomState.startAt - 1000
        && proposedFinish <= Math.max(nowHost() + 5000, runtime.roomState.endAt + 5000)
        && (index === runtime.roomState.deck.length || timedOut);
      const finishedAt = finishIsPlausible ? proposedFinish : currentResult?.finishedAt || null;
      const advances = !currentResult
        || index > Number(currentResult.index || 0)
        || (index === Number(currentResult.index || 0)
          && (points >= Number(currentResult.points || 0) || finishedAt || timedOut));
      if (advances) {
        runtime.roomState.results[player.playerId] = {
          ...currentResult,
          playerId: player.playerId,
          name: player.name,
          index,
          points,
          correct,
          combo,
          bestCombo,
          wagerWon,
          wagerLost,
          answered: index,
          finishedAt,
          elapsedMs: finishedAt ? clamp(Number(presence.elapsedMs) || finishedAt - runtime.roomState.startAt, 0, runtime.roomState.settings.durationSec * 1000) : null,
          timedOut,
          lastUpdate: nowHost(),
        };
      }
    }
  }
  if (isHost()) {
    const nextVice = chooseViceHost();
    if (nextVice !== runtime.roomState.viceHostId) {
      runtime.roomState.viceHostId = nextVice;
      runtime.roomState.revision += 1;
      broadcastState();
    }
  }
  renderPlayers();
  renderRace();
  renderRivalCallout();
}

function acceptState(incoming, senderId) {
  if (!validRoomState(incoming)) return;
  if (!runtime.roomState && senderId !== incoming.hostId) return;
  const senderCanLead = senderId === incoming.hostId || !runtime.roomState;
  if (!senderCanLead && newerState(incoming, runtime.roomState)) {
    const expected = runtime.roomState?.viceHostId;
    if (incoming.epoch <= runtime.roomState.epoch || (expected && incoming.hostId !== expected)) return;
  }
  if (!newerState(incoming, runtime.roomState)) return;
  runtime.roomState = structuredClone(incoming);
  runtime.messages = Array.isArray(incoming.messages) ? incoming.messages.slice(-CHAT_LIMIT) : runtime.messages;
  runtime.reactions = incoming.reactions && typeof incoming.reactions === "object" ? incoming.reactions : {};
  saveRoomState();
  if (runtime.roomState.hostId === runtime.self.playerId) runtime.clockOffset = 0;
  else syncClock();
  applyRoomPhase();
  renderLobby();
  renderChat();
  renderPlayers();
  renderRace();
}

function receiveProgress(progress) {
  if (!runtime.roomState || !progress || progress.gameId !== runtime.roomState.gameId) return;
  if (!/^[a-f0-9]{24,64}$/i.test(progress.playerId || "")) return;
  const deckLength = runtime.roomState.deck.length;
  const safeIndex = clamp(Math.trunc(Number(progress.index) || 0), 0, deckLength);
  const safeAnswered = clamp(Math.trunc(Number(progress.answered) || 0), 0, safeIndex);
  const safeCorrect = clamp(Math.trunc(Number(progress.correct) || 0), 0, safeAnswered);
  const safeCombo = clamp(Math.trunc(Number(progress.combo) || 0), 0, safeCorrect);
  const proposedFinish = Number(progress.finishedAt);
  const finishIsPlausible = Number.isFinite(proposedFinish)
    && proposedFinish >= runtime.roomState.startAt - 1000
    && proposedFinish <= Math.max(nowHost() + 5000, runtime.roomState.endAt + 5000);
  const safe = {
    playerId: progress.playerId,
    name: cleanName(progress.name) || runtime.players.get(progress.playerId)?.name || "Player",
    index: safeIndex,
    points: safeScore(progress.points, safeAnswered, safeCorrect),
    correct: safeCorrect,
    combo: safeCombo,
    bestCombo: clamp(Math.trunc(Number(progress.bestCombo) || 0), safeCombo, safeCorrect),
    wagerWon: clamp(Math.trunc(Number(progress.wagerWon) || 0), 0, safeCorrect * MAX_WAGER),
    wagerLost: clamp(Math.trunc(Number(progress.wagerLost) || 0), 0, (safeAnswered - safeCorrect) * MAX_WAGER),
    answered: safeAnswered,
    finishedAt: finishIsPlausible && (safeIndex === deckLength || progress.timedOut) ? proposedFinish : null,
    elapsedMs: finishIsPlausible && (safeIndex === deckLength || progress.timedOut)
      ? clamp(Number(progress.elapsedMs) || proposedFinish - runtime.roomState.startAt, 0, runtime.roomState.settings.durationSec * 1000)
      : null,
    timedOut: Boolean(progress.timedOut),
    lastUpdate: nowHost(),
  };
  const current = runtime.roomState.results?.[safe.playerId];
  if (current && (safe.index < current.index
    || (safe.index === current.index && safe.points < Number(current.points || 0)))) return;
  runtime.roomState.results ||= {};
  runtime.roomState.results[safe.playerId] = safe;
  const player = runtime.players.get(safe.playerId);
  if (player) mergePlayer({ ...player, progress: safe.index, points: safe.points, correct: safe.correct, finishedAt: safe.finishedAt, timedOut: safe.timedOut });
  if (isHost()) broadcastState();
  renderRace();
  renderLeaderboard();
  renderRivalCallout();
}

function receiveChat(message) {
  if (!message || !message.id || runtime.messages.some((item) => item.id === message.id)) return;
  const text = cleanMessage(message.text);
  if (!text) return;
  const safe = {
    id: String(message.id).slice(0, 40),
    playerId: String(message.playerId || "").slice(0, 64),
    name: cleanName(message.name) || "Player",
    color: /^#[a-f0-9]{6}$/i.test(message.color || "") ? message.color : playerColor(message.playerId || "0"),
    text,
    at: Number(message.at) || nowHost(),
  };
  runtime.messages.push(safe);
  runtime.messages = runtime.messages.slice(-CHAT_LIMIT);
  if (runtime.roomState) runtime.roomState.messages = runtime.messages;
  if (isHost()) broadcastState();
  if (el("[data-screen='battle-game']")?.classList.contains("is-active") && el("#battle-game-chat")?.hidden) {
    runtime.unread += 1;
    el("#battle-unread").textContent = runtime.unread;
  }
  renderChat();
}

function receiveReaction(reaction) {
  if (!runtime.roomState || reaction?.gameId !== runtime.roomState.gameId || !REACTIONS.has(reaction.emoji)) return;
  if (!runtime.roomState.deck.includes(reaction.cardId)) return;
  runtime.reactions[reaction.cardId] ||= {};
  runtime.reactions[reaction.cardId][reaction.playerId] = reaction.emoji;
  runtime.roomState.reactions = runtime.reactions;
  if (isHost()) broadcastState();
  renderCardReactions();
}

function sendAuthoritativeStateTo(playerId, force = false) {
  if (!isHost() || !runtime.roomState || !playerId || playerId === runtime.self.playerId) return;
  const previous = Number(runtime.stateReplies.get(playerId)) || 0;
  if (!force && Date.now() - previous < 4500) return;
  runtime.stateReplies.set(playerId, Date.now());
  runtime.transport?.send("state", runtime.roomState, playerId);
}

function onPacket(envelope, peerId) {
  if (peerId) runtime.peerPlayers.set(peerId, envelope.from);
  const { type, payload, from } = envelope;
  if (type === "hello") {
    mergePlayer(payload?.presence);
    runtime.transport.send("presence", selfPresence(), from);
    sendAuthoritativeStateTo(from, true);
    if (runtime.roomState?.hostId === runtime.self.playerId) {
      runtime.transport.send("clock-pong", { pingId: payload?.pingId, clientSentAt: payload?.clientSentAt, hostNow: Date.now() }, from);
    }
  } else if (type === "presence" || type === "heartbeat") {
    mergePlayer(payload);
    sendAuthoritativeStateTo(from);
  } else if (type === "state") {
    acceptState(payload, from);
  } else if (type === "progress") {
    receiveProgress(payload);
  } else if (type === "chat") {
    receiveChat(payload);
  } else if (type === "reaction") {
    receiveReaction(payload);
  } else if (type === "clock-ping" && isHost()) {
    runtime.transport.send("clock-pong", { pingId: payload.pingId, clientSentAt: payload.clientSentAt, hostNow: Date.now() }, from);
  } else if (type === "clock-pong" && from === runtime.roomState?.hostId) {
    const receivedAt = Date.now();
    const roundTrip = Math.max(0, receivedAt - Number(payload.clientSentAt));
    const offset = Number(payload.hostNow) + roundTrip / 2 - receivedAt;
    if (Number.isFinite(offset) && roundTrip < 5000) {
      runtime.clockSamples.push({ offset, roundTrip });
      runtime.clockSamples = runtime.clockSamples.sort((a, b) => a.roundTrip - b.roundTrip).slice(0, 5);
      runtime.clockOffset = runtime.clockSamples[0].offset;
    }
  } else if (type === "depart") {
    const player = runtime.players.get(from);
    if (player) runtime.players.set(from, { ...player, connected: false, lastSeen: 0 });
    if (from === runtime.roomState?.hostId) scheduleHostElection(true);
    renderPlayers();
  }
}

function syncClock() {
  const hostId = runtime.roomState?.hostId;
  if (!hostId || hostId === runtime.self?.playerId) {
    runtime.clockOffset = 0;
    return;
  }
  runtime.clockSamples = [];
  [0, 260, 620].forEach((wait) => setTimeout(() => {
    runtime.transport?.send("clock-ping", { pingId: randomToken(5), clientSentAt: Date.now() }, hostId);
  }, wait));
}

function nowHost() {
  return Date.now() + runtime.clockOffset;
}

function scheduleHostElection(immediate = false) {
  if (!runtime.roomState || runtime.roomState.hostId === runtime.self.playerId) return;
  if (scheduleHostElection.timer && !immediate) return;
  clearTimeout(scheduleHostElection.timer);
  scheduleHostElection.timer = setTimeout(() => {
    scheduleHostElection.timer = null;
    const currentHost = runtime.players.get(runtime.roomState?.hostId);
    if (currentHost?.connected && Date.now() - currentHost.lastSeen <= HOST_GRACE_MS) return;
    const candidates = connectedPlayers();
    const vice = runtime.roomState.viceHostId;
    const winner = candidates.find((player) => player.playerId === vice)
      || candidates.sort((left, right) => left.joinedAt - right.joinedAt || left.playerId.localeCompare(right.playerId))[0];
    if (winner?.playerId === runtime.self.playerId) promoteSelfToHost();
  }, immediate ? 250 : HOST_GRACE_MS);
}

function promoteSelfToHost() {
  if (!runtime.roomState) return;
  const previousOffset = runtime.clockOffset;
  const state = runtime.roomState;
  if (Number.isFinite(state.startAt)) state.startAt -= previousOffset;
  if (Number.isFinite(state.endAt)) state.endAt -= previousOffset;
  Object.values(state.results || {}).forEach((result) => {
    if (Number.isFinite(result.finishedAt)) result.finishedAt -= previousOffset;
    if (Number.isFinite(result.lastUpdate)) result.lastUpdate -= previousOffset;
  });
  state.epoch = Number(state.epoch || 0) + 1;
  state.revision = 1;
  state.hostId = runtime.self.playerId;
  runtime.clockOffset = 0;
  state.viceHostId = chooseViceHost(state.hostId);
  state.updatedAt = Date.now();
  saveRoomState();
  broadcastState(true);
  addSystemMessage(`${runtime.self.name} became host after the previous host left.`);
  renderLobby();
}

function onPeerLeave(peerId) {
  const playerId = runtime.peerPlayers.get(peerId);
  runtime.peerPlayers.delete(peerId);
  if (!playerId) return;
  const player = runtime.players.get(playerId);
  if (player) runtime.players.set(playerId, { ...player, connected: false, lastSeen: Date.now() });
  if (playerId === runtime.roomState?.hostId) scheduleHostElection();
  renderPlayers();
}

function addSystemMessage(text) {
  const message = { id: `system-${randomToken(6)}`, playerId: "system", name: "", color: "#ffd62e", text: cleanMessage(text), at: nowHost(), system: true };
  runtime.messages.push(message);
  runtime.messages = runtime.messages.slice(-CHAT_LIMIT);
  if (runtime.roomState) runtime.roomState.messages = runtime.messages;
  renderChat();
}

function setConnectionStatus(label, live = false) {
  const status = el("#battle-connection");
  if (!status) return;
  status.textContent = label;
  status.classList.toggle("is-live", live);
}

function showBattleScreen(name) {
  all(".screen").forEach((screen) => {
    const active = screen.dataset.screen === name;
    screen.classList.toggle("is-active", active);
    screen.setAttribute("aria-hidden", String(!active));
  });
  document.body.classList.add("battle-mode");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "battle-lobby") window.SpotCheckMusic?.setScene("waiting");
  if (name === "battle-results") window.SpotCheckMusic?.setScene("results");
}

function showSoloHome() {
  all(".screen").forEach((screen) => {
    const active = screen.dataset.screen === "intro";
    screen.classList.toggle("is-active", active);
    screen.setAttribute("aria-hidden", String(!active));
  });
  document.body.classList.remove("battle-mode", "pass-phone-mode");
  window.SpotCheckMusic?.setScene("waiting");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadManifest() {
  if (runtime.manifest.length) return runtime.manifest;
  const response = await fetch("assets/manifest.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Portraits could not be loaded.");
  runtime.manifest = await response.json();
  runtime.cardsById = new Map(runtime.manifest.map((card) => [card.id, card]));
  return runtime.manifest;
}

function passPhoneNamesFromUi() {
  return all("#pass-phone-player-list input").map((input, index) =>
    cleanName(input.value) || `Player ${index + 1}`
  );
}

function syncPassPhoneSetupFromUi() {
  runtime.passSetup.names = passPhoneNamesFromUi();
  const timer = el("#pass-phone-timer");
  if (timer) runtime.passSetup.durationSec = clamp(Number(timer.value) || runtime.passSetup.durationSec, 60, 180);
}

function renderPassPhoneSetup() {
  const list = el("#pass-phone-player-list");
  if (!list) return;
  list.replaceChildren(...runtime.passSetup.names.map((name, index) => {
    const row = document.createElement("label");
    row.className = "pass-phone-player-row";
    const avatar = document.createElement("span");
    avatar.style.setProperty("--player-color", PLAYER_COLORS[index % PLAYER_COLORS.length]);
    avatar.textContent = String(index + 1);
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 24;
    input.autocomplete = "off";
    input.value = name;
    input.setAttribute("aria-label", `Player ${index + 1} name`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.battleAction = `pass-remove-${index}`;
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.textContent = "×";
    remove.disabled = runtime.passSetup.names.length <= PASS_PHONE_MIN_PLAYERS;
    row.append(avatar, input, remove);
    return row;
  }));
  el("#pass-phone-player-count").textContent = `${runtime.passSetup.names.length} / ${PASS_PHONE_MAX_PLAYERS}`;
  el("#pass-phone-card-count").textContent = runtime.passSetup.cardCount;
  el("#pass-phone-timer").value = String(runtime.passSetup.durationSec);
  const add = el("[data-battle-action='pass-add-player']");
  if (add) add.disabled = runtime.passSetup.names.length >= PASS_PHONE_MAX_PLAYERS;
}

async function openPassPhoneSetup() {
  await leaveBattle({ goHome: false, clearHash: true });
  await loadManifest();
  const stored = readJSON("spot-check:pass-phone-players", []);
  const names = Array.isArray(stored) ? stored.map(cleanName).filter(Boolean).slice(0, PASS_PHONE_MAX_PLAYERS) : [];
  runtime.passSetup.names = names.length >= PASS_PHONE_MIN_PLAYERS ? names : ["Player 1", "Player 2"];
  document.body.classList.add("pass-phone-mode");
  showBattleScreen("pass-phone-setup");
  renderPassPhoneSetup();
  window.SpotCheckMusic?.unlock().catch(() => {});
}

function startPassPhoneBattle() {
  runtime.passSetup.names = passPhoneNamesFromUi();
  runtime.passSetup.durationSec = clamp(Number(el("#pass-phone-timer").value) || PASS_PHONE_DEFAULT_DURATION, 60, 180);
  const folded = runtime.passSetup.names.map((name) => name.toLocaleLowerCase());
  if (new Set(folded).size !== folded.length) {
    showToast("Give everyone a different name. Yes, even the twins.");
    return;
  }
  writeJSON("spot-check:pass-phone-players", runtime.passSetup.names);
  const seed = randomToken(16);
  let baseDeck;
  try {
    baseDeck = makeDeck(runtime.manifest, runtime.passSetup.cardCount, seed);
  } catch (error) {
    showToast(error.message);
    return;
  }
  const players = runtime.passSetup.names.map((name, index) => {
    const playerId = randomToken(12);
    return {
      playerId,
      name,
      color: PLAYER_COLORS[index % PLAYER_COLORS.length],
      joinedAt: Date.now() + index,
      lastSeen: Date.now(),
      connected: true,
      readyGameId: null,
      progress: 0,
      points: 0,
      correct: 0,
    };
  });
  const usedOrders = new Set();
  const decks = {};
  players.forEach((player, playerIndex) => {
    let deck = seededShuffle(baseDeck, mulberry32(hashNumber(`${seed}:${player.playerId}`)));
    for (let offset = 1; usedOrders.has(deck.join("|")) && offset < deck.length; offset += 1) {
      const shift = (playerIndex + offset) % deck.length;
      deck = [...deck.slice(shift), ...deck.slice(0, shift)];
    }
    usedOrders.add(deck.join("|"));
    decks[player.playerId] = deck;
  });
  runtime.hotSeat = {
    seed,
    players,
    decks,
    currentIndex: 0,
    durationSec: runtime.passSetup.durationSec,
    cardCount: runtime.passSetup.cardCount,
  };
  runtime.invite = null;
  runtime.transport = null;
  runtime.players = new Map(players.map((player) => [player.playerId, player]));
  runtime.self = players[0];
  runtime.roomState = {
    protocol: BATTLE_PROTOCOL,
    roomId: `local-${seed}`,
    epoch: 1,
    revision: 1,
    updatedAt: Date.now(),
    hostId: players[0].playerId,
    viceHostId: players[1]?.playerId || null,
    phase: "handoff",
    settings: { cardCount: runtime.passSetup.cardCount, durationSec: runtime.passSetup.durationSec },
    gameId: null,
    seed,
    deck: [],
    startAt: null,
    endAt: null,
    musicTune: hashNumber(seed) % 2,
    results: {},
    reactions: {},
    messages: [],
  };
  runtime.messages = [];
  runtime.reactions = {};
  runtime.clockOffset = 0;
  runtime.clockSamples = [];
  runtime.raceSnapshot = new Map();
  runtime.newlyUnlockedTitles = new Set();
  clearInterval(runtime.ticker);
  runtime.ticker = setInterval(tickBattle, 200);
  showPassPhoneHandoff();
}

function showPassPhoneHandoff() {
  const party = runtime.hotSeat;
  if (!party) return;
  const player = party.players[party.currentIndex];
  runtime.self = player;
  runtime.game = null;
  runtime.roomState.phase = "handoff";
  runtime.roomState.deck = party.decks[player.playerId];
  runtime.musicStarted = false;
  el("#pass-phone-turn-label").textContent = `Player ${party.currentIndex + 1} of ${party.players.length}`;
  el("#pass-phone-handoff-name").textContent = player.name;
  el("#pass-phone-handoff-roast").textContent = HANDOFF_ROASTS[party.currentIndex % HANDOFF_ROASTS.length];
  showBattleScreen("pass-phone-handoff");
  window.SpotCheckMusic?.setScene("waiting");
}

function beginPassPhoneTurn() {
  const party = runtime.hotSeat;
  if (!party || runtime.roomState.phase !== "handoff") return;
  const player = party.players[party.currentIndex];
  const startAt = Date.now();
  runtime.self = player;
  runtime.roomState.phase = "playing";
  runtime.roomState.gameId = randomToken(10);
  runtime.roomState.deck = party.decks[player.playerId];
  runtime.roomState.startAt = startAt;
  runtime.roomState.endAt = startAt + party.durationSec * 1000;
  runtime.roomState.musicTune = (hashNumber(party.seed) + party.currentIndex) % 2;
  runtime.musicStarted = false;
  prepareGame(true);
  beginGame();
  renderRivalCallout(true);
}

function finishHotSeatTurn() {
  const party = runtime.hotSeat;
  if (!party || !runtime.self || !runtime.game) return;
  const stored = runtime.players.get(runtime.self.playerId) || runtime.self;
  runtime.players.set(runtime.self.playerId, {
    ...stored,
    progress: runtime.game.index,
    points: runtime.game.points,
    correct: runtime.game.correct,
    finishedAt: runtime.game.finishedAt,
    timedOut: runtime.game.timedOut,
  });
  party.currentIndex += 1;
  if (party.currentIndex < party.players.length) {
    showPassPhoneHandoff();
    return;
  }
  runtime.roomState.phase = "finished";
  showBattleResults();
}

function setupIdentityResponder(roomId) {
  runtime.identityChannel?.close();
  if (typeof BroadcastChannel !== "function") return;
  runtime.identityChannel = new BroadcastChannel(`canuspot-battle-identity-${roomId}`);
  runtime.identityChannel.onmessage = ({ data }) => {
    if (data?.type === "probe" && data.candidate === runtime.self?.playerId && data.connectionId !== runtime.self.connectionId) {
      runtime.identityChannel.postMessage({ type: "active", candidate: data.candidate, connectionId: runtime.self.connectionId });
    }
  };
}

function restoreCachedState() {
  const cached = readJSON(stateKey());
  if (!validRoomState(cached)) return null;
  return cached;
}

async function connectToRoom(invite, creator = false) {
  if (runtime.entering) return;
  runtime.entering = true;
  try {
    await leaveBattle({ goHome: false, clearHash: false });
    document.body.classList.remove("pass-phone-mode");
    runtime.invite = invite;
    runtime.inviteLink = inviteUrl(invite);
    runtime.creator = creator;
    await loadManifest();
    const connectionId = randomToken(10);
    const playerId = await resolvePlayerId(invite.roomId, connectionId);
    const savedName = cleanName(readStorage(localStorage, "spot-check:battle-name"));
    const savedIdentity = readJSON(`spot-check:battle-identity:${invite.roomId}:${playerId}`, {});
    runtime.self = {
      playerId,
      connectionId,
      name: savedName || cleanName(savedIdentity.name) || `Player ${playerId.slice(0, 4).toUpperCase()}`,
      color: playerColor(playerId),
      joinedAt: Number(savedIdentity.joinedAt) || Date.now(),
      readyGameId: null,
    };
    writeJSON(`spot-check:battle-identity:${invite.roomId}:${playerId}`, { name: runtime.self.name, joinedAt: runtime.self.joinedAt });
    setupIdentityResponder(invite.roomId);
    runtime.players = new Map();
    runtime.peerPlayers = new Map();
    runtime.messages = [];
    runtime.reactions = {};
    runtime.clockOffset = 0;
    runtime.clockSamples = [];
    runtime.lastDiscoveryHello = 0;
    runtime.stateReplies = new Map();
    runtime.raceSnapshot = new Map();
    runtime.lastCalloutAt = 0;
    runtime.lastCalloutKey = "";
    runtime.newlyUnlockedTitles = new Set();
    runtime.game = null;
    runtime.countdownStarted = false;
    runtime.musicStarted = false;
    mergePlayer(selfPresence());

    runtime.roomState = creator ? createLobbyState(playerId) : restoreCachedState();
    if (runtime.roomState) {
      runtime.messages = Array.isArray(runtime.roomState.messages) ? runtime.roomState.messages.slice(-CHAT_LIMIT) : [];
      runtime.reactions = runtime.roomState.reactions || {};
    }

    runtime.transport = new BattleTransport(invite, runtime.self, onPacket, onPeerLeave);
    runtime.transport.onStatus = (status) => {
      if (status === "connected") setConnectionStatus("P2P live", true);
      else if (status === "relay-connected") setConnectionStatus("Relay live", true);
      else if (status === "relay-ready") setConnectionStatus("Room ready", true);
      else if (status === "p2p-warning") setConnectionStatus("Relay fallback", true);
      else if (status === "relay-warning") setConnectionStatus("Reconnecting", false);
      else setConnectionStatus("Finding players", false);
    };
    runtime.transport.onPeerJoin = (peerId) => {
      runtime.transport.send("hello", { presence: selfPresence(), clientSentAt: Date.now(), pingId: randomToken(5) });
      if (isHost()) runtime.transport.send("state", runtime.roomState);
      setConnectionStatus("P2P live", true);
    };
    setConnectionStatus("P2P live", false);
    runtime.transport.send("hello", { presence: selfPresence(), clientSentAt: Date.now(), pingId: randomToken(5) });
    if (creator) {
      saveRoomState();
      broadcastState(true);
      addSystemMessage(`${runtime.self.name} created the party.`);
    } else if (runtime.roomState) {
      applyRoomPhase();
    } else {
      setTimeout(() => {
        if (!runtime.roomState && runtime.invite?.roomId === invite.roomId) {
          setConnectionStatus("Finding host · retrying", false);
          runtime.transport?.send("hello", { presence: selfPresence(), clientSentAt: Date.now(), pingId: randomToken(5) });
          showToast("Still finding the host. Keep both browsers open; reconnecting automatically.");
          renderLobby();
        }
      }, 12000);
    }

    const url = new URL(location.href);
    url.hash = `battle=${encodeInvite(invite)}`;
    history.replaceState(null, "", url);
    el("#battle-entry").hidden = true;
    el("#battle-room").hidden = false;
    el("#battle-name").value = runtime.self.name;
    el("#battle-room-code").textContent = roomCode(invite.roomId);
    await QRCode.toCanvas(el("#battle-qr"), runtime.inviteLink, {
      width: 232,
      margin: 1,
      color: { dark: "#151505", light: "#fffdf1" },
      errorCorrectionLevel: "M",
    });
    showBattleScreen("battle-lobby");
    renderLobby();
    renderChat();
    clearInterval(runtime.ticker);
    runtime.ticker = setInterval(tickBattle, 200);
    window.SpotCheckMusic?.unlock().catch(() => {});
  } catch (error) {
    showToast(error.message || "Could not join that battle room.");
    if (!runtime.transport) {
      el("#battle-entry").hidden = false;
      el("#battle-room").hidden = true;
      showBattleScreen("battle-lobby");
    }
  } finally {
    runtime.entering = false;
  }
}

async function leaveBattle({ goHome = true, clearHash = true } = {}) {
  stopScanner();
  clearInterval(runtime.ticker);
  clearTimeout(runtime.stateBroadcastTimer);
  clearTimeout(scheduleHostElection.timer);
  if (runtime.transport) {
    if (isHost()) {
      const successor = chooseViceHost(runtime.self.playerId);
      if (successor && runtime.roomState) {
        runtime.roomState.epoch += 1;
        runtime.roomState.revision = 1;
        runtime.roomState.hostId = successor;
        runtime.roomState.viceHostId = connectedPlayers()
          .filter((player) => ![runtime.self.playerId, successor].includes(player.playerId))
          .sort((left, right) => left.joinedAt - right.joinedAt || left.playerId.localeCompare(right.playerId))[0]?.playerId || null;
        runtime.roomState.updatedAt = nowHost();
        runtime.transport.send("state", runtime.roomState);
        await delay(80);
      }
    }
    runtime.transport.send("depart", { at: nowHost() });
    await runtime.transport.close();
  }
  runtime.identityChannel?.close();
  runtime.identityChannel = null;
  runtime.identityLockRelease?.();
  runtime.identityLockRelease = null;
  runtime.transport = null;
  runtime.invite = null;
  runtime.roomState = null;
  runtime.self = null;
  runtime.game = null;
  runtime.hotSeat = null;
  runtime.players = new Map();
  runtime.raceSnapshot = new Map();
  runtime.newlyUnlockedTitles = new Set();
  document.body.classList.remove("pass-phone-mode");
  if (clearHash && location.hash.includes("battle=")) history.replaceState(null, "", `${location.pathname}${location.search}`);
  if (goHome) showSoloHome();
}

function updateSettings(patch) {
  if (!isHost() || runtime.roomState.phase !== "lobby") return;
  commitHostState((state) => {
    state.settings = { ...state.settings, ...patch };
  });
}

function preloadDeck(deck) {
  deck.slice(0, 6).forEach((id) => {
    const card = runtime.cardsById.get(id);
    if (!card) return;
    const image = new Image();
    image.src = card.src;
  });
  const rest = () => deck.slice(6).forEach((id) => {
    const card = runtime.cardsById.get(id);
    if (!card) return;
    const image = new Image();
    image.src = card.src;
  });
  if ("requestIdleCallback" in window) requestIdleCallback(rest, { timeout: 3000 });
  else setTimeout(rest, 700);
}

function startBattle() {
  if (!isHost() || runtime.roomState.phase !== "lobby") return;
  const seed = randomToken(16);
  let deck;
  try {
    deck = makeDeck(runtime.manifest, runtime.roomState.settings.cardCount, seed);
  } catch (error) {
    showToast(error.message);
    return;
  }
  const startAt = Date.now() + COUNTDOWN_MS;
  commitHostState((state) => {
    state.phase = "countdown";
    state.gameId = randomToken(10);
    state.seed = seed;
    state.deck = deck;
    state.startAt = startAt;
    state.endAt = startAt + state.settings.durationSec * 1000;
    state.musicTune = hashNumber(seed) % 2;
    state.results = {};
    state.reactions = {};
  }, true);
  runtime.messages = runtime.messages.slice(-CHAT_LIMIT);
  runtime.reactions = {};
  runtime.raceSnapshot = new Map();
  runtime.lastCalloutAt = 0;
  runtime.lastCalloutKey = "";
  runtime.newlyUnlockedTitles = new Set();
  runtime.roomState.messages = runtime.messages;
  preloadDeck(deck);
  prepareGame(true);
  applyRoomPhase();
}

function prepareGame(forceReset = false) {
  const state = runtime.roomState;
  if (!state?.gameId) return;
  const saved = readJSON(progressKey());
  const canRestore = !forceReset && saved?.gameId === state.gameId;
  const savedAnswers = canRestore && Array.isArray(saved.answers) ? saved.answers.slice(0, state.deck.length) : [];
  const restoredCorrect = clamp(Number(saved?.correct) || 0, 0, savedAnswers.length);
  const pendingChoice = canRestore
    && saved?.pendingChoice?.cardId === state.deck[savedAnswers.length]
    && ["woman", "trans"].includes(saved.pendingChoice.choice)
      ? {
        cardId: saved.pendingChoice.cardId,
        choice: saved.pendingChoice.choice,
        responseMs: clamp(Number(saved.pendingChoice.responseMs) || 0, 0, state.settings.durationSec * 1000),
      }
      : null;
  runtime.game = canRestore ? {
    gameId: state.gameId,
    index: savedAnswers.length,
    points: safeScore(saved.points, savedAnswers.length, restoredCorrect),
    correct: restoredCorrect,
    combo: clamp(Number(saved.combo) || 0, 0, restoredCorrect),
    bestCombo: clamp(Number(saved.bestCombo) || 0, 0, restoredCorrect),
    wagerWon: clamp(Number(saved.wagerWon) || 0, 0, restoredCorrect * MAX_WAGER),
    wagerLost: clamp(Number(saved.wagerLost) || 0, 0, (savedAnswers.length - restoredCorrect) * MAX_WAGER),
    answers: savedAnswers,
    pendingChoice,
    questionShownAt: Number(saved.questionShownAt) || null,
    finishedAt: Number(saved.finishedAt) || null,
    timedOut: Boolean(saved.timedOut),
    locked: true,
  } : {
    gameId: state.gameId,
    index: 0,
    points: 0,
    correct: 0,
    combo: 0,
    bestCombo: 0,
    wagerWon: 0,
    wagerLost: 0,
    answers: [],
    pendingChoice: null,
    questionShownAt: null,
    finishedAt: null,
    timedOut: false,
    locked: true,
  };
  runtime.self.readyGameId = state.gameId;
  updateSelfResult();
  mergePlayer(selfPresence());
  runtime.transport?.send("presence", selfPresence());
  runtime.transport?.send("progress", runtime.roomState.results[runtime.self.playerId]);
  saveProgress();
}

function applyRoomPhase() {
  const state = runtime.roomState;
  if (!state) return;
  if (state.phase === "lobby") {
    runtime.game = null;
    runtime.countdownStarted = false;
    runtime.musicStarted = false;
    showBattleScreen("battle-lobby");
  } else if (state.phase === "countdown") {
    if (!runtime.game || runtime.game.gameId !== state.gameId) prepareGame(false);
    preloadDeck(state.deck);
    runtime.countdownStarted = true;
    showBattleScreen("battle-countdown");
  } else if (state.phase === "playing") {
    if (!runtime.game || runtime.game.gameId !== state.gameId) prepareGame(false);
    beginGame();
  } else if (state.phase === "finished") {
    if (!runtime.game || runtime.game.gameId !== state.gameId) prepareGame(false);
    showBattleResults();
  }
}

function beginGame() {
  if (!runtime.roomState || !runtime.game) return;
  if (runtime.game.finishedAt || runtime.game.timedOut || runtime.game.index >= runtime.roomState.deck.length) {
    showBattleResults();
    return;
  }
  showBattleScreen("battle-game");
  if (!runtime.musicStarted) {
    runtime.musicStarted = true;
    const localMusicEpoch = runtime.roomState.startAt - runtime.clockOffset;
    window.SpotCheckMusic?.setSynchronizedScene?.("battle", runtime.roomState.musicTune, localMusicEpoch);
    window.SpotCheckMusic?.unlock().then(() => {
      window.SpotCheckMusic?.syncToEpoch?.(localMusicEpoch);
    }).catch(() => {});
  }
  renderBattleCard();
  renderRace();
}

function renderBattleCard() {
  if (!runtime.game || !runtime.roomState) return;
  const cardId = runtime.roomState.deck[runtime.game.index];
  const card = runtime.cardsById.get(cardId);
  if (!card) {
    finishLocal(true);
    return;
  }
  const deck = el("#battle-deck");
  const image = el("#battle-portrait");
  const fill = el("#battle-portrait-fill");
  const stamp = el("#battle-answer-stamp");
  runtime.game.locked = true;
  all("[data-battle-choice]").forEach((button) => { button.disabled = true; });
  deck.classList.remove("is-answering", "is-wide", "is-wagering");
  el("#battle-wager").hidden = true;
  stamp.className = "battle-answer-stamp";
  stamp.textContent = "";
  fill.style.backgroundImage = `url(${card.src})`;
  fill.style.backgroundPosition = focusFor(card);
  image.style.opacity = "0";
  image.style.objectPosition = focusFor(card);
  let settled = false;
  const reveal = () => {
    if (settled) return;
    settled = true;
    if (runtime.roomState?.deck[runtime.game?.index] !== cardId) return;
    deck.classList.toggle("is-wide", image.naturalWidth / image.naturalHeight >= 1.15);
    image.style.opacity = "1";
    if (!runtime.game.questionShownAt) runtime.game.questionShownAt = nowHost();
    if (runtime.game.pendingChoice?.cardId === cardId) showWagerPanel();
    else {
      runtime.game.locked = false;
      all("[data-battle-choice]").forEach((button) => { button.disabled = false; });
    }
    saveProgress();
  };
  image.onload = reveal;
  image.onerror = () => {
    if (runtime.roomState?.deck[runtime.game?.index] !== cardId) return;
    runtime.game.questionShownAt ||= nowHost();
    if (runtime.game.pendingChoice?.cardId === cardId) showWagerPanel();
    else {
      runtime.game.locked = false;
      all("[data-battle-choice]").forEach((button) => { button.disabled = false; });
    }
  };
  image.src = card.src;
  if (image.complete && image.naturalWidth) requestAnimationFrame(reveal);
  el("#battle-card-number").textContent = runtime.game.index + 1;
  el("#battle-card-total").textContent = runtime.roomState.deck.length;
  el("#battle-points").textContent = runtime.game.points;
  renderComboMeter();
  updateSpeedHint();
  renderCardReactions();
}

function speedWindowMs() {
  const perCard = runtime.roomState.settings.durationSec * 1000 / runtime.roomState.deck.length;
  return clamp(perCard * 0.75, 3000, 12000);
}

function speedBonus(responseMs) {
  return clamp(5 - Math.floor(Math.max(0, responseMs) / (speedWindowMs() / 5)), 0, 5);
}

function updateSpeedHint() {
  if (!runtime.game?.questionShownAt) return;
  if (runtime.game.pendingChoice) {
    el("#battle-speed-hint").textContent = "Answer locked · place your bet";
    return;
  }
  const bonus = speedBonus(nowHost() - runtime.game.questionShownAt);
  el("#battle-speed-hint").textContent = bonus > 0 ? `+${bonus} speed available` : "Base points only";
}

function renderComboMeter(pop = false) {
  const meter = el("#battle-combo");
  if (!meter) return;
  const combo = Math.max(0, Math.trunc(Number(runtime.game?.combo) || 0));
  meter.querySelector("strong").textContent = `${combo}×`;
  meter.classList.toggle("is-hot", combo >= 3 && combo < 5);
  meter.classList.toggle("is-blazing", combo >= 5 && combo < 10);
  meter.classList.toggle("is-nuclear", combo >= 10);
  if (pop) {
    meter.classList.remove("is-popping");
    void meter.offsetWidth;
    meter.classList.add("is-popping");
  }
}

function showComboBurst(combo) {
  if (![3, 5, 10].includes(combo)) return;
  const burst = el("#battle-combo-burst");
  if (!burst) return;
  const label = combo === 3 ? "3×\nHEATING UP" : combo === 5 ? "5×\nON FIRE" : "10×\nCERTIFIED MENACE";
  burst.textContent = label;
  burst.style.whiteSpace = "pre-line";
  burst.classList.remove("is-visible");
  void burst.offsetWidth;
  burst.classList.add("is-visible");
  window.SpotCheckMusic?.playComboEffect?.(combo);
}

function showWagerPanel() {
  if (!runtime.game?.pendingChoice) return;
  runtime.game.locked = true;
  all("[data-battle-choice]").forEach((button) => { button.disabled = true; });
  el("#battle-deck").classList.add("is-wagering");
  el("#battle-wager").hidden = false;
  updateSpeedHint();
}

function hideWagerPanel() {
  el("#battle-deck")?.classList.remove("is-wagering");
  const wager = el("#battle-wager");
  if (wager) wager.hidden = true;
}

function chooseBattleAnswer(choice) {
  if (!runtime.game || runtime.game.locked || runtime.game.finishedAt || runtime.game.timedOut) return;
  if (nowHost() >= runtime.roomState.endAt) {
    finishLocal(true);
    return;
  }
  const cardId = runtime.roomState.deck[runtime.game.index];
  const card = runtime.cardsById.get(cardId);
  if (!card || !["woman", "trans"].includes(choice)) return;
  runtime.game.locked = true;
  all("[data-battle-choice]").forEach((button) => { button.disabled = true; });
  const responseMs = clamp(nowHost() - (runtime.game.questionShownAt || nowHost()), 0, runtime.roomState.settings.durationSec * 1000);
  runtime.game.pendingChoice = { cardId, choice, responseMs: Math.round(responseMs) };
  saveProgress();
  showWagerPanel();
}

function chooseBattleWager(value, continueAfter = true) {
  if (!runtime.game?.pendingChoice || runtime.game.finishedAt || runtime.game.timedOut) return;
  const wager = clamp(Math.trunc(Number(value) || 0), 0, MAX_WAGER);
  const pending = runtime.game.pendingChoice;
  const card = runtime.cardsById.get(pending.cardId);
  if (!card || runtime.roomState.deck[runtime.game.index] !== pending.cardId) return;
  hideWagerPanel();
  const correct = card.labels?.[MODE] === pending.choice;
  const speed = correct ? speedBonus(pending.responseMs) : 0;
  const nextCombo = correct ? runtime.game.combo + 1 : 0;
  const streakBonus = correct ? comboBonus(nextCombo) : 0;
  const earned = correct ? 10 + speed + wager + streakBonus : -wager;
  runtime.game.points += earned;
  runtime.game.correct += correct ? 1 : 0;
  runtime.game.combo = nextCombo;
  runtime.game.bestCombo = Math.max(runtime.game.bestCombo, nextCombo);
  runtime.game.wagerWon += correct ? wager : 0;
  runtime.game.wagerLost += correct ? 0 : wager;
  runtime.game.answers.push({
    cardId: pending.cardId,
    choice: pending.choice,
    correct,
    responseMs: pending.responseMs,
    wager,
    speedBonus: speed,
    comboBonus: streakBonus,
    combo: nextCombo,
    points: earned,
    answeredAt: nowHost(),
  });
  runtime.game.pendingChoice = null;
  runtime.game.index += 1;
  runtime.game.questionShownAt = null;
  updateSelfResult();
  mergePlayer(selfPresence());
  saveProgress();
  runtime.transport?.send("progress", runtime.roomState.results[runtime.self.playerId]);
  runtime.transport?.send("presence", selfPresence());
  el("#battle-points").textContent = runtime.game.points;
  el("#battle-speed-hint").textContent = correct
    ? `${speed ? `+${speed} speed · ` : ""}${wager ? `+${wager} nerve · ` : ""}${streakBonus ? `+${streakBonus} combo` : "locked in"}`
    : wager ? `${wager} confidence points burned` : "No points. No damage. No glory.";
  renderRace();
  renderComboMeter(correct);
  renderRivalCallout(true);
  const stamp = el("#battle-answer-stamp");
  stamp.textContent = correct ? `+${earned}` : wager ? `−${wager}` : "MISS";
  stamp.className = `battle-answer-stamp is-visible ${correct ? "is-correct" : "is-wrong"}`;
  el("#battle-deck").classList.add("is-answering");
  window.SpotCheckMusic?.playEffect(correct);
  if (correct) showComboBurst(nextCombo);

  if (!continueAfter) return;
  setTimeout(() => {
    if (!runtime.game || runtime.game.finishedAt || runtime.game.timedOut) return;
    if (runtime.game.index >= runtime.roomState.deck.length) finishLocal(false);
    else renderBattleCard();
  }, 620);
}

function progressPayload() {
  updateSelfResult();
  return runtime.roomState.results[runtime.self.playerId];
}

function finishLocal(timedOut) {
  if (!runtime.game || runtime.game.finishedAt || runtime.game.timedOut) return;
  runtime.game.locked = true;
  runtime.game.timedOut = Boolean(timedOut);
  runtime.game.finishedAt = timedOut ? runtime.roomState.endAt : nowHost();
  if (timedOut) runtime.game.index = Math.min(runtime.game.index, runtime.roomState.deck.length);
  updateSelfResult();
  saveProgress();
  runtime.transport?.send("progress", progressPayload());
  if (runtime.hotSeat) {
    finishHotSeatTurn();
    return;
  }
  if (isHost()) {
    const active = connectedPlayers();
    const allDone = active.every((player) => {
      const result = runtime.roomState.results[player.playerId];
      return result?.finishedAt || result?.timedOut;
    });
    if (allDone || nowHost() >= runtime.roomState.endAt) {
      commitHostState((state) => { state.phase = "finished"; }, true);
    }
  }
  showBattleResults();
}

function showBattleResults() {
  showBattleScreen("battle-results");
  window.SpotCheckMusic?.setScene("results");
  renderLeaderboard();
  renderTitleRewards();
  renderChat();
  const rematch = el("#battle-rematch");
  rematch.hidden = !runtime.hotSeat && !isHost();
  el("#battle-results-note").textContent = runtime.hotSeat
    ? "The phone survived. Some reputations did not."
    : nowHost() < (runtime.roomState?.endAt || 0)
      ? "You finished. Rankings keep updating while the party races."
      : "Final ranking: accuracy, speed, nerve, and streaks.";
}

function rematch() {
  if (runtime.hotSeat) {
    runtime.passSetup.names = runtime.hotSeat.players.map((player) => player.name);
    runtime.passSetup.cardCount = runtime.hotSeat.cardCount;
    runtime.passSetup.durationSec = runtime.hotSeat.durationSec;
    startPassPhoneBattle();
    return;
  }
  if (!isHost()) return;
  commitHostState((state) => {
    state.phase = "lobby";
    state.gameId = null;
    state.seed = null;
    state.deck = [];
    state.startAt = null;
    state.endAt = null;
    state.results = {};
    state.reactions = {};
  }, true);
  runtime.game = null;
  runtime.reactions = {};
  runtime.self.readyGameId = null;
  runtime.musicStarted = false;
  runtime.raceSnapshot = new Map();
  runtime.newlyUnlockedTitles = new Set();
  addSystemMessage(`${runtime.self.name} opened the rematch lobby.`);
  showBattleScreen("battle-lobby");
  renderLobby();
}

function tickBattle() {
  if (!runtime.self || (!runtime.transport && !runtime.hotSeat)) return;
  const now = Date.now();
  if (runtime.transport && (!tickBattle.lastHeartbeat || now - tickBattle.lastHeartbeat > 2500)) {
    tickBattle.lastHeartbeat = now;
    mergePlayer(selfPresence());
    runtime.transport.send("heartbeat", selfPresence());
  }
  if (runtime.transport && !runtime.roomState && now - runtime.lastDiscoveryHello > DISCOVERY_RETRY_MS) {
    runtime.lastDiscoveryHello = now;
    runtime.transport.send("hello", { presence: selfPresence(), clientSentAt: now, pingId: randomToken(5) });
  }
  const host = runtime.roomState && runtime.players.get(runtime.roomState.hostId);
  if (!runtime.hotSeat && runtime.roomState && runtime.roomState.hostId !== runtime.self.playerId && (!host || !host.connected || now - host.lastSeen > HOST_GRACE_MS)) {
    scheduleHostElection();
  }
  if (!runtime.roomState) return;

  if (runtime.roomState.phase === "countdown") {
    const remaining = runtime.roomState.startAt - nowHost();
    if (remaining > 0) {
      const count = clamp(Math.ceil(remaining / 1000), 1, 5);
      el("#battle-countdown-number").textContent = count;
      el("#battle-countdown-sync").textContent = Math.abs(runtime.clockOffset) > 5
        ? `Clock aligned ${runtime.clockOffset > 0 ? "+" : ""}${Math.round(runtime.clockOffset)} ms · portraits ready`
        : "Clocks aligned · portraits ready";
      renderReadyRow();
    } else {
      if (isHost()) commitHostState((state) => { state.phase = "playing"; }, true);
      if (!el("[data-screen='battle-game']")?.classList.contains("is-active")) beginGame();
    }
  }
  if (["playing", "finished"].includes(runtime.roomState.phase)) {
    const remaining = runtime.roomState.endAt - nowHost();
    el("#battle-time-left").textContent = formatClock(remaining);
    if (remaining <= 0 && runtime.game && !runtime.game.finishedAt && !runtime.game.timedOut) {
      if (runtime.game.pendingChoice) chooseBattleWager(0, false);
      finishLocal(true);
    }
    if (isHost() && remaining <= 0 && runtime.roomState.phase !== "finished") {
      commitHostState((state) => { state.phase = "finished"; }, true);
    }
    if (runtime.roomState.phase === "playing") {
      updateSpeedHint();
      if (runtime.musicStarted) window.SpotCheckMusic?.syncToEpoch?.(runtime.roomState.startAt - runtime.clockOffset);
    }
    if (el("[data-screen='battle-results']")?.classList.contains("is-active")) renderLeaderboard();
  }
}

function renderReadyRow() {
  const row = el("#battle-ready-row");
  row.replaceChildren(...connectedPlayers().map((player) => {
    const badge = document.createElement("span");
    badge.textContent = initials(player.name);
    badge.title = `${player.name}${player.readyGameId === runtime.roomState.gameId ? " is ready" : " is loading"}`;
    badge.style.opacity = player.readyGameId === runtime.roomState.gameId ? "1" : ".42";
    return badge;
  }));
}

function renderCardReactions() {
  const container = el("#battle-peer-reactions");
  if (!container || !runtime.game || !runtime.roomState) return;
  const cardId = runtime.roomState.deck[runtime.game.index];
  const reactions = Object.values(runtime.reactions[cardId] || {});
  const counts = reactions.reduce((result, emoji) => {
    result[emoji] = (result[emoji] || 0) + 1;
    return result;
  }, {});
  container.replaceChildren(...Object.entries(counts).map(([emoji, count]) => {
    const item = document.createElement("span");
    item.textContent = `${emoji}${count > 1 ? ` ${count}` : ""}`;
    return item;
  }));
}

function sendReaction(emoji) {
  if (!REACTIONS.has(emoji) || !runtime.game || runtime.game.finishedAt || runtime.game.timedOut) return;
  const cardId = runtime.roomState.deck[runtime.game.index];
  const reaction = { gameId: runtime.roomState.gameId, cardId, playerId: runtime.self.playerId, emoji, at: nowHost() };
  receiveReaction(reaction);
  runtime.transport?.send("reaction", reaction);
}

function renderLobby() {
  const state = runtime.roomState;
  if (!runtime.self) return;
  el("#battle-name").value = runtime.self.name;
  el("#battle-card-count").textContent = state?.settings?.cardCount || DEFAULT_CARD_COUNT;
  const duration = String(state?.settings?.durationSec || DEFAULT_DURATION);
  const timer = el("#battle-timer");
  const standard = [...timer.options].some((option) => option.value === duration);
  timer.value = standard ? duration : "custom";
  if (!standard && state) el("#battle-custom-minutes").value = Math.round(state.settings.durationSec / 60);
  el("#battle-custom-timer").hidden = timer.value !== "custom";
  const host = isHost();
  const vice = isViceHost();
  el("#battle-role").textContent = host ? "♛ Host" : vice ? "★ Vice host" : "Player";
  el("#battle-settings-lock").textContent = host ? "Editable" : "Host controlled";
  all("[data-battle-action='cards-down'], [data-battle-action='cards-up'], #battle-timer, #battle-custom-minutes, [data-battle-action='custom-timer']")
    .forEach((control) => { control.disabled = !host || state?.phase !== "lobby"; });
  el("#battle-start").hidden = !host || state?.phase !== "lobby";
  el("#battle-waiting").hidden = host || state?.phase !== "lobby";
  el("#battle-waiting").textContent = state
    ? `Waiting for ${runtime.players.get(state.hostId)?.name || "the host"} to start…`
    : "Finding the host and room state…";
  el("#battle-room-code").textContent = runtime.invite ? roomCode(runtime.invite.roomId) : "------";
  renderPlayers();
}

function renderPlayers() {
  const list = el("#battle-player-list");
  if (!list || !runtime.self) return;
  const players = [...runtime.players.values()].sort((left, right) => {
    const role = (player) => player.playerId === runtime.roomState?.hostId ? 0 : player.playerId === runtime.roomState?.viceHostId ? 1 : 2;
    return role(left) - role(right) || left.joinedAt - right.joinedAt || left.name.localeCompare(right.name);
  });
  el("#battle-player-count").textContent = players.length;
  el("#battle-player-label").textContent = players.length === 1 ? "player" : "players";
  const vice = players.find((player) => player.playerId === runtime.roomState?.viceHostId);
  el("#battle-vice-label").textContent = vice ? `${vice.name} is backup` : "Backup chosen on join";
  list.replaceChildren(...players.map((player) => {
    const item = document.createElement("li");
    const online = player.playerId === runtime.self.playerId || (player.connected && Date.now() - player.lastSeen < STALE_PLAYER_MS);
    item.classList.toggle("is-offline", !online);
    const avatar = document.createElement("span");
    avatar.className = "battle-player-avatar";
    avatar.style.setProperty("--player-color", player.color);
    avatar.textContent = initials(player.name);
    const name = document.createElement("b");
    name.textContent = `${player.name}${player.playerId === runtime.self.playerId ? " (you)" : ""}`;
    const status = document.createElement("small");
    status.textContent = online ? (player.finishedAt ? "Finished" : "Connected") : "Reconnecting…";
    name.appendChild(status);
    const role = document.createElement("em");
    role.textContent = player.playerId === runtime.roomState?.hostId ? "♛" : player.playerId === runtime.roomState?.viceHostId ? "★" : "";
    item.append(avatar, name, role);
    return item;
  }));
}

function renderRace() {
  const racers = el("#battle-racers");
  if (!racers || !runtime.roomState?.deck?.length || !runtime.self) return;
  const total = runtime.roomState.deck.length;
  const players = [...runtime.players.values()];
  if (!players.some((player) => player.playerId === runtime.self.playerId)) players.push(selfPresence());
  racers.replaceChildren(...players.map((player) => {
    const result = runtime.roomState.results?.[player.playerId];
    const progress = clamp(Number(result?.index ?? player.progress) || 0, 0, total);
    const marker = document.createElement("span");
    marker.className = `battle-racer${player.playerId === runtime.self.playerId ? " is-self" : ""}`;
    marker.style.setProperty("--progress", `${(progress / total) * 100}%`);
    marker.style.setProperty("--player-color", player.color || playerColor(player.playerId));
    marker.textContent = initials(player.name);
    marker.title = `${player.name}: ${progress}/${total}, ${result?.points ?? player.points ?? 0} points`;
    return marker;
  }));
}

function calloutPick(key, lines) {
  return lines[hashNumber(String(key)) % lines.length];
}

function renderRivalCallout(force = false) {
  const callout = el("#battle-rival-callout");
  if (!callout || !runtime.roomState || !runtime.self || !el("[data-screen='battle-game']")?.classList.contains("is-active")) return;
  const results = rankingResults().filter((result) => result.answered > 0 || result.playerId === runtime.self.playerId);
  const selfIndex = results.findIndex((result) => result.playerId === runtime.self.playerId);
  if (selfIndex < 0) return;
  const previousSelf = runtime.raceSnapshot.get(runtime.self.playerId);
  const passer = previousSelf === undefined ? null : results.find((result, index) =>
    result.playerId !== runtime.self.playerId
      && index < selfIndex
      && Number(runtime.raceSnapshot.get(result.playerId)) > previousSelf
  );
  const rankSnapshot = new Map(results.map((result, index) => [result.playerId, index]));
  runtime.raceSnapshot = rankSnapshot;
  const leader = results[0];
  const runnerUp = results[1];
  let key;
  let message;
  if (passer) {
    key = `pass:${passer.playerId}:${runtime.game?.index}`;
    message = calloutPick(key, [
      `${passer.name} just stole your place. That's embarrassing.`,
      `${passer.name} flew past you. Check your mirrors.`,
      `${passer.name} took your rank and your lunch money.`,
      `${passer.name} passed you like you were reading the instructions.`,
    ]);
  } else if (results.length === 1) {
    key = "alone";
    message = runtime.hotSeat ? "Set a score worth passing the phone for." : "No rivals yet. Enjoy first place while it is technically true.";
  } else if (selfIndex === 0) {
    const gap = Math.max(0, leader.points - runnerUp.points);
    key = `lead:${runnerUp.playerId}:${gap}:${runtime.game?.index}`;
    message = calloutPick(key, [
      `${runnerUp.name} is ${gap} point${gap === 1 ? "" : "s"} back. Try not to choke.`,
      `You're leading. ${runnerUp.name} is waiting for the collapse.`,
      `The crown is yours for now. Do not bottle this.`,
      `${runnerUp.name} can still catch you. Stop celebrating.`
    ]);
  } else {
    const gap = Math.max(0, leader.points - results[selfIndex].points);
    key = `chase:${leader.playerId}:${gap}:${runtime.game?.index}`;
    message = gap <= MAX_CORRECT_POINTS
      ? calloutPick(key, [
        `One clean answer from mugging ${leader.name} for the crown.`,
        `${gap} point${gap === 1 ? "" : "s"} behind ${leader.name}. Stop sightseeing.`,
        `${leader.name} is within reach. Try using both eyes.`,
        `The crown is right there. Don't bottle it now.`,
      ])
      : calloutPick(key, [
        `${gap} points behind ${leader.name}. This is becoming a rescue operation.`,
        `${leader.name} is disappearing over the horizon. Wake up.`,
        `${gap} points down. Even the monkey looks concerned.`,
        `You are not chasing ${leader.name}; you are filing a missing-person report.`,
      ]);
  }
  if (!force && (key === runtime.lastCalloutKey || Date.now() - runtime.lastCalloutAt < 2200)) return;
  runtime.lastCalloutKey = key;
  runtime.lastCalloutAt = Date.now();
  callout.textContent = message;
  callout.classList.remove("is-fresh");
  void callout.offsetWidth;
  callout.classList.add("is-fresh");
}

function renderChatList(container) {
  if (!container) return;
  container.replaceChildren(...runtime.messages.map((message) => {
    const item = document.createElement("li");
    if (message.system) {
      item.className = "is-system";
      item.textContent = message.text;
    } else {
      const name = document.createElement("b");
      name.textContent = message.name;
      name.style.setProperty("--message-color", message.color);
      item.style.setProperty("--message-color", message.color);
      item.append(name, document.createTextNode(message.text));
    }
    return item;
  }));
  container.scrollTop = container.scrollHeight;
}

function renderChat() {
  renderChatList(el("#battle-chat-log"));
  renderChatList(el("#battle-game-chat-log"));
  renderChatList(el("#battle-results-chat-log"));
}

function sendChat(input) {
  const text = cleanMessage(input.value);
  if (!text || !runtime.self) return;
  const message = {
    id: `${runtime.self.playerId}-${randomToken(6)}`,
    playerId: runtime.self.playerId,
    name: runtime.self.name,
    color: runtime.self.color,
    text,
    at: nowHost(),
  };
  input.value = "";
  receiveChat(message);
  runtime.transport?.send("chat", message);
}

function rankingResults() {
  if (!runtime.roomState) return [];
  const ids = new Set([...runtime.players.keys(), ...Object.keys(runtime.roomState.results || {})]);
  return [...ids].map((playerId) => {
    const player = runtime.players.get(playerId) || {};
    const result = runtime.roomState.results?.[playerId] || {};
    return {
      playerId,
      name: cleanName(result.name || player.name) || "Player",
      color: player.color || playerColor(playerId),
      points: Number(result.points) || 0,
      correct: Number(result.correct) || 0,
      answered: Number(result.answered) || 0,
      combo: Number(result.combo) || 0,
      bestCombo: Number(result.bestCombo) || 0,
      wagerWon: Number(result.wagerWon) || 0,
      wagerLost: Number(result.wagerLost) || 0,
      finishedAt: Number(result.finishedAt) || null,
      elapsedMs: result.elapsedMs !== null && result.elapsedMs !== undefined && Number.isFinite(Number(result.elapsedMs))
        ? Number(result.elapsedMs)
        : null,
      timedOut: Boolean(result.timedOut),
    };
  }).sort((left, right) => right.points - left.points
    || right.correct - left.correct
    || (left.finishedAt || Infinity) - (right.finishedAt || Infinity)
    || left.name.localeCompare(right.name));
}

function renderLeaderboard() {
  const list = el("#battle-leaderboard");
  if (!list || !runtime.roomState) return;
  const results = rankingResults();
  list.replaceChildren(...results.map((result, index) => {
    const item = document.createElement("li");
    item.classList.toggle("is-winner", index === 0 && results.length > 0);
    const rank = document.createElement("span");
    rank.className = "battle-rank";
    rank.textContent = index === 0 ? "♛" : String(index + 1);
    const avatar = document.createElement("span");
    avatar.className = "battle-player-avatar";
    avatar.style.setProperty("--player-color", result.color);
    avatar.textContent = initials(result.name);
    const copy = document.createElement("div");
    copy.className = "battle-result-name";
    const name = document.createElement("b");
    name.textContent = `${result.name}${result.playerId === runtime.self?.playerId ? " (you)" : ""}`;
    const detail = document.createElement("small");
    const elapsed = Number.isFinite(result.elapsedMs)
      ? result.elapsedMs
      : result.finishedAt ? result.finishedAt - runtime.roomState.startAt : NaN;
    detail.textContent = `${formatFinish(elapsed, result.timedOut)} · ${result.correct}/${runtime.roomState.deck.length} right`;
    const title = document.createElement("em");
    title.textContent = bestTitle(result, runtime.roomState.deck.length).name;
    copy.append(name, detail, title);
    const score = document.createElement("div");
    score.className = "battle-result-score";
    const points = document.createElement("strong");
    points.textContent = result.points;
    const label = document.createElement("small");
    label.textContent = "points";
    score.append(points, label);
    item.append(rank, avatar, copy, score);
    return item;
  }));
}

function renderTitleRewards() {
  const vault = el("#battle-title-vault");
  if (!vault || !runtime.roomState) return;
  const results = rankingResults();
  const targets = runtime.hotSeat
    ? results
    : results.filter((result) => result.playerId === runtime.self?.playerId);
  if (!targets.length) {
    vault.hidden = true;
    return;
  }
  vault.hidden = false;
  const unlocked = readUnlockedTitles();
  targets.forEach((result) => earnedTitles(result, runtime.roomState.deck.length).forEach((title) => {
    if (!unlocked.has(title.id)) runtime.newlyUnlockedTitles.add(title.id);
    unlocked.add(title.id);
  }));
  writeJSON(TITLE_STORAGE_KEY, [...unlocked]);
  const featured = bestTitle(runtime.hotSeat ? results[0] : targets[0], runtime.roomState.deck.length);
  el("#battle-earned-title").textContent = featured.name;
  el("#battle-title-roast").textContent = `${featured.roast} · ${unlocked.size}/${BATTLE_TITLES.length} unlocked`;
  vault.querySelector(".eyebrow").textContent = runtime.newlyUnlockedTitles.size ? "Title unlocked" : "Title cabinet";
  const collection = el("#battle-title-collection");
  collection.replaceChildren(...BATTLE_TITLES.filter((title) => unlocked.has(title.id)).map((title) => {
    const chip = document.createElement("span");
    chip.textContent = title.name;
    chip.classList.toggle("is-new", runtime.newlyUnlockedTitles.has(title.id));
    return chip;
  }));
}

async function copyInviteLink() {
  if (!runtime.inviteLink) return;
  try {
    await navigator.clipboard.writeText(runtime.inviteLink);
    showToast("Battle invite copied.");
  } catch {
    el("#battle-link-input").value = runtime.inviteLink;
    el("#battle-link-input").select();
    showToast("Select and copy the invite link.");
  }
}

async function shareInviteLink() {
  if (!runtime.inviteLink) return;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Join my Spot Check battle", text: "Join my yellow battle party.", url: runtime.inviteLink });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyInviteLink();
}

function saveDisplayName() {
  if (!runtime.self) return;
  const name = cleanName(el("#battle-name").value);
  if (!name) {
    showToast("Enter a display name.");
    return;
  }
  runtime.self.name = name;
  writeStorage(localStorage, "spot-check:battle-name", name);
  writeJSON(`spot-check:battle-identity:${runtime.invite.roomId}:${runtime.self.playerId}`, { name, joinedAt: runtime.self.joinedAt });
  mergePlayer(selfPresence());
  runtime.transport?.send("presence", selfPresence());
  if (runtime.game) {
    updateSelfResult();
    runtime.transport?.send("progress", progressPayload());
  }
  renderLobby();
  showToast("Display name updated.");
}

async function startScanner() {
  const modal = el("#battle-scanner");
  const video = el("#battle-camera");
  const status = el("#battle-camera-status");
  modal.hidden = false;
  status.textContent = "Requesting the rear camera…";
  try {
    runtime.scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = runtime.scannerStream;
    await video.play();
    status.textContent = "Point the camera at the host's QR code.";
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let lastScan = 0;
    const scan = (time) => {
      if (!runtime.scannerStream) return;
      if (time - lastScan > 130 && video.readyState >= 2) {
        lastScan = time;
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width && height) {
          const scale = Math.min(1, 720 / Math.max(width, height));
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "dontInvert" });
          if (result?.data) {
            try {
              const invite = parseInvite(result.data);
              stopScanner();
              connectToRoom(invite, false);
              return;
            } catch {
              status.textContent = "That QR is not a Spot Check battle invite.";
            }
          }
        }
      }
      runtime.scannerFrame = requestAnimationFrame(scan);
    };
    runtime.scannerFrame = requestAnimationFrame(scan);
  } catch {
    status.textContent = "Camera unavailable. Paste the invite link instead.";
  }
}

function stopScanner() {
  if (runtime.scannerFrame) cancelAnimationFrame(runtime.scannerFrame);
  runtime.scannerFrame = null;
  runtime.scannerStream?.getTracks().forEach((track) => track.stop());
  runtime.scannerStream = null;
  const video = el("#battle-camera");
  if (video) video.srcObject = null;
  const modal = el("#battle-scanner");
  if (modal) modal.hidden = true;
}

function toggleGameChat() {
  const chat = el("#battle-game-chat");
  chat.hidden = !chat.hidden;
  if (!chat.hidden) {
    runtime.unread = 0;
    el("#battle-unread").textContent = "0";
    renderChat();
    el("#battle-game-chat-input").focus();
  }
}

async function handleBattleAction(action) {
  if (action === "open") {
    el("#battle-entry").hidden = false;
    el("#battle-room").hidden = true;
    showBattleScreen("battle-lobby");
    if (!runtime.invite && !runtime.entering) {
      const invite = { roomId: randomToken(16), secret: randomToken(16) };
      await connectToRoom({ ...invite, token: encodeInvite(invite) }, true);
    }
  } else if (action === "pass-phone") {
    await openPassPhoneSetup();
  } else if (action === "pass-add-player") {
    syncPassPhoneSetupFromUi();
    if (runtime.passSetup.names.length < PASS_PHONE_MAX_PLAYERS) {
      runtime.passSetup.names.push(`Player ${runtime.passSetup.names.length + 1}`);
      renderPassPhoneSetup();
      all("#pass-phone-player-list input").at(-1)?.focus();
    }
  } else if (action.startsWith("pass-remove-")) {
    syncPassPhoneSetupFromUi();
    const index = Number(action.slice("pass-remove-".length));
    if (runtime.passSetup.names.length > PASS_PHONE_MIN_PLAYERS && Number.isInteger(index)) {
      runtime.passSetup.names.splice(index, 1);
      renderPassPhoneSetup();
    }
  } else if (action === "pass-cards-down" || action === "pass-cards-up") {
    syncPassPhoneSetupFromUi();
    const current = runtime.passSetup.cardCount;
    const index = CARD_COUNTS.indexOf(current);
    runtime.passSetup.cardCount = CARD_COUNTS[clamp(index + (action === "pass-cards-up" ? 1 : -1), 0, CARD_COUNTS.length - 1)];
    renderPassPhoneSetup();
  } else if (action === "pass-start") {
    startPassPhoneBattle();
  } else if (action === "pass-go") {
    beginPassPhoneTurn();
  } else if (action === "create") {
    const invite = { roomId: randomToken(16), secret: randomToken(16) };
    await connectToRoom({ ...invite, token: encodeInvite(invite) }, true);
  } else if (action === "join-link") {
    try { await connectToRoom(parseInvite(el("#battle-link-input").value), false); }
    catch (error) { showToast(error.message); }
  } else if (action === "paste-link") {
    try {
      el("#battle-link-input").value = await navigator.clipboard.readText();
      showToast("Invite pasted. Tap Join when ready.");
    } catch {
      el("#battle-link-input").focus();
      showToast("Clipboard unavailable. Paste into the field manually.");
    }
  } else if (action === "scan") {
    await startScanner();
  } else if (action === "close-scan") {
    stopScanner();
  } else if (action === "copy-link") {
    await copyInviteLink();
  } else if (action === "share-link") {
    await shareInviteLink();
  } else if (action === "toggle-qr") {
    const card = el("#battle-share-card");
    card.classList.toggle("is-collapsed");
    el("[data-battle-action='toggle-qr']").textContent = card.classList.contains("is-collapsed") ? "Show QR" : "Hide QR";
  } else if (action === "save-name") {
    saveDisplayName();
  } else if (action === "cards-down" || action === "cards-up") {
    if (!isHost()) return;
    const current = runtime.roomState.settings.cardCount;
    const index = CARD_COUNTS.indexOf(current);
    const next = CARD_COUNTS[clamp(index + (action === "cards-up" ? 1 : -1), 0, CARD_COUNTS.length - 1)];
    updateSettings({ cardCount: next });
  } else if (action === "timer") {
    const value = el("#battle-timer").value;
    el("#battle-custom-timer").hidden = value !== "custom";
    if (value !== "custom") updateSettings({ durationSec: clamp(Number(value), 30, 3600) });
  } else if (action === "custom-timer") {
    const minutes = clamp(Math.round(Number(el("#battle-custom-minutes").value) || 1), 1, 60);
    el("#battle-custom-minutes").value = minutes;
    updateSettings({ durationSec: minutes * 60 });
  } else if (action === "start") {
    startBattle();
  } else if (action === "toggle-game-chat") {
    toggleGameChat();
  } else if (action === "rematch") {
    rematch();
  } else if (action === "leave") {
    await leaveBattle();
  }
}

document.addEventListener("click", (event) => {
  if (document.body.classList.contains("battle-mode") && event.target.closest("[data-action='home']")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    leaveBattle();
    return;
  }
  const action = event.target.closest("[data-battle-action]")?.dataset.battleAction;
  if (action) {
    event.preventDefault();
    event.stopImmediatePropagation();
    handleBattleAction(action);
    return;
  }
  const wager = event.target.closest("[data-battle-wager]")?.dataset.battleWager;
  if (wager !== undefined) {
    event.preventDefault();
    event.stopImmediatePropagation();
    chooseBattleWager(wager);
    return;
  }
  const choice = event.target.closest("[data-battle-choice]")?.dataset.battleChoice;
  if (choice) chooseBattleAnswer(choice);
  const reaction = event.target.closest("[data-battle-reaction]")?.dataset.battleReaction;
  if (reaction) sendReaction(reaction);
}, true);

document.addEventListener("keydown", (event) => {
  if (!el("[data-screen='battle-game']")?.classList.contains("is-active") || !runtime.game) return;
  if (runtime.game.pendingChoice && ["0", "1", "2", "3"].includes(event.key)) {
    event.preventDefault();
    chooseBattleWager(event.key);
    return;
  }
  if (runtime.game.locked) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    chooseBattleAnswer("woman");
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    chooseBattleAnswer("trans");
  }
});

["battle-chat-form", "battle-game-chat-form", "battle-results-chat-form"].forEach((formId) => {
  el(`#${formId}`)?.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat(event.currentTarget.querySelector("input"));
  });
});

el("#battle-timer")?.addEventListener("change", () => {
  handleBattleAction("timer");
});

window.addEventListener("online", () => {
  runtime.disconnectedAt = null;
  setConnectionStatus("Reconnecting", false);
  runtime.transport?.send("hello", { presence: selfPresence(), clientSentAt: Date.now(), pingId: randomToken(5) });
});
window.addEventListener("offline", () => {
  runtime.disconnectedAt = Date.now();
  setConnectionStatus("Offline · saved", false);
  saveProgress();
});
window.addEventListener("beforeunload", () => {
  saveProgress();
  runtime.transport?.send("depart", { at: nowHost() });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    saveProgress();
    stopScanner();
  } else if (runtime.transport) {
    runtime.transport.send("hello", { presence: selfPresence(), clientSentAt: Date.now(), pingId: randomToken(5) });
    if (runtime.roomState?.phase === "playing") window.SpotCheckMusic?.syncToEpoch?.(runtime.roomState.startAt);
  }
});

async function initializeBattle() {
  const match = location.hash.match(/(?:^#|[&#])battle=([^&]+)/);
  if (!match) return;
  try {
    const invite = parseInvite(match[1]);
    showBattleScreen("battle-lobby");
    el("#battle-entry").hidden = true;
    el("#battle-room").hidden = false;
    await connectToRoom(invite, false);
  } catch (error) {
    showBattleScreen("battle-lobby");
    el("#battle-entry").hidden = false;
    el("#battle-room").hidden = true;
    showToast(error.message || "That invite could not be opened.");
  }
}

window.SpotCheckBattle = {
  getState: () => ({
    connected: Boolean(runtime.transport),
    passPhone: Boolean(runtime.hotSeat),
    roomCode: runtime.invite ? roomCode(runtime.invite.roomId) : null,
    playerId: runtime.self?.playerId || null,
    isHost: isHost(),
    phase: runtime.roomState?.phase || null,
    players: runtime.players.size,
    network: runtime.transport?.diagnostics?.() || null,
    results: runtime.roomState ? rankingResults().map(({ playerId, name, points, correct, answered, elapsedMs, timedOut }) => ({
      playerId, name, points, correct, answered, elapsedMs, timedOut,
    })) : [],
    game: runtime.game ? {
      index: runtime.game.index,
      points: runtime.game.points,
      correct: runtime.game.correct,
      combo: runtime.game.combo,
      bestCombo: runtime.game.bestCombo,
      pendingWager: Boolean(runtime.game.pendingChoice),
    } : null,
  }),
  leave: leaveBattle,
};

initializeBattle();
