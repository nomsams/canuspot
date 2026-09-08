(() => {
  "use strict";

  const AUDIO_VERSION = "3";
  const MASTER_VOLUME = 0.34;
  const EFFECT_VOLUME = 0.5;
  const CROSSFADE_MS = 520;
  const TRACKS = {
    lanternCourtyard: { title: "Lantern Courtyard", bpm: 74, src: "assets/audio/lantern-courtyard.wav" },
    bambooMap: { title: "Bamboo Map", bpm: 80, src: "assets/audio/bamboo-map.wav" },
    silkRoadSkirmish: { title: "Silk Road Skirmish", bpm: 98, src: "assets/audio/silk-road-skirmish.wav" },
    templeSteps: { title: "Temple Steps", bpm: 106, src: "assets/audio/temple-steps.wav" },
    goldenScore: { title: "Golden Score", bpm: 78, src: "assets/audio/golden-score.wav" },
  };
  const PLAYLISTS = {
    waiting: ["lanternCourtyard", "bambooMap"],
    battle: ["silkRoadSkirmish", "templeSteps"],
    results: ["goldenScore"],
  };
  const EFFECTS = {
    correct: "assets/audio/correct.wav",
    wrong: "assets/audio/wrong.wav",
  };

  const trackCache = new Map();
  const effectPools = { correct: [], wrong: [] };
  const effectPositions = { correct: 0, wrong: 0 };
  const playingTracks = new Set();
  const playlistPositions = { waiting: 0, battle: 0, results: 0 };
  let scene = null;
  let selectedTuneKey = null;
  let activeTuneKey = null;
  let activeAudio = null;
  let enabled = true;
  let unlocked = false;
  let currentTitle = null;
  let transitionToken = 0;
  let transitionFrame = null;
  let synchronizedEpoch = null;

  const versioned = (src) => `${src}?v=${AUDIO_VERSION}`;

  function createAudio(src, loop = false) {
    const audio = new Audio(versioned(src));
    audio.preload = "auto";
    audio.loop = loop;
    audio.playsInline = true;
    audio.volume = 0;
    return audio;
  }

  function getTrack(tuneKey) {
    if (!trackCache.has(tuneKey)) {
      trackCache.set(tuneKey, createAudio(TRACKS[tuneKey].src, true));
    }
    return trackCache.get(tuneKey);
  }

  function announceTune(tune, phase) {
    window.dispatchEvent(new CustomEvent("spotcheckmusicchange", {
      detail: {
        scene,
        title: tune.title,
        bpm: tune.bpm,
        beatMs: 60000 / tune.bpm,
        phase,
      },
    }));
  }

  function selectTuneForScene(nextScene) {
    const playlist = PLAYLISTS[nextScene];
    const position = playlistPositions[nextScene] % playlist.length;
    selectedTuneKey = playlist[position];
    playlistPositions[nextScene] = (position + 1) % playlist.length;
    currentTitle = TRACKS[selectedTuneKey].title;
    getTrack(selectedTuneKey).load();
    announceTune(TRACKS[selectedTuneKey], "selected");
  }

  function stopTransitions() {
    transitionToken += 1;
    if (transitionFrame !== null) cancelAnimationFrame(transitionFrame);
    transitionFrame = null;
  }

  function stopAllTracks() {
    stopTransitions();
    playingTracks.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0;
    });
    playingTracks.clear();
    activeAudio = null;
    activeTuneKey = null;
  }

  function alignToEpoch(epochMs = synchronizedEpoch) {
    if (!activeAudio || activeAudio.paused || !Number.isFinite(epochMs) || !Number.isFinite(activeAudio.duration) || activeAudio.duration <= 0) return false;
    const elapsedSeconds = Math.max(0, (Date.now() - epochMs) / 1000);
    const desired = elapsedSeconds % activeAudio.duration;
    const directDrift = Math.abs(activeAudio.currentTime - desired);
    const wrappedDrift = Math.min(directDrift, Math.abs(activeAudio.duration - directDrift));
    if (wrappedDrift > 0.28) activeAudio.currentTime = desired;
    return true;
  }

  async function transitionToSelected() {
    if (!enabled || !unlocked || !selectedTuneKey || typeof Audio !== "function") return false;
    const tuneKey = selectedTuneKey;
    const tune = TRACKS[tuneKey];
    const nextAudio = getTrack(tuneKey);

    if (activeTuneKey === tuneKey && activeAudio === nextAudio && !nextAudio.paused) {
      nextAudio.volume = MASTER_VOLUME;
      return true;
    }

    stopTransitions();
    const token = transitionToken;
    const outgoing = Array.from(playingTracks).filter((audio) => audio !== nextAudio);
    const outgoingVolumes = outgoing.map((audio) => audio.volume);
    const nextStartVolume = nextAudio.paused ? 0 : nextAudio.volume;

    if (nextAudio.paused) {
      nextAudio.currentTime = 0;
      nextAudio.volume = 0;
      try {
        await nextAudio.play();
      } catch (_) {
        return false;
      }
    }

    if (token !== transitionToken || tuneKey !== selectedTuneKey || !enabled) {
      const claimedByNewerTransition = activeAudio === nextAudio && activeTuneKey === tuneKey && enabled;
      if (!claimedByNewerTransition) {
        nextAudio.pause();
        nextAudio.currentTime = 0;
        nextAudio.volume = 0;
      }
      return claimedByNewerTransition;
    }

    playingTracks.add(nextAudio);
    activeAudio = nextAudio;
    activeTuneKey = tuneKey;
    currentTitle = tune.title;
    alignToEpoch();
    announceTune(tune, "playing");

    const startedAt = performance.now();
    const fade = (now) => {
      if (token !== transitionToken) return;
      const progress = Math.max(0, Math.min(1, (now - startedAt) / CROSSFADE_MS));
      nextAudio.volume = nextStartVolume + (MASTER_VOLUME - nextStartVolume) * progress;
      outgoing.forEach((audio, index) => {
        audio.volume = Math.max(0, outgoingVolumes[index] * (1 - progress));
      });

      if (progress < 1) {
        transitionFrame = requestAnimationFrame(fade);
        return;
      }

      outgoing.forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 0;
        playingTracks.delete(audio);
      });
      transitionFrame = null;
    };
    transitionFrame = requestAnimationFrame(fade);
    return true;
  }

  async function unlock() {
    if (!enabled || typeof Audio !== "function") return false;
    unlocked = true;
    return transitionToSelected();
  }

  function setScene(nextScene) {
    if (!PLAYLISTS[nextScene]) return;
    synchronizedEpoch = null;
    const changed = scene !== nextScene || !selectedTuneKey;
    if (changed) {
      scene = nextScene;
      selectTuneForScene(nextScene);
    }
    if (changed && enabled && unlocked) transitionToSelected().catch(() => {});
  }

  function setSynchronizedScene(nextScene, tuneIndex = 0, epochMs = Date.now()) {
    if (!PLAYLISTS[nextScene]) return;
    const playlist = PLAYLISTS[nextScene];
    const position = Math.abs(Math.trunc(Number(tuneIndex) || 0)) % playlist.length;
    const tuneKey = playlist[position];
    const changed = scene !== nextScene || selectedTuneKey !== tuneKey;
    scene = nextScene;
    selectedTuneKey = tuneKey;
    currentTitle = TRACKS[tuneKey].title;
    synchronizedEpoch = Number(epochMs);
    getTrack(tuneKey).load();
    announceTune(TRACKS[tuneKey], "selected");
    if (changed && enabled && unlocked) transitionToSelected().catch(() => {});
    else alignToEpoch();
  }

  function syncToEpoch(epochMs) {
    synchronizedEpoch = Number(epochMs);
    return alignToEpoch();
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      stopAllTracks();
      Object.values(effectPools).flat().forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
      });
      return;
    }
    if (unlocked) transitionToSelected().catch(() => {});
  }

  function getEffect(kind) {
    const pool = effectPools[kind];
    while (pool.length < 2) pool.push(createAudio(EFFECTS[kind]));
    const position = effectPositions[kind] % pool.length;
    effectPositions[kind] = position + 1;
    return pool[position];
  }

  function playEffect(success) {
    if (!enabled || !unlocked || typeof Audio !== "function") return;
    const effect = getEffect(success ? "correct" : "wrong");
    effect.pause();
    effect.currentTime = 0;
    effect.volume = EFFECT_VOLUME;
    effect.play().catch(() => {});
  }

  function getStatus() {
    return {
      supported: typeof Audio === "function",
      enabled,
      scene,
      activeScene: activeTuneKey ? scene : null,
      activeTuneKey,
      title: currentTitle,
      bpm: selectedTuneKey ? TRACKS[selectedTuneKey].bpm : null,
      contextState: activeAudio && !activeAudio.paused ? "running" : "not-playing",
      playback: "pre-rendered-audio",
      tuneCount: Object.keys(TRACKS).length,
    };
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && enabled && unlocked && (!activeAudio || activeAudio.paused)) {
      transitionToSelected().catch(() => {});
    }
  });

  window.SpotCheckMusic = { getStatus, playEffect, setEnabled, setScene, setSynchronizedScene, syncToEpoch, unlock };
})();
