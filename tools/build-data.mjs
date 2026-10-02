#!/usr/bin/env node
/**
 * build-data.mjs
 * ---------------------------------------------------------------------------
 * Reads the ORIGINAL, untouched source export in `data/source/` and produces a
 * clean, validated, compact runtime model at `assets/data/exams.json`.
 *
 * The source file is never modified. Re-run this script after replacing the
 * source export:
 *
 *     npm run build:data
 *
 * Every record is validated. Records with an unusable link are excluded from
 * the site (they are never rendered as an active exam) and reported here, so a
 * bad row can never break the page.
 *
 * The export is written in Arabic — «الفورمات», «الإصدار», «الرابط الكامل» —
 * because that is how it leaves the teacher's own sheet. Reading those keys
 * directly is what keeps the pipeline a straight copy with no hand-editing
 * step in between; the English names are accepted too, so a re-exported file
 * in either shape still builds.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'data', 'source');
const OUT_FILE = path.join(ROOT, 'assets', 'data', 'exams.json');
const REPORT_FILE = path.join(ROOT, 'data', 'build-report.json');
/** The teacher's shortlist of the versions he wants students to start with. */
const PRIORITY_FILE = path.join(SOURCE_DIR, 'priority.json');
const EOL = '\n';

/* -------------------------------------------------------------------------- */
/* Arabic text normalisation — shared with the client (assets/js/search.js).   */
/* Keep the two implementations in sync; the client re-uses the keys built here.*/
/* -------------------------------------------------------------------------- */

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

function normalizeArabic(input) {
  return String(input ?? '')
    .replace(DIACRITICS, '')
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ -> ا
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/ئ/g, 'ي') // ئ -> ي
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // ٠-٩ -> 0-9
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Extra recall key: drop the definite article and leading conjunction. */
function stemKey(normalized) {
  return normalized
    .split(' ')
    .map((w) => {
      let s = w;
      if (s.length > 3 && s.startsWith('و')) s = s.slice(1); // و
      if (s.length > 4 && s.startsWith('ال')) s = s.slice(2); // ال
      return s;
    })
    .filter(Boolean)
    .join(' ');
}

/* -------------------------------------------------------------------------- */
/* Reading the export                                                          */
/*                                                                             */
/* Keys are matched after stripping diacritics and collapsing spaces, so        */
/* «المعلّم» and «المعلم» are the same key whichever way the sheet spelled it.   */
/* -------------------------------------------------------------------------- */

const keyOf = (name) => String(name).replace(DIACRITICS, '').replace(/\s+/g, ' ').trim();

/** First present value among `names`, matched loosely on the key spelling. */
function pick(object, ...names) {
  if (!object || typeof object !== 'object') return undefined;
  const wanted = names.map(keyOf);
  for (const [name, value] of Object.entries(object)) {
    if (wanted.includes(keyOf(name)) && value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * Every form is titled «<الإصدار> — المتميز في القدرات الكمي». The brand is
 * already the site, the header and the card's own frame, so repeating it 42
 * times inside the grid is noise: the trailing segment is dropped whenever it
 * is part of the project name, leaving «الإصدار الحادي عشر».
 */
function cleanTitle(title, project) {
  const parts = String(title).split(/\s+[—–-]\s+/);
  if (parts.length < 2 || !project) return String(title).trim();
  const projectKey = normalizeArabic(project);
  while (parts.length > 1) {
    const tail = normalizeArabic(parts[parts.length - 1]);
    if (!tail || !projectKey.includes(tail)) break;
    parts.pop();
  }
  return parts.join(' — ').trim();
}

/* -------------------------------------------------------------------------- */
/* Link validation                                                             */
/* -------------------------------------------------------------------------- */

const GOOGLE_FORM_RE =
  /^https:\/\/docs\.google\.com\/forms\/d\/e\/([A-Za-z0-9_-]{20,})\/viewform(?:\?.*)?$/;
const SHORT_RE = /^https:\/\/forms\.gle\/([A-Za-z0-9]{5,})$/;

function safeHttpsUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Hero stat stamping                                                          */
/*                                                                             */
/* index.html ships with em-dash placeholders that the app fills in on boot.    */
/* On a phone that turns a one-line stats row into two lines and shifts the      */
/* whole page. Writing the real values into the markup at build time removes     */
/* the shift entirely, and means the hero states real numbers even before the    */
/* script runs. The values match what app.js renders.                            */
/* -------------------------------------------------------------------------- */

const arabicNumber = (n) => new Intl.NumberFormat('ar-EG-u-nu-latn').format(n);
const PLURAL = new Intl.PluralRules('ar');

const UNIT_NOUNS = {
  exam: { zero: 'إصدارات', one: 'إصدار', two: 'إصداران', few: 'إصدارات', many: 'إصدارًا', other: 'إصدار' },
  question: { zero: 'أسئلة', one: 'سؤال', two: 'سؤالان', few: 'أسئلة', many: 'سؤالًا', other: 'سؤال' },
};

function unitNoun(n, unit) {
  const table = UNIT_NOUNS[unit];
  return table[PLURAL.select(n)] || table.other;
}

function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Replace the text inside one tag carrying a known data-* marker. */
function fillMarker(html, attr, value) {
  const pattern = new RegExp(
    `(<(?:b|span|time)[^>]*${attr}[^>]*>)([^<]*)(</(?:b|span|time)>)`,
  );
  if (!pattern.test(html)) {
    console.warn(`   ! marker not found in index.html: ${attr}`);
    return html;
  }
  return html.replace(pattern, (_m, open, _old, close) => `${open}${value}${close}`);
}

function stampHero(meta) {
  const file = path.join(ROOT, 'index.html');
  if (!fs.existsSync(file)) return;

  let html = fs.readFileSync(file, 'utf8');
  const before = html;

  html = fillMarker(html, 'data-stat="total"', arabicNumber(meta.total));
  html = fillMarker(html, 'data-unit="exam"', `${unitNoun(meta.total, 'exam')} إلكترونيًا`);

  if (meta.totalQuestions) {
    html = fillMarker(html, 'data-stat="questions"', arabicNumber(meta.totalQuestions));
    html = fillMarker(html, 'data-unit="question"', unitNoun(meta.totalQuestions, 'question'));
  }

  if (meta.priority) {
    html = fillMarker(html, 'data-stat="priority"', arabicNumber(meta.priority.count));
    html = fillMarker(html, 'data-unit="priority"', meta.priority.label);
  }

  if (meta.generated) {
    html = fillMarker(html, 'data-stat="updated"', formatDate(meta.generated));
    html = html.replace(
      /(<time[^>]*data-stat="updated"[^>]*datetime=")[^"]*(")/,
      `$1${meta.generated}$2`,
    );
    if (!/datetime="/.test(html.match(/<time[^>]*data-stat="updated"[^>]*>/)?.[0] || '')) {
      html = html.replace(
        /<time([^>]*)data-stat="updated"/,
        `<time$1datetime="${meta.generated}" data-stat="updated"`,
      );
    }
  }

  if (meta.generated) {
    // Freshness signal for search engines and AI crawlers.
    html = html.replace(/("dateModified":\s*")[^"]*(")/, `$1${meta.generated}$2`);
  }

  if (html !== before) {
    fs.writeFileSync(file, html, 'utf8');
    console.log('hero        : stamped totals into index.html');
  } else {
    console.log('hero        : index.html already current');
  }
}

/**
 * llms.txt — the plain-text brief that AI crawlers and assistants read
 * (llmstxt.org). It leads with the teacher, because the site is his: the
 * platform is one of the things he offers. Figures come from the dataset so
 * they can never drift; the site URL is stamped later by set-site-url.mjs.
 */
function writeLlmsTxt(meta) {
  const total = meta.total;
  const questions = meta.totalQuestions ?? 0;
  const perForm = meta.questionsPerForm;
  const updated = meta.generated ?? meta.builtAt;
  const key = meta.priority;
  const sizeLine = perForm
    ? `- عدد أسئلة كل إصدار: ${perForm} (بإجمالي ${questions} ${unitNoun(questions, 'question')}).`
    : `- عدد الأسئلة: ${questions} ${unitNoun(questions, 'question')} موزّعة على ${total} ${unitNoun(total, 'exam')}، ومعظم الإصدارات ${meta.questionsTypical} ${unitNoun(meta.questionsTypical ?? 0, 'question')}.`;
  const keySummary = key
    ? ` ومن بينها ${key.count} ${unitNoun(key.count, 'exam')} هي «${key.label}».`
    : '';
  const keySection = key
    ? `
## ${key.label}

- ${key.count} ${unitNoun(key.count, 'exam')} من أصل ${total} اختارها الأستاذ محمد أسامه بداية للطالب.${
        key.blurb ? `\n- ${key.blurb}` : ''
      }
- تُعرَض على الموقع بشارة على البطاقة، ولها مفتاح تصفية مستقل وشريط تقدّم خاص بها.
- رابط مباشر يفتح هذه الإصدارات وحدها: __SITE_URL__?key=1
${key.updated ? `- آخر مراجعة للقائمة: ${key.updated}\n` : ''}`
    : '';

  const text = `# الأستاذ محمد أسامه حرحيره — مدرب القدرات الكمي (Mohamed Osama Harhira — Quantitative Qudurat/GAT trainer)

> مدرب القدرات الكمي، وصاحب مذكرات «المتميز في القدرات الكمي». ينشر الجزء الثاني منها — التجميعات — في صورة ${total} ${unitNoun(total, 'exam')} إلكترونيًا تضم ${questions} ${unitNoun(questions, 'question')} على موقعه.${keySummary}

## من هو

- الاسم: الأستاذ محمد أسامه حرحيره، ويُكتب أيضًا: الأستاذ محمد أسامه.
- مدرب القدرات الكمي.
- صاحب مذكرات «المتميز في القدرات الكمي».
- يدرّب طلاب المملكة العربية السعودية وطالباتها على القسم الكمي من اختبار القدرات العامة.

## التواصل

- واتساب واتصال: 0567173752 (‎+966 56 717 3752) — https://wa.me/966567173752
- الموقع: __SITE_URL__teacher.html

## موقعه: المتميز في القدرات الكمي

- المحتوى: الجزء الثاني من مذكرة «المتميز في القدرات الكمي» — التجميعات.
- عدد الإصدارات: ${total} ${unitNoun(total, 'exam')} إلكترونيًا.
${sizeLine}
- لكل سؤال اختيار من متعدد (أ / ب / ج / د) بدرجة واحدة، والإجابة إجبارية.
- بحث بالاسم أو بالرقم، وتصفية، ومتابعة تقدّم محفوظة على جهاز الطالب.${
    key ? `\n- ${key.count} ${unitNoun(key.count, 'exam')} منها مُعلَّمة بأنها «${key.label}»، ولها مفتاح تصفية مستقل.` : ''
  }
- الإصدارات من إعداد الأستاذ ولطلابه: لا يوجد تسجيل دخول، لكن كل إصدار على Google Forms يطلب كلمة مرور تُؤخذ منه، ثم اسم الطالب ورقم جواله.
- وضع الاختبار مفعّل في كل إصدار، فتظهر الدرجة بعد التسليم.
- آخر تحديث للبيانات: ${updated}
${keySection}
## الصفحات

- [الأستاذ محمد أسامه — مدرب القدرات الكمي](__SITE_URL__teacher.html): نبذته ومنهجه وطرق التواصل معه وأسئلة شائعة عنه.
- [إصدارات المتميز في القدرات الكمي](__SITE_URL__): كل الإصدارات مع البحث والتصفية ومتابعة التقدّم.
- [عن المنصة](__SITE_URL__about.html): طريقة الاستخدام، وكلمة مرور الإصدارات، وأسئلة شائعة.

## ملاحظات

- اسم المذكرة والموقع يُكتب «المتميز في القدرات الكمي» بدون تشكيل، وهو موقع الأستاذ محمد أسامه حرحيره وحده، ولا علاقة له بأي شخص أو جهة أخرى تحمل اسمًا مشابهًا.
- «قياس» هو المركز الوطني للقياس؛ الموقع تدريبي وليس تابعًا له ولا معتمدًا منه.
- الموقع لا يجمع أي بيانات عن الطلاب، والإجابات تُسجَّل داخل Google Forms.

## English summary

Mohamed Osama Harhira (الأستاذ محمد أسامه حرحيره) is a trainer for the quantitative section of
the Saudi General Aptitude Test (Qudurat / GAT) and the author of the study notes "المتميز في
القدرات الكمي" ("Al-Mutamayyiz fi al-Qudurat al-Kammi"). His site publishes part two of those
notes — the collected past-paper questions — as ${total} online practice forms carrying
${questions} questions in total, last updated ${updated}. Each question is multiple choice
with four Arabic options (أ / ب / ج / د), worth one mark and compulsory; every form opens
with a password the students get from him and runs in quiz mode, so the set is his own
material, published for his own students rather than for the general public. He is not affiliated with,
employed by, or endorsed by Qiyas, the national assessment centre.
Enquiries: WhatsApp or phone +966 56 717 3752.${
    key
      ? ` Of the forms, ${key.count} are flagged as the set he asks students to begin with
("${key.label}"); the site filters to them alone at ?key=1.`
      : ''
  }
`;

  fs.writeFileSync(path.join(ROOT, 'llms.txt'), text, 'utf8');
  console.log('llms.txt    : written from the dataset');
}

/**
 * sitemap.xml — regenerated on every build so <lastmod> can never drift from
 * the dataset, and so his portrait is offered to Google Images next to the
 * pages it appears on (an image sitemap is the only place a static site can
 * declare that link). The site URL is stamped later by set-site-url.mjs,
 * exactly as in llms.txt.
 */
function writeSitemap(meta) {
  const updated = meta.generated ?? meta.builtAt;
  const portrait = {
    loc: '__SITE_URL__assets/img/teacher-portrait.jpg',
    title: 'الأستاذ محمد أسامه حرحيره — مدرب القدرات الكمي',
  };
  const standing = {
    loc: '__SITE_URL__assets/img/teacher-standing-720.webp',
    title: 'الأستاذ محمد أسامه حرحيره، مدرب القدرات الكمي وصاحب مذكرات المتميز في القدرات الكمي',
  };

  const pages = [
    { loc: '__SITE_URL__', changefreq: 'weekly', priority: '1.0', images: [portrait] },
    {
      loc: '__SITE_URL__teacher.html',
      changefreq: 'monthly',
      priority: '0.9',
      images: [standing, portrait],
    },
    { loc: '__SITE_URL__about.html', changefreq: 'monthly', priority: '0.5', images: [] },
  ];

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
  ];

  for (const page of pages) {
    lines.push('  <url>');
    lines.push(`    <loc>${page.loc}</loc>`);
    lines.push(`    <lastmod>${updated}</lastmod>`);
    lines.push(`    <changefreq>${page.changefreq}</changefreq>`);
    lines.push(`    <priority>${page.priority}</priority>`);
    for (const img of page.images) {
      lines.push('    <image:image>');
      lines.push(`      <image:loc>${img.loc}</image:loc>`);
      lines.push(`      <image:title>${escapeXml(img.title)}</image:title>`);
      lines.push('    </image:image>');
    }
    lines.push('  </url>');
  }
  lines.push('</urlset>');

  const xml = lines.join(EOL) + EOL;
  // A rebuild must never un-deploy the sitemap, so an already-stamped absolute
  // URL is kept instead of being reverted to the placeholder.
  const site = readStampedSiteUrl();
  const next = site ? xml.split('__SITE_URL__').join(site) : xml;

  const target = path.join(ROOT, 'sitemap.xml');
  const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (next === before) {
    console.log('sitemap.xml : already current');
    return;
  }
  fs.writeFileSync(target, next, 'utf8');
  console.log('sitemap.xml : written from the dataset');
}

/** The URL set-site-url.mjs stamped last, if this checkout has been deployed. */
function readStampedSiteUrl() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'data', '.site-url'), 'utf8').trim();
    return /^https?:\/\/\S+$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* -------------------------------------------------------------------------- */
/* Priority shortlist                                                          */
/*                                                                             */
/* `data/source/priority.json` carries the version numbers the teacher wants    */
/* students to start with. It is a separate file on purpose: the forms export   */
/* is a machine dump that gets replaced wholesale, while this list is his        */
/* editorial judgement and is revised on its own schedule. Updating it is a      */
/* one-file edit plus `npm run build:data` — never a code change, and deleting   */
/* the file is a supported state: every affordance built on it hides itself.     */
/* -------------------------------------------------------------------------- */

const DEFAULT_PRIORITY_LABEL = 'ابدأ بهذه';

function readPriority() {
  const empty = { label: DEFAULT_PRIORITY_LABEL, blurb: null, updated: null, numbers: new Set() };
  if (!fs.existsSync(PRIORITY_FILE)) return empty;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(PRIORITY_FILE, 'utf8'));
  } catch (error) {
    // A malformed shortlist must not take the whole site down: the build
    // continues without it, loudly.
    console.warn(`   ! priority.json is not valid JSON — ignored (${error.message})`);
    return empty;
  }

  const listed = Array.isArray(raw?.sections) ? raw.sections : [];
  const numbers = new Set();
  for (const value of listed) {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) numbers.add(n);
  }

  return {
    label:
      typeof raw?.label === 'string' && raw.label.trim() ? raw.label.trim() : DEFAULT_PRIORITY_LABEL,
    blurb: typeof raw?.blurb === 'string' && raw.blurb.trim() ? raw.blurb.trim() : null,
    updated: typeof raw?.updated === 'string' ? raw.updated : null,
    numbers,
    listed: listed.length,
  };
}

function findSourceFile() {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`Source directory not found: ${SOURCE_DIR}`);
  }
  const candidates = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((f) => path.join(SOURCE_DIR, f))
    // The priority shortlist lives here too, but it is not a forms export.
    .filter((f) => f !== PRIORITY_FILE);

  if (!candidates.length) {
    throw new Error(`No .json export found in ${SOURCE_DIR}`);
  }
  // Prefer the largest file — that is the full export.
  return candidates.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
}

/**
 * A Google Forms *edit* URL hands write access to the live form to anyone who
 * opens it. The teacher's exports sometimes carry one per row («رابط التعديل»),
 * and this repository is public and published whole, so the build refuses to
 * run rather than copy one into the site. Keep those links out of the export.
 */
function assertNoEditLinks(sourceFile, text) {
  const found = text.match(/https:\/\/docs\.google\.com\/forms\/d\/[A-Za-z0-9_-]+\/edit/g);
  if (!found) return;
  console.error(
    `FAILED: ${path.relative(ROOT, sourceFile)} contains ${found.length} Google Forms edit link(s).\n` +
      '        Those grant write access to the live forms and this repository is public.\n' +
      '        Remove every "رابط التعديل" from the export and re-run.',
  );
  process.exit(1);
}

function main() {
  const sourceFile = findSourceFile();
  const sourceText = fs.readFileSync(sourceFile, 'utf8');
  assertNoEditLinks(sourceFile, sourceText);
  const raw = JSON.parse(sourceText);
  const priority = readPriority();

  // Re-exports tend to carry it; it is never copied into the site, but it has
  // no business sitting in the repository either (tools/test-seo.mjs fails on it).
  if (pick(raw, 'كلمة المرور', 'password') !== undefined) {
    console.warn('   ! the export still carries the access code — remove «كلمة المرور» from it');
  }

  const project = pick(raw, 'المشروع', 'project') ?? null;
  const sourceForms = Array.isArray(raw) ? raw : pick(raw, 'الفورمات', 'forms');
  if (!Array.isArray(sourceForms)) {
    throw new Error('Source JSON has no forms array («الفورمات» / "forms").');
  }

  const exams = [];
  const issues = [];
  const seenUrl = new Map();
  const seenNumber = new Map();

  for (const [index, row] of sourceForms.entries()) {
    const rawNumber = pick(row, 'الإصدار', 'section', 'number');
    const where = `#${index} (الإصدار ${rawNumber ?? '?'})`;

    const number = Number(rawNumber);
    if (!Number.isInteger(number) || number <= 0) {
      issues.push({ where, reason: 'invalid-version-number', value: rawNumber });
      continue;
    }

    const rawTitle = String(pick(row, 'الاسم', 'title') ?? '').replace(/\s+/g, ' ').trim();
    const title = cleanTitle(rawTitle, project);
    if (!title) {
      issues.push({ where, reason: 'missing-title' });
      continue;
    }

    const canonical = safeHttpsUrl(pick(row, 'الرابط الكامل', 'url'));
    if (!canonical) {
      issues.push({ where, reason: 'invalid-or-insecure-url', value: pick(row, 'الرابط الكامل', 'url') });
      continue;
    }

    const short = safeHttpsUrl(pick(row, 'الرابط المختصر', 'short'));

    // Store the Google Form id when the URL is canonical — it keeps the payload
    // small. Anything else is kept verbatim (still https-validated).
    const formMatch = canonical.match(GOOGLE_FORM_RE);
    const shortMatch = short ? short.match(SHORT_RE) : null;

    if (seenNumber.has(number)) {
      issues.push({ where, reason: 'duplicate-version-number', value: number });
      continue;
    }
    seenNumber.set(number, true);

    if (seenUrl.has(canonical)) {
      issues.push({
        where,
        reason: 'duplicate-url',
        value: `also used by الإصدار ${seenUrl.get(canonical)}`,
      });
      continue;
    }
    seenUrl.set(canonical, number);

    const norm = normalizeArabic(title);
    const stem = stemKey(norm);

    const record = { n: number, t: title, k: stem === norm ? norm : `${norm} ${stem}` };

    // The versions are not all the same length (the last one is a short
    // top-up), so the count travels with the record rather than being a single
    // figure in meta the card would have to assume applies to it.
    const questions = Number(pick(row, 'عدد الأسئلة', 'questions'));
    if (Number.isInteger(questions) && questions > 0) record.q = questions;
    else if (pick(row, 'عدد الأسئلة', 'questions') !== undefined) {
      issues.push({ where, reason: 'invalid-question-count', value: pick(row, 'عدد الأسئلة', 'questions') });
    }

    if (formMatch) record.f = formMatch[1];
    else record.u = canonical;
    if (shortMatch) record.s = shortMatch[1];
    else if (short) record.su = short;
    // One flag byte rather than a second array the client would have to join.
    if (priority.numbers.has(number)) record.p = 1;

    exams.push(record);
  }

  exams.sort((a, b) => a.n - b.n);

  const numbers = exams.map((e) => e.n);
  const min = numbers.length ? Math.min(...numbers) : 0;
  const max = numbers.length ? Math.max(...numbers) : 0;

  // Contiguous batches derived from the real numbering — not invented. The step
  // follows the size of the set so the quick-jump chips stay a single readable
  // row: four or five chips, whether the export holds 42 rows or 400.
  const BATCH = max > 150 ? 50 : max > 60 ? 20 : 10;
  const ranges = [];
  for (let start = Math.floor((min - 1) / BATCH) * BATCH + 1; start <= max; start += BATCH) {
    const end = Math.min(start + BATCH - 1, max);
    const count = numbers.filter((n) => n >= start && n <= end).length;
    if (count > 0) ranges.push({ from: start, to: end, count });
  }

  // A short trailing batch (e.g. "41–42") is noise as its own chip — fold it
  // into the previous one so the quick-jump chips stay evenly weighted.
  if (ranges.length > 1) {
    const tail = ranges[ranges.length - 1];
    if (tail.count <= BATCH / 4) {
      const prev = ranges[ranges.length - 2];
      prev.to = tail.to;
      prev.count += tail.count;
      ranges.pop();
    }
  }

  // Per-form counts: one figure in meta only if every form really carries it.
  const counts = exams.map((e) => e.q).filter((q) => Number.isInteger(q));
  const complete = counts.length === exams.length && exams.length > 0;
  const uniform = complete && counts.every((q) => q === counts[0]);
  const totalQuestions = complete
    ? counts.reduce((sum, q) => sum + q, 0)
    : Number(pick(raw, 'إجمالي الأسئلة', 'total_questions')) || null;
  const questionsTypical = complete
    ? Number(
        [...counts]
          .sort(
            (a, b) =>
              counts.filter((q) => q === b).length - counts.filter((q) => q === a).length || b - a,
          )[0],
      )
    : null;

  // A number on the shortlist that no published form answers to is a typo in
  // the shortlist, not a reason to fail: it is dropped and reported.
  const published = new Set(exams.map((e) => e.n));
  const priorityUnknown = [...priority.numbers].filter((n) => !published.has(n)).sort((a, b) => a - b);
  const priorityCount = exams.filter((e) => e.p).length;

  // The export carries no date of its own, so the file's own mtime is the
  // dataset's date: it changes exactly when the data changes, and never on a
  // rebuild that changed nothing.
  const generated =
    String(pick(raw, 'التاريخ', 'generated') ?? '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ??
    fs.statSync(sourceFile).mtime.toISOString().slice(0, 10);

  const payload = {
    meta: {
      project,
      teacher: pick(raw, 'المعلم', 'teacher') ?? null,
      generated,
      note: pick(raw, 'ملاحظة', 'note') ?? null,
      questionsPerForm: uniform ? counts[0] : null,
      questionsTypical,
      total: exams.length,
      totalQuestions,
      first: min,
      last: max,
      ranges,
      priority: priorityCount
        ? {
            label: priority.label,
            blurb: priority.blurb,
            count: priorityCount,
            updated: priority.updated,
          }
        : null,
      builtAt: new Date().toISOString().slice(0, 10),
    },
    exams,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload), 'utf8');

  stampHero(payload.meta);
  writeLlmsTxt(payload.meta);
  writeSitemap(payload.meta);

  const report = {
    sourceFile: path.relative(ROOT, sourceFile).replace(/\\/g, '/'),
    sourceRecords: sourceForms.length,
    published: exams.length,
    excluded: issues.length,
    issues,
    questions: {
      total: totalQuestions,
      perForm: payload.meta.questionsPerForm,
      typical: questionsTypical,
      counted: counts.length,
    },
    priority: {
      label: priority.label,
      listed: priority.listed ?? 0,
      flagged: priorityCount,
      unknown: priorityUnknown,
    },
    outputBytes: fs.statSync(OUT_FILE).size,
    ranges,
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');

  console.log(`source      : ${report.sourceFile}`);
  console.log(`records     : ${sourceForms.length}`);
  console.log(`published   : ${exams.length}`);
  console.log(`excluded    : ${issues.length}`);
  for (const i of issues) console.log(`   ! ${i.where} — ${i.reason} ${i.value ?? ''}`);
  console.log(
    `questions   : ${totalQuestions ?? '—'} total` +
      (payload.meta.questionsPerForm ? ` (${payload.meta.questionsPerForm} each)` : ` (${questionsTypical} typical)`),
  );
  console.log(`priority    : ${priorityCount} flagged "${priority.label}"`);
  for (const n of priorityUnknown) console.log(`   ! priority ${n} — no published form with that number`);
  console.log(`ranges      : ${ranges.map((r) => `${r.from}-${r.to}(${r.count})`).join(' ')}`);
  console.log(`dataset date: ${generated}`);
  console.log(`output      : assets/data/exams.json  (${(report.outputBytes / 1024).toFixed(1)} KB)`);

  if (exams.length === 0) {
    console.error('FAILED: no publishable exams were produced.');
    process.exit(1);
  }
}

main();
