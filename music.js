(() => {
  "use strict";

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const SCALE = [0, 3, 5, 7, 10];
  const PHRASES = {
    lanternA: [0, 2, 4, 2, 3, 2, 0, null, 2, 4, 5, 4, 2, 0, -1, null],
    lanternB: [0, 2, 4, 5, 4, 2, 3, 2, 0, -1, 0, 2, 0, null, null, null],
    lanternC: [2, 3, 5, 4, 3, 2, 0, 2, 4, 3, 2, 0, -1, 0, 2, null],
    bambooA: [0, null, 2, 3, 4, 3, 2, null, 5, 4, 3, 2, 0, 2, 3, null],
    bambooB: [4, 5, 7, 5, 4, 3, 2, 0, 2, 3, 4, 2, 0, -1, 0, null],
    bambooC: [0, 2, 3, 4, 3, 2, 0, -1, 0, 2, 4, 3, 2, null, 0, null],
    silkA: [0, 2, 3, 4, 5, 4, 3, 2, 4, 5, 7, 5, 4, 2, 3, null],
    silkB: [2, 4, 5, 4, 2, 3, 4, 2, 0, 2, 3, 0, -1, 0, 2, null],
    silkC: [5, 4, 3, 2, 4, 3, 2, 0, 2, 4, 3, 5, 4, 2, 0, null],
    templeA: [0, 3, 2, 4, 3, 5, 4, 2, 0, 2, 4, 5, 4, 3, 2, null],
    templeB: [2, 5, 4, 7, 5, 4, 3, 2, 4, 3, 2, 0, -1, 0, 2, null],
    templeC: [0, 2, 4, 3, 5, 4, 2, 3, 0, -1, 0, 3, 2, 0, -1, null],
    goldA: [0, 2, 4, 5, 7, 5, 4, 2, 3, 4, 5, 4, 2, 0, 2, null],
    goldB: [4, 5, 7, 9, 7, 5, 4, 3, 2, 4, 5, 4, 2, 0, -1, null],
    goldC: [0, 3, 5, 4, 2, 4, 3, 2, 0, 2, 4, 5, 4, 2, 0, null],
  };

  const melody = (...phrases) => phrases.flatMap((name) => PHRASES[name]);
  const TUNES = {
    lanternCourtyard: {
      title: "Lantern Courtyard",
      bpm: 74,
      root: 62,
      voice: "pluck",
      lead: melody("lanternA", "lanternB", "lanternC", "lanternB"),
      bass: [0, 0, -1, 0, 2, 0, -1, 0],
      ornaments: [4, 12],
    },
    bambooMap: {
      title: "Bamboo Map",
      bpm: 80,
      root: 65,
      voice: "reed",
      lead: melody("bambooA", "bambooB", "bambooC", "bambooB"),
      bass: [0, -1, 0, 2, 0, 3, 2, 0],
      ornaments: [2, 10],
    },
    silkRoadSkirmish: {
      title: "Silk Road Skirmish",
      bpm: 98,
      root: 62,
      voice: "pluck",
      lead: melody("silkA", "silkB", "silkC", "silkB"),
      bass: [0, 2, 0, -1, 0, 3, 2, 0],
      ornaments: [6, 14],
      lively: true,
    },
    templeSteps: {
      title: "Temple Steps",
      bpm: 106,
      root: 60,
      voice: "reed",
      lead: melody("templeA", "templeB", "templeC", "templeB"),
      bass: [0, 0, 2, -1, 0, 3, 2, 0],
      ornaments: [4, 8, 12],
      lively: true,
    },
    goldenScore: {
      title: "Golden Score",
      bpm: 78,
      root: 65,
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
  const TUNE_CYCLES_PER_PASS = 2;

  let context = null;
  let musicBus = null;
  let effectsBus = null;
  let noiseBuffer = null;
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

  function scaleNote(root, degree) {
    const octave = Math.floor(degree / SCALE.length);
    const index = ((degree % SCALE.length) + SCALE.length) % SCALE.length;
    return root + octave * 12 + SCALE[index];
  }

  function createContext() {
    if (context || !AudioContextClass) return context;
    context = new AudioContextClass();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.35;
    compressor.connect(context.destination);

    musicBus = context.createGain();
    musicBus.gain.value = 0.065;
    musicBus.connect(compressor);
    effectsBus = context.createGain();
    effectsBus.gain.value = 0.34;
    effectsBus.connect(compressor);

    noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }
    return context;
  }

  function connectWithPan(source, pan, destination) {
    if (!context.createStereoPanner) {
      source.connect(destination);
      return;
    }
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    source.connect(panner).connect(destination);
  }

  function scheduleTone(note, start, duration, velocity, voice, destination, pan = 0) {
    const frequency = midiToFrequency(note);
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = voice === "bass" ? 620 : voice === "reed" ? 2100 : 3200;
    filter.Q.value = voice === "reed" ? 3.2 : 0.8;
    filter.connect(envelope);
    connectWithPan(envelope, pan, destination);

    const attack = voice === "reed" ? 0.055 : 0.012;
    const releaseAt = start + Math.max(attack + 0.04, duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, velocity), start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, releaseAt);

    const oscillator = context.createOscillator();
    oscillator.type = voice === "bass" ? "triangle" : voice === "reed" ? "square" : "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.connect(filter);

    let overtone = null;
    if (voice === "pluck" || voice === "bell") {
      overtone = context.createOscillator();
      const overtoneGain = context.createGain();
      overtone.type = "sine";
      overtone.frequency.setValueAtTime(frequency * (voice === "bell" ? 2.01 : 2), start);
      overtoneGain.gain.value = voice === "bell" ? 0.26 : 0.12;
      overtone.connect(overtoneGain).connect(filter);
      overtone.start(start);
      overtone.stop(releaseAt + 0.08);
    }

    let vibrato = null;
    if (voice === "reed") {
      vibrato = context.createOscillator();
      const vibratoDepth = context.createGain();
      vibrato.frequency.value = 5.1;
      vibratoDepth.gain.value = 1.25;
      vibrato.connect(vibratoDepth).connect(oscillator.frequency);
      vibrato.start(start);
      vibrato.stop(releaseAt + 0.08);
    }

    oscillator.start(start);
    oscillator.stop(releaseAt + 0.08);
  }

  function scheduleShaker(start, velocity, destination, pan = 0) {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = "highpass";
    filter.frequency.value = 5200;
    envelope.gain.setValueAtTime(Math.max(0.0001, velocity), start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);
    source.connect(filter).connect(envelope);
    connectWithPan(envelope, pan, destination);
    source.start(start);
    source.stop(start + 0.07);
  }

  function scheduleWoodClick(start, velocity, destination) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(860, start);
    oscillator.frequency.exponentialRampToValueAtTime(420, start + 0.045);
    envelope.gain.setValueAtTime(Math.max(0.0001, velocity), start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);
    oscillator.connect(envelope).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + 0.07);
  }

  function scheduleTuneCycle(tune, start, destination) {
    const beat = 60 / tune.bpm;
    const leadStep = beat / 2;
    tune.lead.forEach((degree, index) => {
      if (degree === null) return;
      const noteStart = start + index * leadStep;
      const ornament = tune.ornaments.includes(index % 16);
      if (ornament) {
        scheduleTone(scaleNote(tune.root, degree - 1), noteStart, leadStep * 0.18, 0.09, "pluck", destination, -0.12);
      }
      scheduleTone(
        scaleNote(tune.root, degree),
        noteStart + (ornament ? leadStep * 0.16 : 0),
        leadStep * (tune.voice === "bell" ? 1.5 : 0.78),
        tune.voice === "bell" ? 0.14 : 0.11,
        tune.voice,
        destination,
        0.08,
      );
    });

    tune.bass.forEach((degree, index) => {
      scheduleTone(scaleNote(tune.root - 24, degree), start + index * beat * 4, beat * 3.4, 0.12, "bass", destination, -0.08);
    });

    for (let beatIndex = 0; beatIndex < 32; beatIndex += 1) {
      const beatStart = start + beatIndex * beat;
      scheduleShaker(beatStart + beat * 0.5, tune.lively ? 0.028 : 0.018, destination, beatIndex % 2 ? 0.18 : -0.18);
      if (beatIndex % 4 === 1 || (tune.lively && beatIndex % 4 === 3)) {
        scheduleWoodClick(beatStart, tune.lively ? 0.035 : 0.024, destination);
      }
      if (beatIndex % 8 === 0) {
        scheduleTone(scaleNote(tune.root - 12, tune.bass[beatIndex / 4] ?? 0), beatStart, beat * 2.6, 0.06, "bell", destination, 0.2);
      }
    }
    return beat * 32;
  }

  function scheduleTune(tune, start, destination) {
    const cycleDuration = (60 / tune.bpm) * 32;
    for (let cycle = 0; cycle < TUNE_CYCLES_PER_PASS; cycle += 1) {
      scheduleTuneCycle(tune, start + cycle * cycleDuration, destination);
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
    activeTrack.gain.cancelScheduledValues(now);
    activeTrack.gain.setValueAtTime(Math.max(0.0001, activeTrack.gain.value), now);
    activeTrack.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
    const retiringTrack = activeTrack;
    window.setTimeout(() => retiringTrack.disconnect(), (fadeSeconds + 0.2) * 1000);
    activeTrack = null;
    activeScene = null;
    activeTuneKey = null;
  }

  function playSelectedTune() {
    if (!enabled || !context || context.state === "closed" || !selectedTuneKey) return;
    const scheduledTuneKey = selectedTuneKey;
    const tune = TUNES[scheduledTuneKey];
    stopTrack(0.45);

    const start = context.currentTime + 0.09;
    const track = context.createGain();
    track.gain.setValueAtTime(0.0001, start);
    track.gain.exponentialRampToValueAtTime(1, start + 0.75);
    track.connect(musicBus);
    activeTrack = track;
    activeScene = scene;
    activeTuneKey = scheduledTuneKey;
    currentTitle = tune.title;
    const duration = scheduleTune(tune, start, track);
    const scheduledScene = scene;
    announceTune(tune, "playing");
    loopTimer = window.setTimeout(() => {
      if (enabled && scene === scheduledScene && selectedTuneKey === scheduledTuneKey) playSelectedTune();
    }, Math.max(1000, (duration - 0.3) * 1000));
  }

  async function unlock() {
    if (!enabled || !AudioContextClass) return false;
    createContext();
    if (context.state === "suspended") await context.resume();
    if (!activeTrack || activeScene !== scene || activeTuneKey !== selectedTuneKey) playSelectedTune();
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
        playSelectedTune();
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
    scheduleTone(success ? 72 : 55, now, 0.12, 0.1, success ? "bell" : "bass", effectsBus);
    if (success) scheduleTone(79, now + 0.065, 0.11, 0.07, "bell", effectsBus, 0.1);
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
      tuneCount: Object.keys(TUNES).length,
    };
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && enabled && context) unlock().catch(() => {});
  });

  window.SpotCheckMusic = { getStatus, playEffect, setEnabled, setScene, unlock };
})();
