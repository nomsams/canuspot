import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 22050;
const G_TONIC = 67;
const THAI_SCALE = [0, 2, 5, 7, 9];
const BRIGHT_SCALE = [0, 2, 4, 7, 9];
const checkOnly = process.argv.includes("--check");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "assets", "audio");

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
const TRACKS = [
  {
    filename: "lantern-courtyard.wav", bpm: 74, scale: THAI_SCALE, voice: "pluck",
    lead: melody("lanternA", "lanternB", "lanternC", "lanternB"),
    bass: [0, 0, -1, 0, 2, 0, -1, 0], ornaments: [4, 12],
  },
  {
    filename: "bamboo-map.wav", bpm: 80, scale: THAI_SCALE, voice: "reed",
    lead: melody("bambooA", "bambooB", "bambooC", "bambooB"),
    bass: [0, -1, 0, 2, 0, 3, 2, 0], ornaments: [2, 10],
  },
  {
    filename: "silk-road-skirmish.wav", bpm: 98, scale: BRIGHT_SCALE, voice: "pluck",
    lead: melody("silkA", "silkB", "silkC", "silkB"),
    bass: [0, 2, 0, -1, 0, 3, 2, 0], ornaments: [6, 14], lively: true,
    arpeggio: [0, 2, 3, 5, 3, 2, 1, 3, 0, 2, 4, 5, 4, 2, 1, 2],
  },
  {
    filename: "temple-steps.wav", bpm: 106, scale: BRIGHT_SCALE, voice: "reed",
    lead: melody("templeA", "templeB", "templeC", "templeB"),
    bass: [0, 0, 2, -1, 0, 3, 2, 0], ornaments: [4, 8, 12], lively: true,
    arpeggio: [0, 3, 2, 5, 4, 2, 3, 5, 2, 4, 5, 7, 5, 4, 3, 2],
  },
  {
    filename: "golden-score.wav", bpm: 78, scale: BRIGHT_SCALE, voice: "bell",
    lead: melody("goldA", "goldB", "goldC", "goldA"),
    bass: [0, 2, 3, 0, 4, 3, 2, 0], ornaments: [8],
  },
];

function midiToFrequency(note) {
  return 440 * (2 ** ((note - 69) / 12));
}

function scaleNote(root, degree, scale) {
  const octave = Math.floor(degree / scale.length);
  const index = ((degree % scale.length) + scale.length) % scale.length;
  return root + octave * 12 + scale[index];
}

function waveform(phase, voice) {
  const turn = phase * Math.PI * 2;
  const fundamental = Math.sin(turn);
  if (voice === "bass") return fundamental * 0.82 + Math.sin(turn * 2) * 0.18;
  if (voice === "bell") return fundamental * 0.74 + Math.sin(turn * 2.01) * 0.2 + Math.sin(turn * 3.99) * 0.06;
  if (voice === "reed") return fundamental * 0.72 + Math.sin(turn * 3) * 0.2 + Math.sin(turn * 5) * 0.08;
  return fundamental * 0.68 + Math.sin(turn * 2) * 0.22 + Math.sin(turn * 3) * 0.1;
}

function addTone(buffer, { start, duration, note, amplitude, voice, glideFrom = null }) {
  const firstSample = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const sampleCount = Math.floor(duration * SAMPLE_RATE);
  const attack = voice === "reed" ? 0.03 : 0.009;
  const release = Math.min(0.09, duration * 0.3);
  let phase = 0;
  for (let offset = 0; offset < sampleCount && firstSample + offset < buffer.length; offset += 1) {
    const time = offset / SAMPLE_RATE;
    const attackGain = Math.min(1, time / attack);
    const releaseGain = Math.min(1, Math.max(0, (duration - time) / release));
    const decay = voice === "pluck" ? 0.22 + 0.78 * Math.exp(-3.1 * time / duration)
      : voice === "bell" ? 0.28 + 0.72 * Math.exp(-2.5 * time / duration) : 1;
    const glideProgress = glideFrom === null ? 1 : Math.min(1, time / 0.06);
    const currentNote = glideFrom === null ? note : glideFrom + (note - glideFrom) * glideProgress;
    const vibrato = voice === "reed" ? Math.sin(time * Math.PI * 9) * 0.035 : 0;
    const frequency = midiToFrequency(currentNote + vibrato);
    phase += frequency / SAMPLE_RATE;
    buffer[firstSample + offset] += waveform(phase, voice) * amplitude * attackGain * releaseGain * decay;
  }
}

function addWoodClick(buffer, start, amplitude) {
  const duration = 0.075;
  const firstSample = Math.floor(start * SAMPLE_RATE);
  let phase = 0;
  for (let offset = 0; offset < duration * SAMPLE_RATE && firstSample + offset < buffer.length; offset += 1) {
    const time = offset / SAMPLE_RATE;
    const frequency = 820 - 470 * (time / duration);
    phase += frequency / SAMPLE_RATE;
    const envelope = Math.sin(Math.min(1, time / 0.004) * Math.PI / 2) * Math.exp(-55 * time);
    buffer[firstSample + offset] += Math.sin(phase * Math.PI * 2) * amplitude * envelope;
  }
}

function finishMix(samples) {
  const edgeSamples = Math.floor(SAMPLE_RATE * 0.018);
  for (let index = 0; index < edgeSamples; index += 1) {
    const gain = index / edgeSamples;
    samples[index] *= gain;
    samples[samples.length - 1 - index] *= gain;
  }
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? 0.82 / peak : 1;
  for (let index = 0; index < samples.length; index += 1) samples[index] *= gain;
}

function renderTrack(track) {
  const beat = 60 / track.bpm;
  const leadStep = beat / 2;
  const duration = beat * 32;
  const samples = new Float32Array(Math.round(duration * SAMPLE_RATE));

  track.lead.forEach((degree, index) => {
    if (degree === null) return;
    const ornament = track.ornaments.includes(index % 16);
    const note = scaleNote(G_TONIC, degree, track.scale);
    addTone(samples, {
      start: index * leadStep,
      duration: leadStep * (track.voice === "bell" ? 1.15 : 0.72),
      note,
      glideFrom: ornament ? scaleNote(G_TONIC, degree - 1, track.scale) : null,
      amplitude: track.voice === "bell" ? 0.14 : 0.17,
      voice: track.voice,
    });
  });

  track.bass.forEach((degree, index) => {
    addTone(samples, {
      start: index * beat * 4,
      duration: beat * 1.35,
      note: scaleNote(G_TONIC - 12, degree, track.scale),
      amplitude: track.lively ? 0.065 : 0.075,
      voice: "bass",
    });
  });

  if (track.arpeggio) {
    for (let step = 0; step < 32; step += 1) {
      const degree = track.arpeggio[step % track.arpeggio.length];
      addTone(samples, {
        start: step * beat + beat * 0.5,
        duration: beat * 0.26,
        note: scaleNote(G_TONIC + 12, degree, track.scale),
        amplitude: step % 8 === 0 ? 0.06 : 0.045,
        voice: "pluck",
      });
    }
  }

  for (let beatIndex = 0; beatIndex < 32; beatIndex += 1) {
    const clickInterval = track.lively ? 2 : 4;
    if (beatIndex % clickInterval === clickInterval - 1) {
      addWoodClick(samples, beatIndex * beat + beat * 0.5, track.lively ? 0.038 : 0.026);
    }
    if (beatIndex % 8 === 0) {
      addTone(samples, {
        start: beatIndex * beat,
        duration: beat * 0.62,
        note: scaleNote(G_TONIC + 12, track.bass[beatIndex / 4] ?? 0, track.scale),
        amplitude: 0.048,
        voice: "bell",
      });
    }
  }

  finishMix(samples);
  return samples;
}

function renderEffect(success) {
  const samples = new Float32Array(Math.round(SAMPLE_RATE * 0.28));
  if (success) {
    addTone(samples, { start: 0, duration: 0.16, note: 74, amplitude: 0.55, voice: "bell" });
    addTone(samples, { start: 0.075, duration: 0.18, note: 79, amplitude: 0.42, voice: "bell" });
  } else {
    addTone(samples, { start: 0, duration: 0.22, note: 55, amplitude: 0.55, voice: "bass", glideFrom: 57 });
  }
  finishMix(samples);
  return samples;
}

function encodeWave(samples) {
  const dataSize = samples.length * 2;
  const output = Buffer.alloc(44 + dataSize);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    output.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return output;
}

async function writeOrCheck(filename, data) {
  const filePath = path.join(outputDirectory, filename);
  if (checkOnly) {
    const current = await readFile(filePath).catch(() => null);
    if (!current || !current.equals(data)) throw new Error(`${filename} is missing or out of date. Run: npm run soundtrack`);
    return;
  }
  await writeFile(filePath, data);
}

await mkdir(outputDirectory, { recursive: true });
for (const track of TRACKS) await writeOrCheck(track.filename, encodeWave(renderTrack(track)));
await writeOrCheck("correct.wav", encodeWave(renderEffect(true)));
await writeOrCheck("wrong.wav", encodeWave(renderEffect(false)));
console.log(checkOnly ? "Pre-rendered soundtrack is current." : "Rendered five soundtrack loops and two answer cues.");
