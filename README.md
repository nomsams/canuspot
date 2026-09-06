# Spot Check

A dependency-free, mobile-first swipe quiz for GitHub Pages. It presents up to 10 balanced portrait cards, supports horizontal drag plus explicit choice buttons, calculates a score, assigns a humorous level, and shows a red–orange–green result meter.

The quiz also includes answer undo, keyboard controls, answer review with swipe navigation, persistent per-mode personal stats, daily streaks, and a device-local leaderboard. The bundled demo has six valid cards per mode; rounds automatically grow to 10 when enough assets are available.

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

The generator updates `assets/manifest.json` while preserving the original demo entries:

- filenames beginning with `lady` are added as `woman`
- filenames beginning with `ldb` are added as `trans-woman`
- other filenames are ignored with a warning

Names are matched case-insensitively, so adding more numbered files only requires rerunning the command. The file name becomes part of a stable internal ID but is not shown as the portrait title.

Generated images default to a focal point of `50% 38%`—centered horizontally and slightly above center vertically. To adjust an outlier without editing generated data, add an entry to `assets/focus-overrides.json`:

```json
{
  "example.jpg": { "x": 65, "y": 35 }
}
```

Both values are percentages from the image's top-left corner. Rerun `npm run assets` after changing the overrides. Use `npm run check` to verify that the manifest is current.

### Manual category folders

For fully manual manifests, the project supports **four category folders**:

1. `assets/women/` — Portraits of cisgender women
2. `assets/trans-woman-man/` — Portraits of trans women (MTF)
3. `assets/trans-man-woman/` — Portraits of trans men (FTM)
4. `assets/men/` — Portraits of cisgender men

### Image requirements
- Format: WebP or AVIF recommended (SVG works for demo)
- Any aspect ratio is supported; images render with a 4:5 cover crop around their focal point
- Minimum 10 images per folder for good randomization (3 per folder in demo)

### Manifest format
Add each image to `assets/manifest.json` with:
- `id` — stable, non-identifying identifier
- `src` — path to image
- `title` — display name
- `alt` — accessible description
- `category` — one of: `woman`, `trans-woman`, `trans-man`, `man`
- `focus` — optional crop focus such as `{ "x": 50, "y": 38 }`
- `labels` — object with correct answers for each mode:
  - `woman_trans`: `"woman"` or `"trans"`
  - `man_trans`: `"man"` or `"trans"`

Example:
```json
{"id":"w-01","src":"assets/women/portrait-01.webp","title":"Portrait 1","alt":"Woman portrait","category":"woman","labels":{"woman_trans":"woman","man_trans":"woman"}}
{"id":"twm-01","src":"assets/trans-woman-man/portrait-01.webp","title":"Portrait 2","alt":"Trans woman (MTF) portrait","category":"trans-woman","labels":{"woman_trans":"trans","man_trans":"woman"}}
```

Only use images you own or have explicit permission to publish. If real people are pictured, obtain consent for this exact quiz context. Avoid identity, health, ethnicity, sexuality, or other sensitive-trait guessing games.

## Quiz modes

- **Woman / Trans** — Guess if the person is a cisgender woman or a trans woman (MTF)
- **Man / Trans** — Guess if the person is a cisgender man or a trans man (FTM)

Toggle modes using the header button. A round only includes cards whose answer belongs to that mode, and the deck alternates between the two answer groups before shuffling so one label cannot dominate the quiz.

## GitHub Pages

Push these files to a GitHub repository, then open **Settings → Pages** and deploy from the root of your default branch. No build command needed. Relative asset paths work when Pages serves under a repository subpath.

## Data and future Supabase support

The UI calls a small adapter exposed as `window.SpotCheckData`:

- `loadCards()` — returns the card manifest
- `recordAttempt(attempt)` — saves an attempt
- `getLeaderboard(mode)` — returns top scores per device for a mode
- `getStats(mode)` — returns plays, best, average, streak, and recent scores
- `getShownImages(deviceHash, mode)` / `setShownImages(...)` — rotate portraits between rounds

The current adapter stores the latest 100 attempts in the browser's `localStorage`. It creates a random local device ID and stores its SHA-256 digest with each attempt. It does **not** collect IP addresses.

For Supabase, replace the adapter with calls to an Edge Function. Recommended tables: `images`, `quiz_attempts`, `image_answers`, using opaque UUIDs. Keep the service-role key server-side, enable RLS on every public table, allow clients to read only published image metadata, and insert attempts through a rate-limited Edge Function. If you have a legitimate reason to deduplicate by IP, hash it only inside the Edge Function with a rotating server secret (HMAC), retain it briefly, disclose it in the privacy notice, and never expose raw IPs or a public unsalted hash. A local random identifier is the more privacy-preserving default.

The sample leaderboard rows in this prototype are visibly labelled `demo`; personal statistics never include them. Replace them with an aggregate-only endpoint (minimum cohort sizes recommended) before showing real community statistics.

## Files

- `index.html` — accessible app structure
- `styles.css` — responsive mobile/desktop UI and animations
- `app.js` — quiz state, swipe gestures, scoring, local adapter, and sharing
- `assets/manifest.json` — static image metadata
- `assets/unsorted/` — quick-import source images named `lady…` or `ldb…`
- `assets/focus-overrides.json` — optional per-file crop adjustments
- `scripts/generate-manifest.mjs` — dependency-free asset manifest generator
- `assets/women/`, `assets/trans-woman-man/`, `assets/trans-man-woman/`, `assets/men/` — portrait images

## License

**Proprietary — all rights reserved.** No permission is granted to reuse, modify, redistribute, commercialize, scrape, include in a dataset, or use the project for AI/ML development. Public availability only permits the limited viewing and forking functionality required by GitHub. See `LICENSE` for the complete terms.
