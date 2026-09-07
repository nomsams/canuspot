(() => {
  "use strict";

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const G_TONIC = 67;
  const SCALE = [0, 2, 5, 7, 9];
  const BRIGHT_SCALE = [0, 2, 4, 7, 9];
  const PHRASES = {
    lanternA: [0, 2, 3, 4, 3, 2, 0, null, 0, 2, 3, 5, 4, 3, 2, null],
    lanternB: [2, 3, 4, 5, 4, 3, 2, 0, 2, 4, 3, 2, 0, -1, 0, null],
    lanternC: [4, 5, 7, 5, 4, 3, 2, null, 3, 4, 5, 4, 2, 3, 0, null],
    bambooA: [0, null, 2, 3, 5, 4, 3, null, 2, 3, 4, 2, 0, 2, 3, null],
    bambooB: [4, 5, 7, 5, 4, 3, 2, 0, 2, 4, 5, 4, 2, 0, -1, null],
    bambooC: [0, 2, 3, 4, 5, 4, 2, null, 3, 2, 0, 2, 3, 2, 0, null],
    silkA: [0, 2, 3, 5, 3, 2, 1, 2, 0, 2, 3, 4, 5, 4, 3, null],
    silkB: [2, 3, 5, 7, 5, 4, 3, 2, 4, 5, 4, 3, 2, 1, 0, null],
    silkC: [5, 4, 3, 2, 3, 4, 5, null, 7, 5, 4, 3, 2, 3, 0, null],
    templeA: [0, 3, 2, 4, 3, 5, 4, 2, 0, 2, 4, 5, 7, 5, 4, null],
    templeB: [2, 5, 4, 7, 5, 4, 3, 2, 4, 3, 2, 0, 2, 3, 5, null],
    templeC: [5, 7, 5, 4, 3, 4, 5, 3, 2, 4, 3, 2, 0, 2, 0, null],
    goldA: [0, 2, 3, 5, 7, 5, 4, 3, 2, 4, 5, 4, 2, 0, 2, null],
    goldB: [4, 5, 7, 9, 7, 5, 4, 3, 2, 3, 5, 4, 2, 0, -1, null],
    goldC: [0, 3, 5, 4, 2, 4, 3, 2, 0, 2, 4, 5, 4, 2, 0, null],
  };

  const melody = (...phrases) => phrases.flatMap((name) => PHRASES[name]);
  const TUNES = {
    lanternCourtyard: {
      title: "Lantern Courtyard",
      bpm: 74,
      root: G_TONIC,
      voice: "pluck",
      lead: melody("lanternA", "lanternB", "lanternC", "lanternB"),
      bass: [0, 0, -1, 0, 2, 0, -1, 0],
      ornaments: [4, 12],
    },
    bambooMap: {
      title: "Bamboo Map",
      bpm: 80,
      root: G_TONIC,
      voice: "reed",
      lead: melody("bambooA", "bambooB", "bambooC", "bambooB"),
      bass: [0, -1, 0, 2, 0, 3, 2, 0],
      ornaments: [2, 10],
    },
    silkRoadSkirmish: {
      title: "Silk Road Skirmish",
      bpm: 98,
      root: G_TONIC,
      scale: BRIGHT_SCALE,
      voice: "pluck",
      lead: melody("silkA", "silkB", "silkC", "silkB"),
      bass: [0, 2, 0, -1, 0, 3, 2, 0],
      arpeggio: [0, 2, 3, 5, 3, 2, 1, 3, 0, 2, 4, 5, 4, 2, 1, 2],
      arpeggioOctave: 12,
      ornaments: [6, 14],
      lively: true,
    },
    templeSteps: {
      title: "Temple Steps",
      bpm: 106,
      root: G_TONIC,
      scale: BRIGHT_SCALE,
      voice: "reed",
      lead: melody("templeA", "templeB", "templeC", "templeB"),
      bass: [0, 0, 2, -1, 0, 3, 2, 0],
      arpeggio: [0, 3, 2, 5, 4, 2, 3, 5, 2, 4, 5, 7, 5, 4, 3, 2],
      arpeggioOctave: 12,
      ornaments: [4, 8, 12],
      lively: true,
    },
    goldenScore: {
      title: "Golden Score",
      bpm: 78,
      root: G_TONIC,
      scale: BRIGHT_SCALE,
      voice: "bell",
      lead: melody("goldA", "goldB", "goldC", "goldA"),
      bass: [0, 2, 3, 0, 4, 3, 2, 0],
      ornaments: [8],
    },
  };

  const PLAYLISTS = {
    waiting: ["lanternCourtyard", "bambooMap"],
    battle: ["silkRoadSkirmish", "templeSteps"],
    results: ["goldenScore"],
  };
  const TUNE_CYCLES_PER_PASS = 1;
  const LOOP_CROSSFADE_SECONDS = 0.48;
  const SCENE_CROSSFADE_SECONDS = 0.9;

  let context = null;
  let musicBus = null;
  let effectsBus = null;
  let activeTrack = null;
  let loopTimer = null;
  let scene = null;
  let activeScene = null;
  let activeTuneKey = null;
  let selectedTuneKey = null;
  let enabled = true;
  let currentTitle = null;
  const playlistPositions = { waiting: 0, battle: 0, results: 0 };

  function midiToFrequency(note) {
    return 440 * (2 ** ((note - 69) / 12));
  }

  function scaleNote(root, degree, scale = SCALE) {
    const octave = Math.floor(degree / scale.length);
    const index = ((degree % scale.length) + scale.length) % scale.length;
    return root + octave * 12 + scale[index];
  }

  function createContext() {
    if (context || !AudioContextClass) return context;
    context = new AudioContextClass();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.24;
    compressor.connect(context.destination);

    musicBus = context.createGain();
    musicBus.gain.value = 0.068;
    musicBus.connect(compressor);
    effectsBus = context.createGain();
    effectsBus.gain.value = 0.34;
    effectsBus.connect(compressor);

    return context;
  }

  function scheduleTone(note, start, duration, velocity, voice, destination, sources, glideFrom = null) {
    const frequency = midiToFrequency(note);
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = voice === "bass" ? 760 : voice === "reed" ? 1900 : voice === "bell" ? 3500 : 2800;
    filter.Q.value = voice === "reed" ? 2.1 : 0.7;
    filter.connect(envelope);
    envelope.connect(destination);

    const attack = voice === "reed" ? 0.035 : 0.012;
    const releaseAt = start + Math.max(attack + 0.04, duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, velocity), start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, releaseAt);

    const oscillator = context.createOscillator();
    oscillator.type = voice === "reed" ? "square" : voice === "bell" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(glideFrom === null ? frequency : midiToFrequency(glideFrom), start);
    if (glideFrom !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(frequency, start + Math.min(0.065, duration * 0.25));
    }
    oscillator.connect(filter);
    sources.push(oscillator);
    oscillator.start(start);
    oscillator.stop(releaseAt + 0.08);
  }

  function scheduleWoodClick(start, velocity, destination, sources) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(860, start);
    oscillator.frequency.exponentialRampToValueAtTime(420, start + 0.045);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0002, velocity), start + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.065);
    oscillator.connect(envelope).connect(destination);
    sources.push(oscillator);
    oscillator.start(start);
    oscillator.stop(start + 0.08);
  }

  function createPercussionBus(destination) {
    const softener = context.createBiquadFilter();
    const headroom = context.createGain();
    softener.type = "lowpass";
    softener.frequency.value = 8600;
    softener.Q.value = 0.25;
    headroom.gain.value = 0.5;
    softener.connect(headroom).connect(destination);
    return softener;
  }

  function scheduleTuneCycle(tune, start, track) {
    const beat = 60 / tune.bpm;
    const leadStep = beat / 2;
    const tuneScale = tune.scale || SCALE;
    const destination = track.gain;
    const percussionBus = createPercussionBus(destination);
    tune.lead.forEach((degree, index) => {
      if (degree === null) return;
      const noteStart = start + index * leadStep;
      const ornament = tune.ornaments.includes(index % 16);
      scheduleTone(
        scaleNote(tune.root, degree, tuneScale),
        noteStart,
        leadStep * (tune.voice === "bell" ? 1.15 : 0.72),
        tune.voice === "bell" ? 0.13 : 0.115,
        tune.voice,
        destination,
        track.sources,
        ornament ? scaleNote(tune.root, degree - 1, tuneScale) : null,
      );
    });

    tune.bass.forEach((degree, index) => {
      const velocity = tune.lively ? 0.052 : 0.062;
      scheduleTone(scaleNote(tune.root - 12, degree, tuneScale), start + index * beat * 4, beat * 1.45, velocity, "bass", destination, track.sources);
    });

    if (tune.arpeggio) {
      const arpeggioStep = beat;
      for (let step = 0; step < 32; step += 1) {
        const degree = tune.arpeggio[step % tune.arpeggio.length];
        const accent = step % 8 === 0 ? 0.044 : 0.03;
        scheduleTone(
          scaleNote(tune.root + (tune.arpeggioOctave ?? 12), degree, tuneScale),
          start + step * arpeggioStep + beat * 0.5,
          beat * 0.28,
          accent,
          "pluck",
          destination,
          track.sources,
        );
      }
    }

    for (let beatIndex = 0; beatIndex < 32; beatIndex += 1) {
      const beatStart = start + beatIndex * beat;
      const clickInterval = tune.lively ? 2 : 4;
      if (beatIndex % clickInterval === clickInterval - 1) {
        scheduleWoodClick(beatStart + beat * 0.5, tune.lively ? 0.027 : 0.018, percussionBus, track.sources);
      }
      if (beatIndex % 8 === 0) {
        scheduleTone(scaleNote(tune.root + 12, tune.bass[beatIndex / 4] ?? 0, tuneScale), beatStart, beat * 0.65, 0.038, "bell", destination, track.sources);
      }
    }
    return beat * 32;
  }

  function scheduleTune(tune, start, track) {
    const cycleDuration = (60 / tune.bpm) * 32;
    for (let cycle = 0; cycle < TUNE_CYCLES_PER_PASS; cycle += 1) {
      scheduleTuneCycle(tune, start + cycle * cycleDuration, track);
    }
    return cycleDuration * TUNE_CYCLES_PER_PASS;
  }

  function announceTune(tune, phase) {
    const beatMs = 60000 / tune.bpm;
    window.dispatchEvent(new CustomEvent("spotcheckmusicchange", {
      detail: { scene, title: tune.title, bpm: tune.bpm, beatMs, phase },
    }));
  }

  function selectTuneForScene(nextScene) {
    const playlist = PLAYLISTS[nextScene];
    const position = playlistPositions[nextScene] % playlist.length;
    selectedTuneKey = playlist[position];
    playlistPositions[nextScene] = (position + 1) % playlist.length;
    currentTitle = TUNES[selectedTuneKey].title;
    announceTune(TUNES[selectedTuneKey], "selected");
  }

  function stopTrack(fadeSeconds = 0.35) {
    clearTimeout(loopTimer);
    loopTimer = null;
    if (!context || !activeTrack) return;
    const now = context.currentTime;
    const gain = activeTrack.gain.gain;
    if (typeof gain.cancelAndHoldAtTime === "function") {
      gain.cancelAndHoldAtTime(now);
    } else {
      const currentGain = Math.max(0.0001, gain.value);
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(currentGain, now);
    }
    gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
    const retiringTrack = activeTrack;
    const stopAt = now + fadeSeconds + 0.04;
    retiringTrack.sources.forEach((source) => {
      try { source.stop(stopAt); } catch (_) { /* The source may have already ended. */ }
    });
    window.setTimeout(() => {
      retiringTrack.sources.forEach((source) => {
        try { source.disconnect(); } catch (_) { /* The source may already be detached. */ }
      });
      retiringTrack.sources.length = 0;
      retiringTrack.gain.disconnect();
    }, (fadeSeconds + 0.12) * 1000);
    activeTrack = null;
    activeScene = null;
    activeTuneKey = null;
  }

  function playSelectedTune(fadeSeconds = LOOP_CROSSFADE_SECONDS) {
    if (!enabled || !context || context.state === "closed" || !selectedTuneKey) return;
    const scheduledTuneKey = selectedTuneKey;
    const tune = TUNES[scheduledTuneKey];
    stopTrack(fadeSeconds);

    const start = context.currentTime + 0.06;
    const track = { gain: context.createGain(), sources: [] };
    track.gain.gain.setValueAtTime(0.0001, context.currentTime);
    track.gain.gain.exponentialRampToValueAtTime(1, start + fadeSeconds);
    track.gain.connect(musicBus);
    activeTrack = track;
    activeScene = scene;
    activeTuneKey = scheduledTuneKey;
    currentTitle = tune.title;
    const duration = scheduleTune(tune, start, track);
    const scheduledScene = scene;
    announceTune(tune, "playing");
    loopTimer = window.setTimeout(() => {
      if (enabled && scene === scheduledScene && selectedTuneKey === scheduledTuneKey) {
        playSelectedTune(LOOP_CROSSFADE_SECONDS);
      }
    }, Math.max(1000, (duration - LOOP_CROSSFADE_SECONDS * 0.75) * 1000));
  }

  async function unlock() {
    if (!enabled || !AudioContextClass) return false;
    createContext();
    if (context.state === "suspended") await context.resume();
    if (!activeTrack || activeScene !== scene || activeTuneKey !== selectedTuneKey) playSelectedTune(0.55);
    return context.state === "running";
  }

  function setScene(nextScene) {
    if (!PLAYLISTS[nextScene]) return;
    const sceneChanged = scene !== nextScene || !selectedTuneKey;
    if (sceneChanged) {
      scene = nextScene;
      selectTuneForScene(nextScene);
    }
    if (enabled && context && context.state !== "closed") {
      if (context.state === "suspended") context.resume().catch(() => {});
      if (sceneChanged || !activeTrack || activeScene !== scene || activeTuneKey !== selectedTuneKey) {
        playSelectedTune(sceneChanged ? SCENE_CROSSFADE_SECONDS : LOOP_CROSSFADE_SECONDS);
      }
    }
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      stopTrack(0.22);
      return;
    }
    if (context) unlock().catch(() => {});
  }

  function playEffect(success) {
    if (!enabled || !AudioContextClass) return;
    createContext();
    if (context.state === "suspended") context.resume().catch(() => {});
    const now = context.currentTime + 0.01;
    const effectSources = [];
    scheduleTone(success ? 72 : 55, now, 0.12, 0.1, success ? "bell" : "bass", effectsBus, effectSources);
    if (success) scheduleTone(79, now + 0.065, 0.11, 0.07, "bell", effectsBus, effectSources);
  }

  function getStatus() {
    return {
      supported: Boolean(AudioContextClass),
      enabled,
      scene,
      activeScene,
      activeTuneKey,
      title: currentTitle,
      bpm: selectedTuneKey ? TUNES[selectedTuneKey].bpm : null,
      contextState: context?.state || "not-started",
      scheduledSourceCount: activeTrack?.sources.length || 0,
      tuneCount: Object.keys(TUNES).length,
    };
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && enabled && context) unlock().catch(() => {});
  });

  window.SpotCheckMusic = { getStatus, playEffect, setEnabled, setScene, unlock };
})();
