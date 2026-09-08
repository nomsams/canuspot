import { joinRoom } from "trystero";
import QRCode from "qrcode";
import jsQR from "jsqr";

const APP_ID = "com.nomsams.canuspot.yellow-battle.v1";
const MODE = "woman_trans";
const CARD_COUNTS = [10, 20, 30];
const DEFAULT_CARD_COUNT = 20;
const DEFAULT_DURATION = 180;
const COUNTDOWN_MS = 5500;
const HOST_GRACE_MS = 7000;
const STALE_PLAYER_MS = 9000;
const CHAT_LIMIT = 80;
const REACTIONS = new Set(["😂", "🤔", "😱", "🔥", "🙈"]);
const PLAYER_COLORS = ["#dfbd2e", "#ec6a86", "#5b9cea", "#5dbf89", "#a879e0", "#e78a43", "#4db9b4", "#d467c5"];

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

function encodeInvite(invite) {
  return toBase64Url(JSON.stringify({ v: 1, r: invite.roomId, s: invite.secret }));
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
  if (decoded?.v !== 1 || !/^[a-f0-9]{24,64}$/i.test(decoded.r) || !/^[a-f0-9]{24,64}$/i.test(decoded.s)) {
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
  entering: false,
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
    finishedAt: result.finishedAt ?? runtime.game?.finishedAt ?? null,
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
    this.channel = typeof BroadcastChannel === "function"
      ? new BroadcastChannel(`canuspot-battle-data-${invite.roomId}`)
      : null;
    if (this.channel) this.channel.onmessage = ({ data }) => this.receive(data, null);

    this.room = joinRoom({
      appId: APP_ID,
      password: invite.secret,
      relayConfig: { redundancy: 3, warnOnRelayFailure: false },
    }, invite.roomId, {
      onJoinError: () => this.onStatus?.("relay-warning"),
    });
    this.action = this.room.makeAction("battle-packet");
    this.action.onMessage = (data, { peerId }) => this.receive(data, peerId);
    this.room.onPeerJoin = (peerId) => {
      this.onStatus?.("connected");
      this.onPeerJoin?.(peerId);
    };
    this.room.onPeerLeave = (peerId) => {
      this.onPeerLeaveCallback?.(peerId);
      if (Object.keys(this.room.getPeers()).length === 0) this.onStatus?.("discovering");
    };
  }

  receive(envelope, peerId) {
    if (!envelope || envelope.roomId !== this.invite.roomId || envelope.connectionId === this.self.connectionId) return;
    if (envelope.target && envelope.target !== this.self.playerId) return;
    if (this.seen.has(envelope.messageId)) return;
    this.seen.add(envelope.messageId);
    if (this.seen.size > 600) this.seen.delete(this.seen.values().next().value);
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
    this.action.send(envelope, targetPeer ? { target: targetPeer } : undefined).catch(() => {});
  }

  peerCount() {
    return Object.keys(this.room.getPeers()).length;
  }

  async close() {
    this.closed = true;
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
    answers: runtime.game.answers,
    questionShownAt: runtime.game.questionShownAt,
    finishedAt: runtime.game.finishedAt,
    timedOut: runtime.game.timedOut,
  });
}

function createLobbyState(hostId) {
  return {
    protocol: 1,
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
    && state.protocol === 1
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
    answered: runtime.game.answers.length,
    finishedAt: runtime.game.finishedAt,
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
      const points = clamp(Math.trunc(Number(presence.points) || 0), 0, correct * 15);
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
          answered: index,
          finishedAt,
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
}

function acceptState(incoming, senderId) {
  if (!validRoomState(incoming)) return;
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
  const proposedFinish = Number(progress.finishedAt);
  const finishIsPlausible = Number.isFinite(proposedFinish)
    && proposedFinish >= runtime.roomState.startAt - 1000
    && proposedFinish <= Math.max(nowHost() + 5000, runtime.roomState.endAt + 5000);
  const safe = {
    playerId: progress.playerId,
    name: cleanName(progress.name) || runtime.players.get(progress.playerId)?.name || "Player",
    index: safeIndex,
    points: clamp(Math.trunc(Number(progress.points) || 0), 0, safeCorrect * 15),
    correct: safeCorrect,
    answered: safeAnswered,
    finishedAt: finishIsPlausible && (safeIndex === deckLength || progress.timedOut) ? proposedFinish : null,
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

function onPacket(envelope, peerId) {
  if (peerId) runtime.peerPlayers.set(peerId, envelope.from);
  const { type, payload, from } = envelope;
  if (type === "hello") {
    mergePlayer(payload?.presence);
    runtime.transport.send("presence", selfPresence(), from);
    if (runtime.roomState) runtime.transport.send("state", runtime.roomState, from);
    if (runtime.roomState?.hostId === runtime.self.playerId) {
      runtime.transport.send("clock-pong", { pingId: payload?.pingId, clientSentAt: payload?.clientSentAt, hostNow: Date.now() }, from);
    }
  } else if (type === "presence" || type === "heartbeat") {
    mergePlayer(payload);
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
  document.body.classList.remove("battle-mode");
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
      else if (status === "relay-warning") setConnectionStatus("P2P live", false);
      else setConnectionStatus("P2P live", false);
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
          runtime.roomState = createLobbyState(runtime.self.playerId);
          runtime.creator = true;
          saveRoomState();
          broadcastState(true);
          addSystemMessage("The original host is away, so this player recovered the room.");
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
  runtime.players = new Map();
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
  runtime.game = canRestore ? {
    gameId: state.gameId,
    index: clamp(Number(saved.index) || 0, 0, state.deck.length),
    points: clamp(Number(saved.points) || 0, 0, state.deck.length * 15),
    correct: clamp(Number(saved.correct) || 0, 0, state.deck.length),
    answers: Array.isArray(saved.answers) ? saved.answers.slice(0, state.deck.length) : [],
    questionShownAt: Number(saved.questionShownAt) || null,
    finishedAt: Number(saved.finishedAt) || null,
    timedOut: Boolean(saved.timedOut),
    locked: true,
  } : {
    gameId: state.gameId,
    index: 0,
    points: 0,
    correct: 0,
    answers: [],
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
  deck.classList.remove("is-answering", "is-wide");
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
    runtime.game.locked = false;
    all("[data-battle-choice]").forEach((button) => { button.disabled = false; });
    saveProgress();
  };
  image.onload = reveal;
  image.onerror = () => {
    if (runtime.roomState?.deck[runtime.game?.index] !== cardId) return;
    runtime.game.questionShownAt ||= nowHost();
    runtime.game.locked = false;
    all("[data-battle-choice]").forEach((button) => { button.disabled = false; });
  };
  image.src = card.src;
  if (image.complete && image.naturalWidth) requestAnimationFrame(reveal);
  el("#battle-card-number").textContent = runtime.game.index + 1;
  el("#battle-card-total").textContent = runtime.roomState.deck.length;
  el("#battle-points").textContent = runtime.game.points;
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
  const bonus = speedBonus(nowHost() - runtime.game.questionShownAt);
  el("#battle-speed-hint").textContent = bonus > 0 ? `+${bonus} speed available` : "Base points only";
}

function chooseBattleAnswer(choice) {
  if (!runtime.game || runtime.game.locked || runtime.game.finishedAt || runtime.game.timedOut) return;
  if (nowHost() >= runtime.roomState.endAt) {
    finishLocal(true);
    return;
  }
  const cardId = runtime.roomState.deck[runtime.game.index];
  const card = runtime.cardsById.get(cardId);
  if (!card) return;
  runtime.game.locked = true;
  all("[data-battle-choice]").forEach((button) => { button.disabled = true; });
  const responseMs = clamp(nowHost() - (runtime.game.questionShownAt || nowHost()), 0, runtime.roomState.settings.durationSec * 1000);
  const correct = card.labels?.[MODE] === choice;
  const bonus = correct ? speedBonus(responseMs) : 0;
  const earned = correct ? 10 + bonus : 0;
  runtime.game.points += earned;
  runtime.game.correct += correct ? 1 : 0;
  runtime.game.answers.push({ cardId, choice, correct, responseMs: Math.round(responseMs), points: earned, answeredAt: nowHost() });
  runtime.game.index += 1;
  runtime.game.questionShownAt = null;
  updateSelfResult();
  mergePlayer(selfPresence());
  saveProgress();
  runtime.transport?.send("progress", runtime.roomState.results[runtime.self.playerId]);
  runtime.transport?.send("presence", selfPresence());
  renderRace();
  const stamp = el("#battle-answer-stamp");
  stamp.textContent = correct ? `+${earned}` : "MISS";
  stamp.className = `battle-answer-stamp is-visible ${correct ? "is-correct" : "is-wrong"}`;
  el("#battle-deck").classList.add("is-answering");
  window.SpotCheckMusic?.playEffect(correct);

  setTimeout(() => {
    if (!runtime.game || runtime.game.finishedAt || runtime.game.timedOut) return;
    if (runtime.game.index >= runtime.roomState.deck.length) finishLocal(false);
    else renderBattleCard();
  }, 480);
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
  renderChat();
  const rematch = el("#battle-rematch");
  rematch.hidden = !isHost();
  el("#battle-results-note").textContent = nowHost() < (runtime.roomState?.endAt || 0)
    ? "You finished. Rankings keep updating while the party races."
    : "Final ranking: accuracy first, speed rewarded on every correct answer.";
}

function rematch() {
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
  addSystemMessage(`${runtime.self.name} opened the rematch lobby.`);
  showBattleScreen("battle-lobby");
  renderLobby();
}

function tickBattle() {
  if (!runtime.self || !runtime.transport) return;
  const now = Date.now();
  if (!tickBattle.lastHeartbeat || now - tickBattle.lastHeartbeat > 2500) {
    tickBattle.lastHeartbeat = now;
    mergePlayer(selfPresence());
    runtime.transport.send("heartbeat", selfPresence());
  }
  const host = runtime.roomState && runtime.players.get(runtime.roomState.hostId);
  if (runtime.roomState && runtime.roomState.hostId !== runtime.self.playerId && (!host || !host.connected || now - host.lastSeen > HOST_GRACE_MS)) {
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
    if (remaining <= 0 && runtime.game && !runtime.game.finishedAt && !runtime.game.timedOut) finishLocal(true);
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
      finishedAt: Number(result.finishedAt) || null,
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
    const elapsed = result.finishedAt ? result.finishedAt - runtime.roomState.startAt : NaN;
    detail.textContent = `${formatFinish(elapsed, result.timedOut)} · ${result.correct}/${runtime.roomState.deck.length} right`;
    copy.append(name, detail);
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
  const choice = event.target.closest("[data-battle-choice]")?.dataset.battleChoice;
  if (choice) chooseBattleAnswer(choice);
  const reaction = event.target.closest("[data-battle-reaction]")?.dataset.battleReaction;
  if (reaction) sendReaction(reaction);
}, true);

document.addEventListener("keydown", (event) => {
  if (!el("[data-screen='battle-game']")?.classList.contains("is-active") || runtime.game?.locked) return;
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
    roomCode: runtime.invite ? roomCode(runtime.invite.roomId) : null,
    playerId: runtime.self?.playerId || null,
    isHost: isHost(),
    phase: runtime.roomState?.phase || null,
    players: runtime.players.size,
    game: runtime.game ? { index: runtime.game.index, points: runtime.game.points, correct: runtime.game.correct } : null,
  }),
  leave: leaveBattle,
};

initializeBattle();
