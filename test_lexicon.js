/* Regression test for the language tagger in build_books_mixed.js.
 *
 * The word lists are meant to be edited, and editing them is exactly how a
 * subtle bug gets in: adding "six" to the English list was enough to flip an
 * entire table of French numbers, because one cell voting the wrong way tied
 * the column vote. This file pins down the behaviour so that kind of change
 * fails loudly instead of quietly.
 *
 * Run after ANY change to the lists, LANG_OVERRIDES, or the scorer:
 *     node test_lexicon.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Load the builder's internals without running its driver (which would prompt
// for a passphrase and write files).
const src = fs.readFileSync(path.join(__dirname, 'build_books_mixed.js'), 'utf8');
const cut = src.indexOf('// ============================== driver');
if (cut < 0) { console.error('Could not find the driver marker in build_books_mixed.js'); process.exit(1); }
const mod = { exports: {} };
new Function('module', 'exports', 'require', 'process', '__dirname', console.log
  ? src.slice(0, cut) + '\nmodule.exports={classify,scoreText,buildTableBlock,segmentLine,' +
    'FR_FUNCTION,FR_LEXICON,EN_FUNCTION,EN_LEXICON,NEUTRAL,GEN_FR,GEN_EN,'+
    'speechText,extractBook};'
  : '')(mod, mod.exports, require, process, __dirname);
const M = mod.exports;
const tag = t => M.classify(M.scoreText(t));

let fails = 0, passes = 0;
function expect(text, want, note) {
  const got = tag(text);
  if (got === want) { passes++; return; }
  fails++;
  console.error(`  FAIL  want ${want}, got ${got}  ${JSON.stringify(text)}${note ? '   (' + note + ')' : ''}`);
}
function section(name) { console.log('\n' + name); }

/* ---------------------------------------------------------------------------
 * 1. FRENCH NUMBERS — the case this test was written for.
 * A column of these has no French function word in most cells, so every one
 * of them has to stand on its own vocabulary.
 * ------------------------------------------------------------------------- */
section('French numbers (the regression that started this)');
['20 vingt', '21 vingt et un', '22 vingt-deux', '23 vingt-trois', '24 vingt-quatre',
 '25 vingt-cinq', '26 vingt-six', '27 vingt-sept', '28 vingt-huit', '29 vingt-neuf',
 '30 trente', '40 quarante', '50 cinquante', '60 soixante', '70 soixante-dix',
 '80 quatre-vingts', '90 quatre-vingt-dix', '91 quatre-vingt-onze',
 'Onze, douze, treize, quatorze, quinze', 'dix-sept, dix-huit, dix-neuf, vingt',
].forEach(t => expect(t, 'fr'));

/* ---------------------------------------------------------------------------
 * 2. COGNATE TRAPS — words that look French but are ordinary English too.
 * Each of these must be decided by the REST of the sentence, never by the
 * cognate itself. If one of these starts failing, a cognate has been added
 * to a language list.
 * ------------------------------------------------------------------------- */
section('English sentences containing French-looking words');
expect('Six of the students were there.', 'en', 'six is identical in both');
expect('It costs one cent more.', 'en', 'cent is identical in both');
expect('Pour the milk into the glass.', 'en', 'pour is a common English verb');
expect('The table was set for two.', 'en', 'table is identical in both');
expect('She put the chair on the table.', 'en');
expect('He has a plus and a minus.', 'en', 'plus is identical in both');
expect('The village was quiet that evening.', 'en', 'village is identical in both');
expect('Her son was born in September.', 'en', 'son is identical in both');

section('French sentences using the same words');
expect('Il y a six chaises dans la salle.', 'fr');
expect('Le village est tranquille.', 'fr');
expect('Son fils est né en septembre.', 'fr');
expect('Mettez la tasse sur la table.', 'fr');

/* ---------------------------------------------------------------------------
 * 3. ORTHOGRAPHY — evidence that needs no vocabulary at all.
 * ------------------------------------------------------------------------- */
section('French orthography with no recognisable vocabulary');
expect('Sachons !', 'fr', 'space before "!" is French typography');
expect('Allons-y !', 'fr');
expect('Culture : Les Salutations', 'fr');
expect('L\u2019employ\u00e9e', 'fr', 'elision');
expect('Premi\u00e8re Rencontre', 'fr', 'accent inside a capitalised word');
expect('\u00e9crivez', 'fr', 'lowercase accented word');

section('English that must NOT be caught by those rules');
expect('Complete Table: 20 to 100', 'en', 'no space before the colon');
expect('Dialogue 3: Weekend Activities', 'en');
expect('What Is This Book?', 'en', 'no space before "?"');
expect('\u00c9lise arrived late that evening.', 'en', 'leading accented capital is a name');

/* ---------------------------------------------------------------------------
 * 4. CODE-SWITCHED PROSE — the everyday case.
 * ------------------------------------------------------------------------- */
section('Mixed narrative and dialogue');
expect('The driver squinted at her and shrugged.', 'en');
expect('"Un peu."', 'fr');
expect('A little.', 'en');
expect('"O\u00f9 allez-vous?"', 'fr');
expect('Where are you going?', 'en');
expect('Bonjour, madame.', 'fr');
expect('Je peux vous aider ?', 'fr');
expect('Saying "Bonjour": A Golden Rule', 'en', 'a cited French word must not hijack the sentence');
expect('In France, saying bonjour is extremely important.', 'en');
expect('Emma nodded.', 'en');
expect('Emma\u2019s throat tightened.', 'en');
expect('Le choix entre "tu" et "vous"', 'fr');

section('Headings in both languages');
expect('Grammaire : Les Salutations et les Pronoms Sujets', 'fr');
expect('Grammar Spotlight: Greetings and Subject Pronouns', 'en');
expect('Vocabulaire du Chapitre', 'fr');
expect('Chapter Vocabulary', 'en');
expect('Salutations', 'fr');
expect('Greetings', 'en');
expect('R\u00e9ponses aux exercices', 'fr');
expect('Answer Key', 'en');

section('Food and everyday vocabulary (vocabulary-table cells)');
['le fromage', 'le poulet', 'le lait', 'la tomate', 'le jambon', 'une fraise',
 'la boulangerie', 'mon oncle', 'ma voisine', 'les aliments',
].forEach(t => expect(t, 'fr'));
['cheese', 'chicken', 'milk', 'tomato', 'ham', 'a strawberry', 'the bakery',
].forEach(t => expect(t, 'en'));

/* ---------------------------------------------------------------------------
 * 5. STRUCTURAL — the whole number table end to end, which is what actually
 * broke. Column voting has to land on French for every cell.
 * ------------------------------------------------------------------------- */
section('The full number table (column voting)');
const numberTable = [
  '| 20-29 | 30-39 | 40-49 | 50-59 |',
  '|-------|-------|-------|-------|',
  '| 20 vingt | 30 trente | 40 quarante | 50 cinquante |',
  '| 21 vingt et un | 31 trente et un | 41 quarante et un | 51 cinquante et un |',
  '| 22 vingt-deux | 32 trente-deux | 42 quarante-deux | 52 cinquante-deux |',
  '| 25 vingt-cinq | 35 trente-cinq | 45 quarante-cinq | 55 cinquante-cinq |',
  '| 26 vingt-six | 36 trente-six | 46 quarante-six | 56 cinquante-six |',
];
const tb = M.buildTableBlock(numberTable, false);
const wrongCells = tb.segs.filter(s => s.lang !== 'fr');
if (wrongCells.length) {
  fails++;
  console.error('  FAIL  ' + wrongCells.length + ' of ' + tb.segs.length +
    ' cells not French, e.g. ' + JSON.stringify(wrongCells.slice(0, 4).map(s => s.text)));
} else { passes++; console.log('  ok    all ' + tb.segs.length + ' cells tagged French'); }

section('A bilingual vocabulary table keeps its columns apart');
const vocabTable = [
  '| Fran\u00e7ais | English | Pronunciation Guide |',
  '|---|---|---|',
  '| Bonjour | Hello / Good day | (bohn-ZHOOR) |',
  '| Bonsoir | Good evening | (bohn-SWAHR) |',
  '| Merci | Thank you | (mehr-SEE) |',
];
const vt = M.buildTableBlock(vocabTable, false);
const byText = {};
vt.segs.forEach(s => { byText[s.text] = s.lang; });
[['Bonjour', 'fr'], ['Bonsoir', 'fr'], ['Merci', 'fr'],
 ['Hello / Good day', 'en'], ['Good evening', 'en'], ['Thank you', 'en'],
].forEach(([t, want]) => {
  const got = byText[t];
  if (got === want) { passes++; }
  else { fails++; console.error('  FAIL  cell ' + JSON.stringify(t) + ' want ' + want + ', got ' + got); }
});
if (vt.segs.some(s => /ZHOOR|SWAHR|mehr/.test(s.text))) {
  fails++; console.error('  FAIL  pronunciation column was made speakable');
} else { passes++; console.log('  ok    pronunciation column displayed but not spoken'); }

/* ---------------------------------------------------------------------------
 * 6. LIST HYGIENE — a word on both sides votes for neither, which silently
 * removes evidence instead of adding it. Same for a word duplicated into
 * NEUTRAL, which overrides both. Neither is a crash, so nothing would ever
 * surface it without this check.
 * ------------------------------------------------------------------------- */
section('Word-list hygiene');
const handFr = new Set([...M.FR_FUNCTION, ...M.FR_LEXICON]);
const handEn = new Set([...M.EN_FUNCTION, ...M.EN_LEXICON]);
function hygiene(name, list, cond) {
  const bad = [...list].filter(cond);
  if (bad.length) { fails++; console.error('  FAIL  ' + name + ': ' + bad.slice(0, 10).join(', ') + (bad.length > 10 ? ' …(' + bad.length + ')' : '')); }
  else { passes++; console.log('  ok    ' + name); }
}
hygiene('no word in both curated language lists', handFr, w => handEn.has(w));
hygiene('no curated word shadowed by NEUTRAL', [...handFr, ...handEn], w => M.NEUTRAL.has(w));
hygiene('no generated French word contradicts the curated English list', M.GEN_FR, w => handEn.has(w));
hygiene('no generated English word contradicts the curated French list', M.GEN_EN, w => handFr.has(w));
hygiene('no word in both generated lists', M.GEN_FR, w => M.GEN_EN.has(w));
hygiene('no generated word shadowed by NEUTRAL', [...M.GEN_FR, ...M.GEN_EN], w => M.NEUTRAL.has(w));

/* ---------------------------------------------------------------------------
 * 7. CITATION SPLITTING — how the grammar books cite one language inside a
 * sentence of the other. Each of these was a real misreading.
 * ------------------------------------------------------------------------- */
section('Citations inside a sentence of the other language');
function expectSplit(text, wantPairs, note) {
  const segs = M.segmentLine(text, null).map(s => s.lang + ':' + s.text.trim());
  const got = segs.join(' | ');
  const ok = wantPairs.every(w => segs.some(s => s.startsWith(w[0] + ':') && s.includes(w[1])));
  if (ok) { passes++; return; }
  fails++;
  console.error('  FAIL  ' + JSON.stringify(text) + (note ? '  (' + note + ')' : ''));
  console.error('        got: ' + got);
}
// A slash-joined cluster is how a set of French forms gets cited; it must be
// tagged on its own without dragging the English sentence with it.
expectSplit('Only 3rd person changes: le/la/les (direct)',
  [['en', 'Only 3rd person changes'], ['fr', 'le/la/les']]);
expectSplit('In affirmative commands, le/la/les come FIRST!',
  [['en', 'In affirmative commands'], ['fr', 'le/la/les'], ['en', 'come FIRST']]);
expectSplit('Two-stem verbs: vienn- for je/tu/il/ils, but ven- for nous/vous!',
  [['fr', 'je/tu/il/ils'], ['fr', 'nous/vous']]);
// A quote inside parentheses must not be swallowed by the parentheses.
expectSplit('Mini response (to "Qu\u2019est-ce qui est important pour r\u00e9ussir dans la vie?"):',
  [['en', 'Mini response'], ['fr', 'Qu\u2019est-ce qui est important']]);
// English colon splits; the French spaced colon must NOT, or the spacing
// signal that identifies the heading as French is destroyed.
expectSplit('Exception: A few nouns in -al simply take -s: le festival les festivals.',
  [['en', 'Exception'], ['fr', 'le festival les festivals']]);
expect('Introduction : ', 'fr', 'French spaced colon must survive splitting');
expect('Culture : Les Salutations', 'fr');
expectSplit('Les Salutations (Greetings)', [['fr', 'Les Salutations'], ['en', 'Greetings']]);

/* ---------------------------------------------------------------------------
 * 8. SPEECH CLEANUP — what must never reach a voice.
 * ------------------------------------------------------------------------- */
section('Speech cleanup');
function expectSpeech(input, want) {
  const got = M.speechText(input);
  if (got === want) { passes++; return; }
  fails++;
  console.error('  FAIL  ' + JSON.stringify(input) + ' -> ' + JSON.stringify(got) +
    ', want ' + JSON.stringify(want));
}
expectSpeech('\u2502 Is it the SUBJECT of the \u2502', 'Is it the SUBJECT of the');
expectSpeech('\u250c\u2500\u2500\u2500\u2510', '');
expectSpeech('YES \u2500\u2500\u2500\u2534\u2500\u2500\u2500 NO', 'YES NO');
expectSpeech('\u25bc', '');
expectSpeech('\u23f1 5 minutes', '5 minutes');
expectSpeech('\u2705 Complete beginners', 'Complete beginners');
expectSpeech('\u2022 Stationnement gratuit', 'Stationnement gratuit');
expectSpeech('je \u2192 j\u2019', 'je j\u2019');
expectSpeech('Je _______ am\u00e9ricaine.', 'Je \u2026 am\u00e9ricaine.');

/* ---------------------------------------------------------------------------
 * 9. CHAPTER STRUCTURE — bilingual heading pairs, part dividers, ASCII art.
 * Run through extractBook so the real chapter assembly is exercised.
 * ------------------------------------------------------------------------- */
section('Chapter structure');
const os = require('os');
function build(md) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mixtest-')), 'b.md');
  fs.writeFileSync(f, md, 'utf8');
  return M.extractBook(f);
}
function structure(name, md, check) {
  const book = build(md);
  const msg = check(book);
  if (msg) { fails++; console.error('  FAIL  ' + name + ': ' + msg); }
  else { passes++; console.log('  ok    ' + name); }
}

// The same heading in two languages is ONE chapter.
structure('a bilingual heading pair becomes one chapter',
  '# Chapitre 1 : L\u2019Arriv\u00e9e\n\n# Chapter 1: The Arrival\n\nEmma arrived.\n',
  b => b.chapters.length === 1 && /Chapitre 1/.test(b.chapters[0].title) && /Chapter 1/.test(b.chapters[0].title)
    ? null : 'got ' + b.chapters.length + ' chapter(s): ' + b.chapters.map(c => c.title).join(' // '));

// ...but a part divider followed by its first chapter is TWO, and neither
// title may be lost. Merging these was a real bug: "Appendix A" disappeared.
structure('a part divider is not mistaken for a translation',
  '# Appendices\n\n---\n\n# Appendix A: Exam Preparation Guide\n\n## How It Works\n\nSome text.\n',
  b => {
    const all = b.chapters.map(c => c.title).join(' // ');
    if (!/Appendices/.test(all)) return 'the "Appendices" title was lost: ' + all;
    if (!/Appendix A: Exam Preparation Guide/.test(all)) return 'the "Appendix A" title was lost: ' + all;
    if (/Appendices \/ Appendix A/.test(all)) return 'wrongly merged as a bilingual pair: ' + all;
    return null;
  });

// An English heading that cites French must still pair with its French twin.
structure('a heading citing the other language still pairs correctly',
  '## \ud83d\udcda Grammaire : Les Pronoms Relatifs Abstraits (ce qui, ce que, ce dont)\n\n' +
  '> ## \ud83d\udcda Grammar Spotlight: Abstract Relative Pronouns (ce qui, ce que, ce dont)\n\nNous avons appris.\n',
  b => b.chapters.length === 1 && /Grammaire/.test(b.chapters[0].title) && /Grammar Spotlight/.test(b.chapters[0].title)
    ? null : 'got ' + b.chapters.length + ': ' + b.chapters.map(c => c.title).join(' // '));

// A chapter with nothing but its heading keeps the heading rather than vanishing.
structure('a title-only chapter survives',
  '# Just A Title\n\n# Another Title\n\nBody text here.\n',
  b => b.chapters.some(c => /Just A Title/.test(c.title)) ? null
    : 'lost: ' + b.chapters.map(c => c.title).join(' // '));

// Flowcharts must be preformatted, and their frame characters silent.
structure('a box-drawing flowchart becomes a preformatted art block',
  '# Chart\n\nSTART: is it the subject?\n\u2502\n\u25bc\n\u250c\u2500\u2500\u2500\u2500\u2510\n\u2502 QUI \u2502\n\u2514\u2500\u2500\u2500\u2500\u2518\n',
  b => {
    const art = b.chapters[0].blocks.find(x => x.type === 'art');
    if (!art) return 'no art block; got ' + b.chapters[0].blocks.map(x => x.type).join(',');
    if (!art.html.includes('\n')) return 'art block lost its line breaks';
    if (!/[\u2500-\u257F]/.test(art.html)) return 'art block lost its box characters from the display';
    const spoken = art.segs.map(s => s.text).join(' ');
    if (/[\u2500-\u257F\u25bc]/.test(spoken)) return 'box characters reached the speech text: ' + JSON.stringify(spoken);
    if (!/QUI/.test(spoken)) return 'the text inside the boxes is not spoken: ' + JSON.stringify(spoken);
    return null;
  });

// Every data-seg span must have a segs entry and vice versa, on every block.
structure('span and segment indices stay aligned',
  '# T\n\n**"Un peu."** *A little.* Bonjour, madame. Je peux vous aider ?\n\n' +
  '| Fran\u00e7ais | English |\n|---|---|\n| Bonjour | Hello |\n',
  b => {
    for (const ch of b.chapters) for (const bl of ch.blocks) {
      const found = new Set([...bl.html.matchAll(/data-seg="(\d+)"/g)].map(m => +m[1]));
      for (const i of found) if (i >= bl.segs.length) return 'orphan span ' + i;
      for (let i = 0; i < bl.segs.length; i++) if (!found.has(i)) return 'missing span ' + i;
      for (const sg of bl.segs) if (!sg.text.trim()) return 'a segment has no speakable text';
    }
    return null;
  });


console.log('\n' + passes + ' passed, ' + fails + ' failed');
if (M.GEN_FR.size === 0) console.log('(note: lexicon.js was not loaded — generated-list coverage untested)');
process.exit(fails ? 1 : 0);
