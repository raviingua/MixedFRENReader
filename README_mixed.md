# Mixed FR/EN reader — the third app

For books like `LanguageCafe1-upd.md`, where French and English are interleaved
**inside** the same paragraph, sentence, dialogue line and table row.

The text is shown exactly as written, one paragraph per reading block, with no
pairing and nothing dropped. When a paragraph switches language, the voice and
the speed switch with it.

## Why this needed a third app

Your first two builders can answer "which language is this?" from **position**:

| | Source shape | How language is known |
|---|---|---|
| `build_books.js` | French paragraph, then its English translation in a `>` blockquote | plain block = FR, blockquote = EN |
| `build_books_monolingual.js` | French only | everything is FR |
| `build_books_mixed.js` | one code-switched text | **position tells you nothing** |

Compare the two files you sent:

`Agriculture.md` — clean separation, one language per block:

```
Camille Roy stepped through the front door of the Hollow Creek county extension office…

> Camille Roy franchit la porte d'entrée du bureau de vulgarisation agricole…
```

`LanguageCafe1-upd.md` — three language switches in one line, and the markup is
no help, because `**bold**` marks both French quotes *and* English emphasis:

```
The driver squinted at her, took a long drag of his cigarette, and shrugged.
**"Un peu."** *A little.* He gestured vaguely. **"Où allez-vous?"** *Where are you going?*
```

So the language has to be **worked out and written into the data at build
time**. That is what this builder does, and it is the whole reason the app
exists.

## Files

| File | What it is |
|---|---|
| `build_books_mixed.js` | Node build step. No npm dependencies. Writes `data-mixed/`. |
| `lexicon.js` | Generated French/English word lists the builder reads. Keep it next to the builder. |
| `tools/make_lexicon.py` | Regenerates `lexicon.js` (`pip install wordfreq`). |
| `index_mixed.html` | The reader. Single self-contained file. |
| `test_reader.js` | Optional end-to-end playback test (needs `npm i jsdom`). |
| `test_autochapter.js` | Optional test for continuous chapter playback. |
| `test_exercise.js` | 26 checks for exercise mode (needs jsdom). |
| `test_lexicon.js` | 116 checks: classifier, word lists, speech cleanup, chapter structure. |
| `tools/verify_build.js` | Checks a whole built library for fidelity and integrity. |
| `tools/audit_report.py` | Flags likely mis-tagged segments in a `--report` file. |

## Build

```powershell
$env:BOOK_PASSPHRASE="your secret"
node build_books_mixed.js .\books-src\ . --report
```

Arguments are `[srcDir] [outDir] [dataDirName]`, same as your other two
builders. Output:

```
<outDir>/data-mixed/manifest.json    book + chapter titles, PBKDF2 params
<outDir>/data-mixed/<book-id>.enc    blocks, AES-256-GCM encrypted
<outDir>/data-mixed/segments-report.txt   with --report: the tagging audit
```

Same encryption scheme and same passphrase workflow as before. The data folder
is `data-mixed`, **not** `data`, deliberately: each builder wipes its own data
folder on every run, so this keeps all three libraries able to live in one repo
without clobbering each other.

### Flags

| Flag | Effect |
|---|---|
| `--report` | Write `segments-report.txt`: every block, every segment, and the language chosen for it. **Use this.** See "Tuning" below. |
| `--default-lang=fr` | Language for a fragment with no evidence and no tagged neighbour. Default `en`. |
| `--no-title-block` | Don't emit the chapter's own heading as its first reading block. |
| `--keep-pronunciation` | Read "Pronunciation Guide" table columns aloud. Off by default — `(bohn-ZHOOR)` is noise in any voice. |

## How the language tagging works

Each source line is taken apart, tagged, and put back together:

1. **Split**, aggressively, wherever a language change could occur: bold/italic
   span edges, sentence ends, `" / "`, em-dashes, parentheses, and quoted
   spans. Separators are kept as their own fragments so the line can be
   reassembled character for character.
2. **Tag** each fragment `fr` / `en` / `none` by counting function words — the
   strongest signal available on short text — plus French elisions (`l'`, `j'`,
   `qu'`) and accent placement. `none` is a real answer: `"Emma,"`, `"1998"`.
3. **Merge** neighbours back together while they agree, so a plain English
   paragraph becomes a few whole sentences rather than a stutter of word-sized
   utterances. Untagged fragments are absorbed by what they sit next to.
   Merging stops at sentence ends and line breaks, so **a segment is at most
   one sentence** — that is what makes sentence-level highlighting and
   pause/resume work.
4. Anything still untagged inherits from its nearest tagged neighbour, then
   from `--default-lang`.

Each block ships as:

```json
{ "type":"p", "html":"<span class=\"ttsSeg\" data-seg=\"0\" data-lang=\"fr\">…</span>…",
  "segs":[ {"lang":"fr","text":"…"}, {"lang":"en","text":"…"} ] }
```

The reader speaks `segs[i].text` with the voice and speed for `segs[i].lang`,
and highlights the span with the matching `data-seg`. **The reader makes no
language decisions of its own** — anything mis-spoken is a build-time tagging
question, so rebuild with `--report` and look at the audit.

### Results on your file

112 chapters, 3,564 blocks, 18,367 segments — 10,798 FR / 7,569 EN.

A mixed dialogue line comes out like this:

```
FR  L'employée : Bonjour, madame.
FR  Je peux vous aider ?
FR  Emma : Bonjour.
FR  Um...
EN  English?
FR  Anglais ?
FR  L'employée : Oui, un peu.
EN  I speak a little.
EN  Emma : Oh, thank you!
FR  Merci !
EN  I need to go to Saint-Véran-sur-Loire.
```

And a French explanation followed by its English blockquote keeps the cited
French words in French on both sides:

```
[block] p
  FR  En France, dire "bonjour" est extrêmement important.
[block] p (quote)
  EN  In France, saying
  FR  "bonjour"
  EN  is extremely important.
```

### Coverage: the generated lexicon

The hand-written lists in the builder encode what the audit report taught us
about this book. They can't cover the long tail, and that gap caused a real
misreading: a table column of `20 vingt / 21 vingt et un / 22 vingt-deux / …`
had no French function word in most cells, so almost every cell scored as
no-evidence — and one stray miscount (`26 vingt-six`, because `six` was on the
English list) tied the column vote and flipped the whole table to English.

Filling that tail by hand is *how cognate bugs get in*. So `lexicon.js` is
generated from corpus frequencies instead (`tools/make_lexicon.py`, using
`wordfreq`), keeping a word only when it is decisively more one language than
the other:

```
vingt   fr 4.82  en 1.96   ->  French      kept
cinq    fr 5.28  en 2.17   ->  French      kept
six     fr 5.15  en 5.29   ->  ambiguous   dropped
sept    fr 5.00  en 4.35   ->  ambiguous   dropped  (English "Sept." = September)
cent    fr 4.65  en 4.83   ->  ambiguous   dropped
pour    fr 6.98  en 4.10   ->  clears the ratio test, but "pour the milk" is
                                ordinary English, so the absolute ceiling drops it
```

Cognates fail these tests and are excluded automatically rather than being
discovered later. Two details worth knowing:

- The French list holds only **unaccented** words. Accented French is already
  identified by the accent rule, so listing `frère` would add nothing but bytes.
- The margins are **asymmetric** (2.0 French, 1.2 English). French corpora are
  full of English while English corpora contain little French, so `cheese`
  scores fr 3.23 / en 4.57 — a gap of only 1.34 — and a symmetric threshold
  would reject most everyday English nouns. Measured against a guard list of
  French vocabulary, the lower English margin admits 16 of 19 wanted English
  words and lets through zero French ones.

Precedence is deliberate, so this can only ever *add* evidence where there was
none: `NEUTRAL` beats everything, the curated lists beat the generated ones,
and a generated word that would contradict a curated one is discarded. If
`lexicon.js` is missing the build still works, with a warning, falling back to
the curated lists alone.

### Tuning

The word lists near the top of the builder are meant to be edited. **Run
`node test_lexicon.js` after any change** — it pins 93 cases including every
cognate trap, and the failure mode here is silent, not a crash. The builder
also warns at build time if a word ends up on both language lists (it then
votes for neither, removing evidence instead of adding it) or is shadowed by
`NEUTRAL`.

Five things worth knowing, because each fixed a real misreading in your file:

- **Cognates must not vote.** `table`, `dialogue`, `important`, `question`,
  `articles`, `culture` are spelled identically in both languages, so they live
  in `NEUTRAL`. With `tables` on the English list, "les tables" came out
  English — the cognate cancelled out `les`.
- **Cited words don't set the sentence's language.** These books quote French
  constantly inside English explanations, so a sentence is scored with its
  quoted spans removed. `Saying "Bonjour": A Golden Rule` is English that
  contains one French word, and now reads that way.
- **`-ing` / `-ly` endings count as English.** English's most useful marker,
  `a`, is also the French verb `a` (*il a*) and therefore has to be ignored as
  ambiguous — which leaves plenty of ordinary English fragments with no
  function word at all to vote for them.
- **Accent position matters.** A word that merely *begins* with an accented
  capital is usually a name or loan-word in English text (`Élise`), so its
  accent isn't evidence. An accent anywhere else is French (`Première`,
  `Réponses`).
- **Citations get split out.** These books constantly cite one language inside
  a sentence of the other, and three patterns now become their own fragments:
  a slash-joined cluster with no spaces (`le/la/les`, `je/tu/il/ils`), an
  English-style colon (`Exception: … take -s: le festival les festivals`), and
  a quote inside parentheses (`Mini response (to "Qu'est-ce qui…?")`) — the
  last because the parentheses used to swallow the quoted French whole. A
  colon with a space *before* it is French typography and is deliberately not
  split, since splitting there would destroy the signal below.
- **French punctuation spacing is a signal.** French puts a space before
  `! ? ; :` and inside `« »`; English never does. Across all 18,500 segments
  this appears in 1,262 unmistakably French ones and exactly 1 English one —
  and that one is a French imperative quoted inside an English sentence. It
  rescues short fragments with no other evidence at all: `Sachons !`,
  `Allons-y !`, `Culture : …`.

For a phrase that genuinely cannot be judged from its own words, add an entry
to `LANG_OVERRIDES`:

```js
const LANG_OVERRIDES = [
  [ /^Tu vs Vous$/i, 'fr' ],
];
```

## Reader controls

Everything from `index.html` carries over: two voice slots with the three
selection strategies each, separate FR/EN words-per-minute, theme, colour
presets, text size, highlight modes, repeat, hide-controls, chapter prev/next,
lock-screen and headphone media keys, wake lock, background keep-alive audio,
and double-tap zones (right = next, left = previous, middle = replay).

New or changed:

- **Read French / Read English** toggles skip every fragment of that language.
  This is the nearest thing to the other apps' single-language modes: the text
  on screen never changes, only what is spoken. With English off, a mixed
  paragraph reads as just its French.
- **Language-change pause** (setup screen, default 180 ms) inserts a short
  silence *only* where a paragraph actually switches language, so the two don't
  run together. Consecutive same-language sentences still run on as prose.
  Set it to 0 for none.
- **Tint** colours the French fragments, making the code-switching visible at a
  glance. Off by default, since the premise here is showing the text as written.
- **Chapters run on automatically.** When the last block of a chapter ends,
  the next one loads and keeps reading — no gap, no tap. The whole book is
  already decrypted in memory after the first chapter opens, so switching is
  just picking a different entry: no fetch, no re-derivation of the key, no
  audible pause. Reading stops only at the end of the book. The
  **Auto‑chapter** pill turns it off if you'd rather a chapter end the session.
- **A one-second flash names the new chapter.** It's an overlay
  (`position:absolute`, `pointer-events:none`), so it can't reflow the text or
  swallow a tap — it just paints briefly over the top edge and fades. It lives
  outside the control bar on purpose, so it still appears in the
  hide-all-controls view, which is exactly when you're listening hands-free and
  can't otherwise tell the chapter turned over. Prev/Next chapter flash it too,
  and those buttons now carry playback with them instead of going silent.
- **Pause/resume replays the current segment.** In the parallel-text app a
  block was two long utterances, so pausing needed character-offset slicing and
  `onboundary` tracking. A segment here is at most one sentence, so pausing
  costs at most a repeated sentence and needs nothing from the engine — which
  is why it behaves the same on Android as on iOS.
- The readout shows the block's language mix (`4 fr + 3 en`), and says so when
  a language is muted — otherwise the text looks unchanged while half of it has
  gone silent.

## Exercise mode

With the **Exercise** pill on, reading stops at each exercise question, takes a
typed attempt, then shows and reads out the answer **the book itself gives**.
The rest of the book reads exactly as before; only exercise questions
interrupt. The answer-key sections still read normally too, as their own
chapters.

The flow: the question is read in the normal flow with its normal voices →
playback parks and the panel opens with a text box → **Check** (or Enter) →
your answer and the book's answer appear side by side and the book's is read
aloud → **Next** carries on to the following question. **Skip** moves on
without answering; **Exit exercise mode** returns to plain reading at once.
Shift+Enter puts a newline in the box, for the longer writing tasks.

**Nothing is graded.** The two answers are put side by side and you judge.
Marking free-form French right or wrong would be guesswork dressed up as
authority, and these answer keys routinely print several acceptable forms
separated by "/". The only thing the panel asserts is when your text is
*identical* to the book's.

### How questions find their answers

Questions and answers are never next to each other — questions sit in an
exercise section, answers in a separate key that this builder has already
turned into a different chapter. They are matched at build time on an explicit
key that both sides carry, and **only when exactly one candidate fits**.
Ambiguity is treated as failure, because a confidently wrong answer is far
worse than no answer. An early version of this pass paired a
vocabulary-matching exercise with the answers to a true/false comprehension
quiz — every answer plausible, every answer wrong.

Your books use three schemes, all supported:

| Scheme | Questions | Answers |
|---|---|---|
| Ordinal | `### Drill 2: Translation Sprint` / `### Exercice 1 : Complétez…` | `### Drill 2 Answers` / `**Exercice 1 :**` |
| Letter + section | `## Exercices de vocabulaire` → `### A. Associez les mots…` | `## Les réponses` → `### Vocabulaire A — Associez` |
| Neither (adjacency) | `## 📝 Mini TEF Practice Test` → `**1.** Quel temps…` | `## 📋 Answer Key & Explanations` → `| 1 | B | … |` |

Matching never crosses a `#` boundary — every chapter of every one of these
books has an "Exercice 1". For the un-keyed third scheme the bar is higher:
the group must announce itself as an exercise, the key must be the nearest
un-keyed one after it, every question number must be covered, and numbers are
claimed exclusively (a practice test numbers straight through its parts, so
Part A takes 1–3 and Part B takes 4–6; a later "Part D" numbered 1–5 of its
own therefore can't help itself to that table).

Where no answer can be matched, the question is still asked and your attempt
still recorded — the panel just says the book doesn't print one.

**Check the pairing before trusting it.** `--report` also writes
`exercises-report.txt`: every question the reader will ask, the answer it will
read, and which rule and which answer group it came from.

### Results on your nine books

595 exercise sets, 3,820 questions, all but 4 with an answer from the book.
322 sets matched by ordinal, 180 by letter, 93 by adjacency. A further ~750
questions were found but left unmatched rather than guessed. An automated
conflict check — two exercises drawing on the same answer group with
overlapping numbers, where at most one can be right — reports **0 conflicts**.

## Notes on the other book formats

The nine books in this set use three different shapes, and all of them work,
but a few behaviours are worth knowing about:

- **ASCII flowcharts and family trees** (the TEF grammar books) are detected
  by their box-drawing characters and rendered as preformatted monospace, not
  reflowed as prose. Their frame characters are excluded from speech, so what
  gets read is the text inside the boxes — "Is it the SUBJECT of the relative
  clause? YES NO QUI". Note the source files have already lost their internal
  column alignment, so the diagrams can't be restored to their original shape;
  monospace just stops them collapsing further.
- **Part dividers** (`# Appendices`, `# Introduction`) become one-block
  chapters showing just their heading. With auto-chapter on they flow past in
  a couple of seconds. Previously they were dropped, which is how a real bug
  hid: `# Appendices` / `---` / `# Appendix A: …` was mistaken for a bilingual
  heading pair, and "Appendix A" was merged into a title that then got
  discarded.
- **English-primary books** (the TEF series declares `language.primary: en`)
  need no special handling — the tagger works from the text, not the
  frontmatter — but they naturally come out majority-English (book 1 is 5,609
  FR / 8,393 EN) where the graded readers are the reverse (12,848 FR / 3,277
  EN).
- **Literal `•` bullets**, which some of these books use instead of markdown,
  are shown exactly as typed and excluded from speech, the same as markdown
  bullets.

### Where it still gets things wrong

English sentences that name French grammar terms or book titles are read
entirely in English: `Grammar: Être, avoir, aller, faire, present tense` and
`How Le Café des Langues Supports French Proficiency Exams`. That's right for
the English words and wrong only for the embedded French names. Splitting
those would need to know that "Être" is being *named* rather than *used*,
which the current approach can't tell. About 75 segments in 150,000.

## What was verified

- **Display fidelity: 100%.** All 6,102 displayed lines across all 112 chapters
  match a source line character for character (after markdown markers are
  removed). All 266 tables and 2,118 rows are preserved, including a blank
  answer grid in Exercise 7 that renders as empty cells and contributes no
  speech.
- **Data integrity: 100%.** Across all 3,564 blocks, every `data-seg` span has
  a matching `segs` entry and vice versa, and every segment has a valid
  language. Largest block: 72 segments.
- **Tagging:** zero English sentences tagged French, and only three English
  segments still contain French words (all genuinely English sentences citing
  French book titles). Adding the generated lexicon moved 195 segments to
  French — the number tables, plus words like `jambon`, `raconter`, `attend` —
  and 61 to English, every one of which genuinely reads as English (`Emma
  nodded.`, `Henri's jaw tightened.`, `Give me a knife.`). Each of those 256
  changes was reviewed individually against the previous build.
- **Classifier and structure** (`node test_lexicon.js`, 116 checks, all
  passing): French numbers, cognate traps in both directions, orthographic
  signals, mixed narrative, headings, vocabulary tables, word-list hygiene,
  citation splitting, speech cleanup, bilingual heading pairs, part dividers,
  art blocks, and span/segment alignment.
- **Exercise mode** (`node test_exercise.js`, 26 checks, all passing): reads
  the question, stops, refuses to reveal the answer early, ignores Space while
  you type, shows typed vs book answer, reads the book's answer aloud,
  advances on Next, Skip works without an answer, and switching the mode off
  mid-exercise returns to ordinary reading.
- **Nine books, three formats** (`node tools/verify_build.js`): the five
  Langue Café / graded readers and the four TEF grammar books all build with
  **0 integrity problems and 100% display fidelity** (49,461 displayed lines),
  and **nothing from any source file is missing from the output** — every
  paragraph, table row, list item and heading is accounted for. Across all
  150,625 segments the audit finds 2 segments tagged French that read as
  English (0.001%) and 75 tagged English that contain French (0.050%).
- **Continuous playback** (`node test_autochapter.js`, 15 assertions, all
  passing): confirms audio carries across a chapter boundary without stopping,
  the chapter dropdown follows along, the flash appears with the right title
  and clears itself after about a second, it still shows with all controls
  hidden, it can't affect the text underneath, and the Auto‑chapter toggle
  stops playback at the chapter end when switched off.
- **Playback** (`node test_reader.js`, 12 assertions, all passing): loads the
  real encrypted data, decrypts, renders, and plays. Confirms segments are
  spoken in the rendered order with matching languages; FR and EN get
  different, consistent rates; speeds adjust independently; muting a language
  silences it without altering the display; and pause/resume resumes the
  interrupted segment instead of restarting the block. A 29-segment block with
  5 language switches reads correctly end to end.

## Two decisions to confirm

1. **English blockquote translations are kept.** I read "no translations" as
   "no *pairing* feature", so the file is shown as-is and
   `> In France, saying "bonjour" is extremely important.` becomes its own
   block, read in English with the French quote still in French. If you'd
   rather omit blockquotes entirely, that's a small change — a flag that skips
   them at build time.
2. **Pronunciation columns are displayed but not spoken** (`--keep-pronunciation`
   to reverse).

Also worth noting: consecutive duplicate headings like
`# Chapitre 1 : L'Arrivée` / `# Chapter 1: The Arrival` are **merged** into one
chapter titled `Chapitre 1 : L'Arrivée / Chapter 1: The Arrival`. Your other two
builders drop the first as an empty chapter, which is why their chapter pickers
show only the English half of this book.
