#!/usr/bin/env node
/**
 * Search + data smoke tests. Run with `npm test`.
 * Exercises the real built dataset — not fixtures — so a bad source export or a
 * regression in Arabic folding fails the build.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuery, searchExams, highlightRanges, normalize } from '../assets/js/search.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/exams.json'), 'utf8'));
const { exams, meta } = data;

let pass = 0;
let fail = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label} ${detail}`);
  }
}

function q(text) {
  return searchExams(exams, parseQuery(text));
}

console.log('\ndataset');
assert('has exams', exams.length > 0);
assert('meta.total matches', meta.total === exams.length);
assert('every exam has a number', exams.every((e) => Number.isInteger(e.n) && e.n > 0));
assert('every exam has a title', exams.every((e) => typeof e.t === 'string' && e.t.trim()));
assert('every exam has a link source', exams.every((e) => e.f || e.u));
assert('numbers are unique', new Set(exams.map((e) => e.n)).size === exams.length);
assert('form ids are unique', new Set(exams.map((e) => e.f || e.u)).size === exams.length);
assert(
  'form ids are url-safe',
  exams.every((e) => !e.f || /^[A-Za-z0-9_-]+$/.test(e.f)),
);
assert(
  'explicit urls are https',
  exams.every((e) => !e.u || e.u.startsWith('https://')),
);

assert(
  'every exam declares its question count',
  exams.every((e) => Number.isInteger(e.q) && e.q > 0),
);
assert(
  'question counts add up to meta.totalQuestions',
  exams.reduce((sum, e) => sum + e.q, 0) === meta.totalQuestions,
);
assert(
  'the brand is not repeated inside every title',
  !exams.every((e) => e.t.includes('المتميز')),
);

console.log('\nexact and partial matching');
assert('exact title', q(exams[0].t).results[0]?.n === exams[0].n);
assert('word without the definite article', q('اصدار').results.length === exams.length);
assert('multi-word AND', q('الحادي عشر').results[0]?.n === 11);
assert('an ordinal that no version carries', q('الخمسون').results.length === 0);

console.log('\nnumber lookup');
assert('exact number wins', q('11').results[0]?.n === 11);
// Derived from the dataset, not written down: dropping versions off the end
// of the export must not take a test case with them.
const lastNumber = exams[exams.length - 1].n;
const arabicIndic = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
assert('arabic-indic digits', q(arabicIndic(lastNumber)).results[0]?.n === lastNumber);
// A single digit is a prefix, not only an exact hit: "1" must still reach the teens.
assert('number prefix expands', q('1').results.some((e) => e.n > 9));
assert('out-of-range number', q('9999').results.length === 0);

console.log('\nforgiveness');
assert('hamza folded', q('الاصدار الاول').results[0]?.n === 1);
assert('diacritics in the query', q('الإصدارُ الأوَّل').results[0]?.n === 1);
assert('punctuation is ignored', q('الإصدار (الأول)').results[0]?.n === 1);
{
  const r = q('الاصدر الاول'); // one letter dropped
  assert('single-character typo recovers', r.results.some((e) => e.n === 1) && r.fuzzy);
}
// Folding rules the version names happen not to exercise are checked on the
// folder itself, so they stay covered whatever the export is called.
assert('ta-marbuta folded', normalize('الابتسامة') === normalize('الابتسامه'));
assert('alef-maqsura folded', normalize('الملتقى') === normalize('الملتقي'));
assert('tatweel folded', normalize('الإصـــدار') === normalize('الإصدار'));

console.log('\nedge cases');
assert('blank query returns everything', q('   ').results.length === exams.length);
assert('symbols-only query returns everything', q('!!!###').results.length === exams.length);
assert('nonsense returns nothing', q('zzzzqqq').results.length === 0);
assert('very long query does not throw', q('ا'.repeat(500)).results.length >= 0);

console.log('\nhighlighting maps back to the original title');
{
  const target = exams.find((e) => e.n === 1);
  const ranges = highlightRanges(target.t, parseQuery('الاصدار'));
  assert(
    'folded characters keep correct indices',
    ranges.length === 1 && target.t.slice(ranges[0][0], ranges[0][1]) === 'الإصدار',
    JSON.stringify(ranges),
  );
}
{
  const target = exams.find((e) => e.n === 11);
  const ranges = highlightRanges(target.t, parseQuery('حادي'));
  assert(
    'highlights the plain word',
    ranges.length > 0 && ranges.every(([a, b]) => target.t.slice(a, b).includes('حادي')),
    JSON.stringify(ranges),
  );
}
{
  const ranges = highlightRanges('الإصدار الحادي عشر', parseQuery('11'));
  assert('number queries do not highlight', ranges.length === 0);
}

// The other collections are smaller and carry no question counts, so they get
// the structural checks and a lookup each, read from whatever the build wrote.
const EXTRA_FILES = ['tasis.json', 'namazij.json'];
const linkOf = (e) =>
  e.u ||
  (e.f ? `https://docs.google.com/forms/d/e/${e.f}/viewform` : null) ||
  (e.s ? `https://forms.gle/${e.s}` : null);
const allLinks = exams.map(linkOf);

for (const file of EXTRA_FILES) {
  const full = path.join(ROOT, 'assets/data', file);
  if (!fs.existsSync(full)) {
    console.log(`\ncollection ${file}: not built (no export) — skipped`);
    continue;
  }
  const { exams: set, meta: setMeta } = JSON.parse(fs.readFileSync(full, 'utf8'));
  const find = (text) => searchExams(set, parseQuery(text)).results;
  console.log(`\ncollection ${file}`);
  assert('has forms', set.length > 0);
  assert('meta.total matches', setMeta.total === set.length);
  assert('names itself', typeof setMeta.id === 'string' && typeof setMeta.name === 'string');
  assert('every form has a number', set.every((e) => Number.isInteger(e.n) && e.n > 0));
  assert('numbers are unique', new Set(set.map((e) => e.n)).size === set.length);
  assert('every form has a title', set.every((e) => typeof e.t === 'string' && e.t.trim()));
  assert('every form resolves to an https link', set.every((e) => linkOf(e)?.startsWith('https://')));
  assert('links are unique', new Set(set.map(linkOf)).size === set.length);
  assert('the brand is not repeated inside every title', !set.every((e) => e.t.includes('المتميز')));
  assert('a number finds its form', find(String(set[set.length - 1].n))[0]?.n === set[set.length - 1].n);
  assert('an exact title finds its form', find(set[0].t)[0]?.n === set[0].n);
  allLinks.push(...set.map(linkOf));
}

console.log('\nacross collections');
assert('no form is published in two collections', new Set(allLinks).size === allLinks.length);

console.log('\nperformance');
{
  const queries = ['الإصدار', 'ا', 'الحادي عشر', '11', 'zzz', 'الاصدار الاول'];
  const start = performance.now();
  const runs = 300;
  for (let i = 0; i < runs; i += 1) q(queries[i % queries.length]);
  const ms = performance.now() - start;
  console.log(`  ${runs} searches over ${exams.length} records in ${ms.toFixed(1)}ms`);
  assert('average search under 5ms', ms / runs < 5, `${(ms / runs).toFixed(2)}ms`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
