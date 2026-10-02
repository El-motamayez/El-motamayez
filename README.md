# المتميز في القدرات الكمي — بوابة إصدارات التجميعات

موقع ثابت بالكامل يجمع **الجزء الثاني (التجميعات)** من مذكرة «المتميز في القدرات الكمي»
للأستاذ **محمد أسامه حرحيره** في صفحة واحدة، مع بحث فوري بالرقم أو بالاسم، وتصفية،
ومتابعة تقدّم محفوظة على جهاز الطالب.

**لا يوجد خادم، ولا قاعدة بيانات، ولا عملية بناء (build) مطلوبة للنشر.**
الملفات المرفوعة هي الموقع نفسه.

---

## Quick start

```bash
npm start           # preview at http://127.0.0.1:4173 (PORT=5177 npm start to change)
npm run verify      # rebuild data + run tests + validate every link
```

There is nothing to install — every script is plain Node (>= 18) with zero dependencies.
(The image pipeline is the one exception: it is Python, and it is only run when a photo
or the brand artwork changes.)

---

## How it is put together

```
index.html              the portal: hero + search, quick access, filters, version grid
teacher.html            الأستاذ — the teacher's profile page (Person / ProfilePage / FAQ schema)
about.html              عن المنصة — how to use the site, FAQ (FAQPage schema)
llms.txt                GENERATED — plain-text brief for AI assistants (llmstxt.org)
sitemap.xml             GENERATED — pages + <lastmod> + his photos, for image search
robots.txt              allows search engines and AI crawlers by name
404.html                fully self-contained (no external CSS/JS/images at all)

assets/
  css/tokens.css        design tokens: brand palette, type scale, spacing, radii, motion
  css/base.css          font faces, reset, typography, layout primitives, a11y
  css/components.css    every component
  js/search.js          Arabic-aware search (normalisation, ranking, highlighting)
  js/store.js           device-local progress (localStorage, fully guarded)
  js/app.js             state -> URL -> render; card building; filters; sheet
  js/ui.js              theme toggle + mobile nav (shared by all pages)
  fonts/                IBM Plex Sans Arabic, self-hosted and subset (tools/build-fonts.md)
  img/                  the brand emblem (mark-*.webp), the teacher's photos
                        (teacher-portrait-*, teacher-standing-*), favicons, OG cover
  data/exams.json       GENERATED — do not edit by hand

data/
  source/               the original, untouched export (the single source of truth)
  source/photos/        the teacher's original photo, untouched
  source/brand/         the booklet cover and the form banners, untouched
  build-report.json     GENERATED — what was published and what was excluded

tools/
  build-data.mjs        source export  ->  assets/data/exams.json
  build-photos.py       brand artwork + photo -> assets/img (run only when one changes)
  test-search.mjs       search + dataset tests (npm test)
  test-store.mjs        progress store tests (npm test)
  test-seo.mjs          structured data, FAQ parity, sitemap, robots, llms.txt (npm test)
  check-links.mjs       link validation, offline or over the network
  set-site-url.mjs      stamps the real site URL into canonical/OG/sitemap
  serve.mjs             zero-dependency local preview server
  og-cover.template.html  source for assets/img/og-cover.jpg
  build-fonts.md        how to refetch and re-subset the fonts
```

### Why no framework

The site is one screen over 48 records. Vanilla ES modules ship about **13 KB of
JavaScript**; React + a bundler would have cost roughly ten times that, plus a build
step that can break a deployment. Everything is loaded as plain static files with
**relative** paths, so the site works identically at
`user.github.io/repo/`, at `user.github.io/`, and on a custom domain.

---

## Updating the version list

1. Export the new list and drop it into `data/source/` (replacing the old `.json`).
   The original file is never modified by any script.
2. Run the pipeline:

   ```bash
   npm run verify
   ```

   `build-data.mjs` validates every record and prints what it published and what it
   excluded. A record with a missing title, a non-https URL, a duplicate number or a
   duplicate link is **left out of the site entirely** rather than rendered as a
   broken version. `data/build-report.json` lists any exclusions.
3. Commit. The GitHub Actions workflow rebuilds and redeploys automatically.

The source schema currently in use — the teacher's own Arabic export, read as-is so
that no hand-editing step sits between his sheet and the site:

```json
{
  "المشروع": "…", "المعلّم": "…", "الجوال": "…",
  "عدد الفورمات": 48, "إجمالي الأسئلة": 2303, "كلمة المرور": "…",
  "الفورمات": [{ "الإصدار": 1, "الاسم": "الإصدار الأول — المتميز في القدرات الكمي",
                 "عدد الأسئلة": 48, "الدرجة": 48,
                 "الرابط المختصر": "https://forms.gle/…",
                 "الرابط الكامل": "https://docs.google.com/forms/d/e/…/viewform" }]
}
```

The English key names (`project`, `forms`, `section`, `title`, `questions`, `short`,
`url`) are accepted too, and a bare array of forms works, so a re-export in either
shape still builds. Key matching ignores diacritics, so «المعلّم» and «المعلم» are the
same key.

Three things the build derives rather than trusts:

- **The title on the card** drops the trailing brand — «الإصدار الحادي عشر», not
  «الإصدار الحادي عشر — المتميز في القدرات الكمي». Repeating the brand 48 times inside
  its own grid is noise, and the header already says it.
- **The question count travels per record** (`q`), because the versions are not all the
  same length: 48 for every version except الثامن والثلاثون, which has 47. The card
  reads its own count; `meta.questionsPerForm` is only filled when every version agrees.
- **The dataset's date** is the export file's own modification time, unless the export
  carries a `"التاريخ"` / `generated` field. It changes when the data changes, and
  never on a rebuild that changed nothing.

### Optional: a «ابدأ بهذه» shortlist

If the teacher wants to mark a subset as the ones to start with, put the numbers in
**`data/source/priority.json`**, separate from the forms export — the export is a
machine dump that gets replaced wholesale, while this list is his editorial judgement.

```json
{
  "label": "ابدأ بهذه",
  "blurb": "…shown on the quick-access tile…",
  "updated": "YYYY-MM-DD",
  "sections": [1, 2, 3, 5, 8]
}
```

Then `npm run build:data`. That is the whole procedure — **no code change is involved.**
The build stamps `p: 1` on each matching record, writes `meta.priority` into
`assets/data/exams.json`, restates the figure in the hero, `llms.txt` and the structured
data, and reports in `data/build-report.json`:

- `priority.flagged` — how many were actually matched,
- `priority.unknown` — numbers on the list that no published version answers to. These
  are dropped rather than failing the build, and are printed during the build so a typo
  in the shortlist is visible immediately.

What the site does with the flag:

| Where | What appears |
| --- | --- |
| Hero | a fourth figure, «8 ابدأ بهذه» |
| Quick access | a full-width tile that switches the filter on |
| Toolbar | a toggle above the range chips, combinable with search, status and range |
| Card | an accent pill in the meta row and a persistent accent edge |
| Progress | a second track counting the shortlist on its own |
| Sort | «ابدأ بهذه أولًا» |
| URL | `?key=1` — a shareable link straight to the shortlist |

**There is no `priority.json` in this repository right now**, and that is a supported
state, not an omission: `meta.priority` is `null` and every one of those affordances
hides itself rather than showing an empty promise.

### Checking that the forms are still live

```bash
npm run check:links              # probes all 48 URLs (hits Google)
npm run check:links -- --limit 25
```

This is deliberately **not** part of CI. Run it manually after a data update.

---

## Deploying to GitHub Pages

### The automatic path (recommended)

1. Push this folder to a GitHub repository.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   Do this *before* the first run — see the troubleshooting note below.
3. Push to `main`. `.github/workflows/deploy.yml` will:
   rebuild the dataset → run the tests → validate the links →
   **stamp the real Pages URL** into the canonical/OG/sitemap tags →
   add `.nojekyll` → deploy.

Nothing else needs configuring; `actions/configure-pages` reports the real URL, so
the same workflow is correct for a project page, a user page or a custom domain.

#### If the build fails at "Deploy to GitHub Pages"

```
Error: Creating Pages deployment failed
Error: HttpError: Not Found
Error: Failed to create deployment (status: 404) … Ensure GitHub Pages has been enabled
```

This means Pages has never been turned on for the repository, so there is no Pages
site to deploy into. It is a repository setting, not a problem with the site or the
build, and no change to this repo can work around it.

**Fix:**

1. *Settings → Pages → Build and deployment → Source: **GitHub Actions***
2. *Settings → Actions → General → Workflow permissions → **Read and write
   permissions*** — the workflow calls `configure-pages` with `enablement: true`, which
   creates the Pages site through the API, and the API rejects that call when Actions
   is read-only. This is also why that step can fail silently: it is marked
   `continue-on-error` so a failed *lookup* never blocks publishing.
3. *Actions → the failed run → **Re-run all jobs***

The same setting is behind the earlier variant of this error, `Get Pages site failed`
at the **Configure Pages** step.

### The manual path (deploy from a branch)

This also works — the site needs no build — but run this once first so the
absolute URLs in the metadata are correct:

```bash
npm run set-url -- https://your-name.github.io/your-repo/
```

Then set **Settings → Pages → Source: Deploy from a branch**, pick the branch and
the root folder. `.nojekyll` is already committed, which matters here: without it
Jekyll would drop files and choke on the Arabic filenames under `data/source/`.

> If you skip `set-url`, a small inline script repairs `canonical` and `og:url` in
> the browser, but crawlers that do not run JavaScript read the raw HTML — so run it
> before sharing the link anywhere.

---

## Design system

Tokens live in `assets/css/tokens.css`. The palette was sampled directly from the brand
artwork in `data/source/brand/` — the booklet cover and the form banners:

| Role | Light | Dark |
| --- | --- | --- |
| Navy (structure, text, **the action colour**) | `#0f2743`, buttons `#143a63` | `#eef2f7` on `#0b1a2c` |
| Gold (accent: numbers, completion, focus, the seal) | `#a8752a` (brand value `#c89b48`) | `#e0b878` |
| Paper (cream) | `#f2f0e9` / `#fffdf8` | `#0b1a2c` / `#12263e` |

The identity has only two colours, so the roles have to be strict: **navy acts, gold
marks, cream carries.** Rules the implementation follows:

- **Navy is the only action colour in the light theme.** On the version cards, where
  «ابدأ الاختبار» repeats 48 times, the button is a navy *tint* that fills solid on
  hover, so the grid stays calm.
- **In the dark theme navy becomes the page, so gold takes the action role** and carries
  navy letters — the cover's own pairing, read the other way round.
- **Gold is never a text colour at its brand value.** `#c89b48` is 3.5:1 on cream, which
  is fine for a rule or an icon and not for a word; `#a8752a` and darker are used where
  letters sit on paper, and `--gold-ink` (`#7a5214`, 7.5:1) inside a gold wash.
- **Minimum body size is 15px, minimum metadata size is 13px.** Nothing smaller.
- **Every text colour meets WCAG AA (4.5:1)** against its own background, in both themes.
- **Light is the default for every visitor**, whatever their operating system is set to.
  Dark is opt-in only, through the header toggle, and the choice is remembered.
- **The emblem carries its own gold ring**, so unlike a flat logo it needs no white disc
  behind it: it reads identically on cream and on navy.

---

## Behaviour worth knowing

**Search** (`assets/js/search.js`) folds alef/hamza variants, ta-marbuta,
alef-maqsura, diacritics and tatweel, and both Arabic-Indic and Latin digits. The
definite article and a leading «و» are indexed as extra stems, so «اصدار» finds
«الإصدار». A pure number addresses a version directly. If a strict pass finds
nothing, a second pass tolerates a one-character typo. Matches are highlighted on
the original Arabic title via an index map, so folded characters still highlight
correctly.

**State lives in the URL.** `?q=…&range=…&status=…&sort=…` — any view can be shared,
and the back button works. `#exam-11` deep-links to a specific version.

**Progress is device-local.** «مُنجز», «المفضلة» and «آخر ما فتحت» are stored in
`localStorage` only (`assets/js/store.js`). Nothing is ever sent anywhere. Every
storage call is wrapped, so a private window or blocked site data keeps working in
memory instead of throwing. Stored data is sanitised on read, changes are written
immediately when the tab is hidden, and a second open tab picks up changes through
the `storage` event instead of overwriting them. `tools/test-store.mjs` covers all of it.

**How "done" gets recorded.** Opening a version *is* doing it: any link that opens one
(«ابدأ الاختبار» on a card, the «ابدأ/تابع» tile, the random tile, including a
middle-click) marks it done immediately. A toast confirms it with an «تراجع» undo; if
the form's tab came to the front, the toast is held until the student returns, so it
is seen. The round checkbox on each card toggles the mark by hand at any time.

- **Resume tile:** the first unfinished version after the last one opened («تابع»); on a
  fresh device the first version («ابدأ»). If the student un-marks the last version they
  opened, it points back at that one («أكمل»).
- **Random tile:** an unfinished version (never the one just opened), regardless of the
  current search or filters.
- **Status tabs** show live counts under the current range and search. Marking a card
  inside a filtered tab updates it in place — the list is not rebuilt, so the student
  keeps their scroll position.
- **«مسح الإنجاز»** clears done marks and history but keeps favourites, and is undoable
  from the toast.

**The range chips follow the size of the export.** `build-data.mjs` picks the step from
the highest number — 10 below 60 records, 20 below 150, 50 above — so the quick-jump row
stays four or five chips whether the export holds 48 rows or 400. A short trailing batch
is folded into the one before it, so an export ending at 42 would read `1–10 · 11–20 ·
21–30 · 31–42` rather than trailing a lonely `41–42` chip.

**Rendering is incremental.** 48 cards per batch, extended by an IntersectionObserver
with an explicit «عرض المزيد» button as the accessible fallback. At 48 records that
never triggers, and it costs nothing to leave in place for a larger export.

**Links are validated twice** — once at build time, once again before a card is
rendered. Anything that is not a plain `https:` URL never becomes a clickable version.
All external links carry `rel="noopener noreferrer"`.

---

## SEO and AI discoverability (GEO)

The site is built around **the teacher, not the platform**: the goal is that
«الأستاذ محمد أسامه حرحيره — مدرب القدرات الكمي» is the entity Google and the AI
assistants (ChatGPT, Gemini, Claude, Copilot, Perplexity) recognise, and that the 48
versions read as *his* resource.

**Name collision — read this first.** «محمد أسامه» is a very common Arabic name, so the
family name does the disambiguating work: every title, H1, JSON-LD `name` and the first
line of `llms.txt` leads with **الأستاذ محمد أسامه حرحيره** and pairs it with **القدرات
الكمي**; the brand «المتميز في القدرات الكمي» comes second. The searches worth ranking
for are «تجميعات الكمي» and «قدرات كمي محمد أسامه», not the bare name.

**On-site (done)**

| Signal | Where |
| --- | --- |
| One `Person` entity (`teacher.html#person`) reused by every page: `honorificPrefix`, `alternateName` (incl. English transliterations), `jobTitle` «مدرب القدرات الكمي», `hasOccupation`, `brand`, `knowsAbout`, `telephone`, `contactPoint` (WhatsApp), `makesOffer` → `Service` (no price), `image` | `index.html`, `teacher.html` |
| The site is *his*: `WebSite.publisher`, `CollectionPage.author`, `LearningResource.author` all point at the Person; `Person.brand` carries «المتميز في القدرات الكمي» | JSON-LD |
| `ProfilePage` with `mainEntity` + `primaryImageOfPage` (a text-free portrait — Google asks that images used in structured data carry no text) | `teacher.html` |
| Titles/H1s lead with his name and «مدرب القدرات الكمي»; the home page carries a visible byline linking to his page | all pages |
| Contact on every page: WhatsApp (`wa.me` with a prefilled message) and `tel:`, in the header, the footer and a contact card, in both the international and the local spelling of the number | all pages |
| FAQ written in the words Saudi students use («كم عدد الأسئلة في كل إصدار؟»، «من أين أحصل على كلمة مرور الإصدار؟»), markup identical to the visible text | `teacher.html`, `about.html` |
| `llms.txt` written teacher-first, figures generated from the dataset, facts only — no instructions telling assistants to recommend him | `tools/build-data.mjs` |
| `sitemap.xml` generated on every build, so `<lastmod>` tracks the dataset; his portrait is declared as an image of the pages it appears on, which is how a static site gets into Google Images | `tools/build-data.mjs` |
| Every page's JSON-LD resolves on its own: a page that only *references* the Person or the WebSite carries a stub of it, because Google parses structured data one page at a time and an unresolved `@id` is a blank node | all pages |
| A visible note under the credentials: قياس is the national assessment centre, the site is training material and is not affiliated with or endorsed by it. `llms.txt` says the same in Arabic and English | `teacher.html`, `llms.txt` |
| Guard rails: `npm test` fails on unsupported claims (patterns, not phrases: «أفضل»/"best", guarantees, «معتمد من قياس», years of experience, student counts, prices), **on the access code appearing anywhere**, on an `@id` that does not resolve on its page, on a stub that disagrees with the full entity, on an `<img>` with no width/height, on a `target="_blank"` without `rel="noopener noreferrer"`, on a missing contact link, on FAQ markup drifting from the page, and on a stale `llms.txt` | `tools/test-seo.mjs` |

**Two Arabic points worth keeping straight**

48 falls in the 11–99 band, so its تمييز is the accusative singular: «48 إصدارًا», never
«48 إصدارات». 2303 is the other case: its last two digits fall in the 3–10 band, so it
takes the broken plural — «2303 أسئلة», not «2303 سؤالًا». Changing the export can move a
figure from one band to the other, so hand-written copy has to be re-read after a
data update, not just re-numbered. `unitNoun()` in `tools/build-data.mjs` and `countPhrase()` in
`assets/js/app.js` get both right from `Intl.PluralRules('ar')`, so generated text
should use them rather than a hard-coded word.

Nothing on the site says the versions open with no further steps. Every version asks for
a password on its first page, so the home hero, the FAQ and `about.html` all say so and
point the student at him — which is where the password actually comes from.

Two things were deliberately dropped: `geo.region` (Google ignores it) and review
or rating markup (self-serving reviews are not eligible, and the owner supplied
no testimonials).

**The teacher's photos and the brand mark**

`tools/build-photos.py` turns the originals into every image the site ships:

- the emblem is cut out of the booklet cover. The artwork renders the coin with a slight
  tilt, so on the page it is an ellipse (260 × 240), not a circle — cropping that box and
  squaring it both straightens the coin and puts its own gold ring exactly on the edge
  the CSS circle clips to, with no pale halo and none of the gold ribbon that passes
  behind it;
- his photo was taken in front of an exhibition banner, so the room is removed with
  `rembg` **once** and both outputs are cut from that one result. Compositing rather
  than cropping is what keeps the banner's lettering and its green graphic out of the
  circle; the banner green that the matte keeps against his arm is removed by colour,
  because eroding the silhouette far enough to lose it would eat the hair;
- the circle is composited on the brand's own cream vignette, with a JPEG twin carrying
  a gold ring for search results and link previews that expect a square;
- the arch keeps the photograph exactly as it was taken, background and all. The frame
  covers it edge to edge, so the navy stage behind it never shows; it is the tight
  circle that needed the cut-out, not this.

Run it only when an original changes — the outputs are committed. `assets/img/og-cover.jpg`
is made separately, by screenshotting `tools/og-cover.template.html` at 1200 × 630.

**What only the owner can do (in priority order)**

1. **Google Search Console** — verify, submit `sitemap.xml`, request indexing of
   `/teacher.html`.
2. **Bing Webmaster Tools** — import from Search Console and enable IndexNow.
   Bing's index feeds ChatGPT search and Copilot, so this is an AI-visibility step.
3. **A public profile to link to.** `Person.sameAs` is deliberately **empty**: nothing
   is claimed that has not been verified, and `npm test` enforces that. The moment he
   has a page students already know — WhatsApp Business, a channel, a Facebook page —
   add its URL to `sameAs` in `index.html` and `teacher.html` (the two copies must
   agree; the test checks that too).
4. **Make the name consistent everywhere** — the same «الأستاذ محمد أسامه حرحيره – مدرب
   القدرات الكمي», the same phone format, each linking back to this site.
5. **Mentions from other sites.** Web mentions correlate with AI visibility far more
   strongly than backlinks alone.
6. **A custom domain** (`.sa` or `.com`) — a stronger country and brand signal than
   a `github.io` path.

Not worth doing: Wikidata/Wikipedia entries for a non-notable person, FAQ markup
for rich results (Google removed them in May 2026 — ours is for people and AI
readers), or Course rich results (retired in June 2025).

## A note on the access code

The source export contains `"كلمة المرور": "2030"`, which is what the first page of each
Google Form asks for. **It is deliberately not displayed anywhere on this site** — the
site is public, and publishing the code here would remove the only gate on the forms.
`about.html` tells students to get it from the teacher instead, and `tools/test-seo.mjs`
fails the build if the code ever appears in a page or in `llms.txt`.

**Edit links never enter this repository.** The teacher's exports sometimes carry a
`رابط التعديل` per row — a `docs.google.com/forms/d/<id>/edit` URL, which hands write
access to the live form to anyone who opens it. The repository is public and
`data/source/` is published with everything else, so those are stripped before the
export is saved. Two guards keep it that way: `build-data.mjs` **exits 1** if the
export contains one, and `test-seo.mjs` fails if one reaches any published file.

That password is also the reason nothing on the site calls the versions **free**. They
are the teacher's own material, published for his own students; `isAccessibleForFree`
is `false`, every page says who they are for rather than what they cost, and the same
forbidden-pattern list fails the build on «مجان» or a bare "free".

If you would rather show it, that is a two-line change — add it to the hero or the about
page and drop the guard from the forbidden list in `test-seo.mjs`. It is intentionally
not wired to a config flag so that it cannot be switched on by accident.
