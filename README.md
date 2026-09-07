# Spot Check

A dependency-free, mobile-first swipe quiz for GitHub Pages. It presents up to 10 balanced portrait cards, supports horizontal drag plus explicit choice buttons, and offers focal-point pinch zoom capped at 1.8×. It calculates a score, assigns a humorous level, and shows a red–orange–green result meter.

The quiz also includes answer undo, keyboard controls, answer review with swipe navigation, persistent per-mode personal stats, daily streaks, a monkey benchmark, and a device-local leaderboard. Rounds use only supplied photo assets and automatically grow to 10 when enough assets are available.

This implementation uses creator-labelled portrait categories (woman/trans-woman or man/trans-man). It is a perception quiz — not a claim about anyone's identity.

## Run locally

The manifest is loaded with `fetch`, so open the site through a local web server rather than double-clicking `index.html`:

```powershell
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Add your own assets

### Quick import for `lady…` and `ldb…` files

Drop `.jpg`, `.jpeg`, `.png`, `.webp`, or `.avif` files into `assets/unsorted/`, then run:

```powershell
npm run assets
```

The generator updates `assets/manifest.json` while preserving valid manually managed entries:

- filenames beginning with `lady` are added as `woman`
- filenames beginning with `ldb` are added as `trans-woman`
- other filenames are ignored with a warning

Names are matched case-insensitively, so adding more numbered files only requires rerunning the command. The file name becomes part of a stable internal ID but is not shown as the portrait title.

Generated images default to a top-safe focal point of `50% 0%`. This preserves the complete top edge even when a photo needs cover cropping. To adjust horizontal framing without editing generated data, add an entry to `assets/focus-overrides.json`:

```json
{
  "example.jpg": { "x": 65, "y": 0 }
}
```

Both values are percentages from the image's top-left corner. Keep `y` at `0` to guarantee that the top edge remains visible. Rerun `npm run assets` after changing the overrides. Use `npm run check` to verify that the manifest is current.

### Face-aware focal points

The included Python 3 utility uses OpenCV YuNet to detect the primary face and generate a horizontal focal point for every imported image while pinning the vertical focus to the top edge:

```powershell
python -m pip install -r requirements-face-focus.txt
python scripts/detect-face-focus.py --model path/to/face_detection_yunet_2026may.onnx
npm run assets
```

Download the YuNet model from the official [OpenCV Zoo face detector](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet). Add `--preview face-preview.jpg` to produce a contact sheet for visual QA. Run the detector again after adding portraits, then review any unusual pose manually in `assets/focus-overrides.json`.

### Manual category folders

For fully manual manifests, the project supports **four category folders**:

1. `assets/women/` — Portraits of cisgender women
2. `assets/trans-woman-man/` — Portraits of trans women (MTF)
3. `assets/trans-man-woman/` — Portraits of trans men (FTM)
4. `assets/men/` — Portraits of cisgender men

### Image requirements
- Format: WebP or AVIF recommended
- Any aspect ratio is supported; the phone card uses a less aggressive, near-square cover crop around the detected face
- Minimum 10 images per answer group for good randomization

### Manifest format
Add each image to `assets/manifest.json` with:
- `id` — stable, non-identifying identifier
- `src` — path to image
- `title` — optional internal name; it is not displayed in the interface
- `alt` — accessible description
- `category` — one of: `woman`, `trans-woman`, `trans-man`, `man`
- `focus` — optional crop focus such as `{ "x": 50, "y": 0 }`
- `labels` — object with the correct answer for each applicable mode:
  - `woman_trans`: `"woman"` or `"trans"`
  - `man_trans`: `"man"` or `"trans"`

Example:
```json
{"id":"w-01","src":"assets/women/portrait-01.webp","title":"Portrait 1","alt":"Woman portrait","category":"woman","labels":{"woman_trans":"woman"}}
{"id":"twm-01","src":"assets/trans-woman-man/portrait-01.webp","title":"Portrait 2","alt":"Trans woman (MTF) portrait","category":"trans-woman","labels":{"woman_trans":"trans"}}
```

Only use images you own or have explicit permission to publish. If real people are pictured, obtain consent for this exact quiz context. Avoid identity, health, ethnicity, sexuality, or other sensitive-trait guessing games.

## Quiz modes

- **Lady / Ladyboy** — Guess between the supplied `lady…` and `ldb…` image groups
- **Man / Trans man** — Available when both matching manual image groups have content

Toggle modes using the header button. A mode without at least one image for each answer is hidden automatically. A round only includes cards whose category and answer both belong to that mode, and the deck alternates between the two answer groups before shuffling so one label cannot dominate the quiz.

## Original soundtrack

`music.js` contains five original, procedurally synthesized tunes with a quiet retro-fantasy character and Thai-inspired pentatonic ornamentation. It uses the browser's Web Audio API—there are no copied melodies, recordings, samples, external music requests, or audio files to host.

- Waiting screen: **Lantern Courtyard** or **Bamboo Map**, rotating on the next visit
- Quiz screen: **Silk Road Skirmish** or **Temple Steps**, rotating on the next round
- Results and review screens: **Golden Score** loops

Each scene keeps its selected tune and loops it indefinitely instead of switching tracks mid-screen. Tunes are scheduled one 32-beat cycle at a time, and only rotate when the visitor later returns to that scene. Their BPM is exposed to the interface so the intro word reel, card timing, score reveals, meter, monkey, and music indicator move on beat. Music is enabled by default, begins after the visitor's first interaction to respect browser autoplay rules, and crossfades when the screen changes. The header music button mutes both the score and answer sounds; that preference is saved locally.

The two quiz themes use a brighter pentatonic tuning, original singable retro-fantasy hooks, offbeat plucked arpeggios, and short octave bass anchors. The result is happier and more game-like while the battle phase keeps its lift and forward motion without overpowering the portraits.

All five themes share G as their tonal center. The calm scenes use a suspended G pentatonic scale while battle and results use the closely related G-major pentatonic scale, preserving common notes across the smooth scene crossfade. Active gain automation is held at its current level during a transition so rapid navigation does not introduce volume jumps.

The mobile-friendly audio graph uses one oscillator per note, a single scheduled cycle, lightweight tonal wood clicks, and one sparse bass line. It removes the noise-based hi-hat and second bass pulse, uses much shorter overlap during crossfades, and explicitly stops queued sources when a scene ends. This sharply reduces startup work and prevents old synth nodes from lingering on slower phones.

## GitHub Pages

The production site is entirely static and runs at `https://nomsams.github.io/canuspot/`:

- `index.html`, `styles.css`, `app.js`, the manifest, and portrait files are served directly by GitHub Pages.
- Quiz logic, scoring, image selection, personal statistics, and streaks run in the visitor's browser.
- Browser `localStorage` holds device-local history. There is no application server, database, account system, or paid runtime dependency.
- `npm run assets` is only a maintainer command for regenerating the checked-in manifest after adding images. Visitors and GitHub Pages do not run it.

The workflow at `.github/workflows/pages.yml` validates and deploys the repository automatically after every push to `main`. For the repository's one-time setup, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. No build command or hosting subscription is required. All runtime URLs are relative, so assets resolve correctly under the `/canuspot/` repository path.

## Data and future Supabase support

The UI calls a small adapter exposed as `window.SpotCheckData`:

- `loadCards()` — returns the card manifest
- `recordAttempt(attempt)` — saves an attempt
- `getLeaderboard(mode)` — returns top scores per device for a mode
- `getStats(mode)` — returns plays, best, average, streak, and recent scores
- `getShownImages(deviceHash, mode)` / `setShownImages(...)` — rotate portraits between rounds

The current adapter stores the latest 100 attempts in the browser's `localStorage`. It creates a random local device ID and stores its SHA-256 digest with each attempt. It does **not** collect IP addresses.

For Supabase, replace the adapter with calls to an Edge Function. Recommended tables: `images`, `quiz_attempts`, `image_answers`, using opaque UUIDs. Keep the service-role key server-side, enable RLS on every public table, allow clients to read only published image metadata, and insert attempts through a rate-limited Edge Function. If you have a legitimate reason to deduplicate by IP, hash it only inside the Edge Function with a rotating server secret (HMAC), retain it briefly, disclose it in the privacy notice, and never expose raw IPs or a public unsalted hash. A local random identifier is the more privacy-preserving default.

## Files

- `index.html` — accessible app structure
- `styles.css` — responsive mobile/desktop UI and animations
- `app.js` — quiz state, swipe gestures, scoring, local adapter, and sharing
- `music.js` — five-scene-aware procedural Web Audio compositions
- `assets/manifest.json` — static image metadata
- `assets/unsorted/` — quick-import source images named `lady…` or `ldb…`
- `assets/focus-overrides.json` — optional per-file crop adjustments
- `scripts/generate-manifest.mjs` — dependency-free asset manifest generator
- `scripts/detect-face-focus.py` — optional OpenCV YuNet focal-point generator
- `requirements-face-focus.txt` — maintainer-only Python dependencies for face detection
- `assets/women/`, `assets/trans-woman-man/`, `assets/trans-man-woman/`, `assets/men/` — portrait images

## License

**Proprietary — all rights reserved.** No permission is granted to reuse, modify, redistribute, commercialize, scrape, include in a dataset, or use the project for AI/ML development. Public availability only permits the limited viewing and forking functionality required by GitHub. See `LICENSE` for the complete terms.
