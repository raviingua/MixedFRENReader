/* build_books_mixed.js — turn CODE-SWITCHED (mixed French/English) Markdown
 * books into a lazy-loaded, password-protected library for the mixed-language
 * book reader (index_mixed.html).
 *
 * This is the third builder in the family:
 *
 *   build_books.js              FR/EN *parallel* text. Every French paragraph
 *                               is followed by its English translation in a
 *                               blockquote; the reader pairs them and shows
 *                               French above English.
 *   build_books_monolingual.js  French only. One language, read straight
 *                               through.
 *   build_books_mixed.js  (this)  Source where BOTH languages are interleaved
 *                               *inside* the same paragraph, sentence, table
 *                               row or dialogue line, with no pairing to
 *                               recover. Nothing is dropped and nothing is
 *                               paired: the book is shown exactly as written,
 *                               one paragraph per reading block, and every
 *                               fragment is TAGGED with the language it is in
 *                               so the reader can speak each one with the
 *                               right voice and the right speed.
 *
 * Usage:
 *   node build_books_mixed.js [srcDir] [outDir] [dataDirName]
 *     srcDir      : folder of *.md books        (default ./books-src)
 *     outDir      : where the site lives        (default ./site)
 *     dataDirName : subfolder written under outDir, and the folder
 *                   index_mixed.html fetches from (default "data-mixed").
 *                   It deliberately differs from the other two builders'
 *                   "data" so all three apps can share one outDir without
 *                   wiping each other's library (the data folder is
 *                   cleared on every build).
 *
 *   Flags (anywhere on the command line):
 *     --report            also write <dataDir>/segments-report.txt — every
 *                         block, every segment and the language chosen for
 *                         it. This is the tuning aid: skim it, find anything
 *                         mis-tagged, and fix it with the word lists or
 *                         LANG_OVERRIDES below.
 *     --default-lang=en   language used for a fragment that carries no
 *                         evidence either way AND has no tagged neighbour
 *                         to inherit from (default: en).
 *     --no-title-block    don't emit the chapter's own heading as the first
 *                         reading block (by default it is emitted, so the
 *                         chapter opens by showing/reading its title).
 *     --keep-pronunciation  read "Pronunciation Guide" table columns aloud.
 *                         By default those columns are displayed but NOT
 *                         spoken — respellings like "(bohn-ZHOOR)" are
 *                         noise in any voice.
 *
 * Output:
 *   outDir/<dataDir>/manifest.json     (book list + chapter titles + key params)
 *   outDir/<dataDir>/<book-id>.enc     (that book's chapters, AES-256-GCM)
 *
 * ---------------------------------------------------------------------------
 * SOURCE FORMAT
 * ---------------------------------------------------------------------------
 * Ordinary Markdown, of the shape these bilingual course books actually use.
 * Optional YAML frontmatter (only `title:` is read; a bilingual
 * "Le Café des Langues … / The Language Café …" title is kept WHOLE, since
 * this app is bilingual by nature and has no reason to pick a side).
 *
 *   - "# " / "## " headings are CHAPTER breaks. These books print the same
 *     heading twice, once per language, on consecutive lines:
 *         # Chapitre 1 : L'Arrivée
 *         # Chapter 1: The Arrival
 *     and also inside a blockquote for the English one:
 *         ## 📚 Grammaire : Les Salutations
 *         > ## 📚 Grammar Spotlight: Greetings
 *     Consecutive chapter headings with no content between them are MERGED
 *     into one chapter titled "French / English" rather than creating an
 *     empty chapter that gets dropped (which is what happens with the other
 *     two builders, and is why their chapter pickers show only the English
 *     half of these books).
 *     As in build_books_monolingual.js, a chapter made from a "##" heading is
 *     prefixed with the most recent "#" heading, because "## 📝 Vocabulaire
 *     du Chapitre" repeats verbatim in every chapter and would otherwise be
 *     ambiguous in a flat picker.
 *   - "###"…"######" do NOT break chapters; they become in-place HEADING
 *     blocks, and consecutive ones are likewise merged into one two-language
 *     block ("### Dialogue 1 : À l'aéroport" + "> ### Dialogue 1: At the
 *     Airport" = one block, French line read in French, English line in
 *     English).
 *   - A run of lines starting with "|" is a TABLE. Cells are tagged
 *     individually, so "| Bonjour | Hello / Good day | (bohn-ZHOOR) |" reads
 *     the first cell in French and the second in English. Speech goes row by
 *     row, skipping empty cells and the "| --- |" separator row.
 *   - BLOCKQUOTES are not treated as translations here (there is nothing to
 *     pair them with). The ">" is stripped and the content becomes an
 *     ordinary block, flagged `quote:true` so the reader can indent it. A
 *     bare ">" line splits one blockquote into several blocks, as in Markdown.
 *   - "---" / "***" horizontal rules are dropped (they carry no text, and an
 *     empty reading block is just dead air).
 *   - Everything else is a PARAGRAPH: a run of consecutive non-blank lines,
 *     ended by a blank line. **bold** and *italic* become <strong>/<em>;
 *     single line breaks become <br>. "_" is NOT treated as italic markup,
 *     because in these books runs of underscores are fill-in-the-blank
 *     answer slots ("Je _______ américaine.").
 *
 * ---------------------------------------------------------------------------
 * HOW THE LANGUAGE TAGGING WORKS  (the whole point of this builder)
 * ---------------------------------------------------------------------------
 * The other two builders never needed this: their source keeps the languages
 * in separate blocks, so "which language is this" is answered by position.
 * Here a single line can look like
 *
 *     The driver shrugged. **"Un peu."** *A little.* **"Où allez-vous?"**
 *
 * so position tells us nothing. Each line is therefore broken down, tagged,
 * and put back together again:
 *
 *   1. SPLIT, aggressively, at every place a language change could plausibly
 *      occur: bold/italic span edges, sentence ends, " / " and " — "
 *      separators, and parenthesised asides. Separators and punctuation are
 *      kept as their own untagged fragments so nothing is lost.
 *   2. TAG each fragment "fr", "en", or "none" by counting FUNCTION words
 *      (see classify) — the strongest, shortest-text language signal there
 *      is — plus French elisions (l', j', qu') and lowercase accented
 *      letters. Content-word lists cover the rest. "none" means genuinely no
 *      evidence: "Emma,", "1998", "(bohn-ZHOOR)".
 *   3. MERGE neighbouring fragments back together while they agree, so a
 *      plain English paragraph ends up as a handful of whole sentences and
 *      not a stutter of word-sized utterances. Untagged fragments are
 *      absorbed by whatever they sit next to. Merging deliberately STOPS at
 *      sentence ends and line breaks, so a segment is at most one sentence:
 *      that is what makes sentence-level highlighting, and pause/resume,
 *      work in the reader.
 *   4. Any segment still untagged inherits from its nearest tagged
 *      neighbour, and failing that uses --default-lang.
 *
 * Nothing here is language *detection* in the statistical sense, and it does
 * not need to be: the two languages in play are known, the vocabulary is
 * beginner-level, and short French fragments are unusually easy to spot
 * (accents, elisions, "je/le/les/vous/est"). Expect it to be right on
 * ordinary prose and dialogue; expect to tune the lists for headings and
 * table columns, which are short and context-free. Run with --report and fix
 * what you see — either by adding words to the lists or, for a phrase that
 * simply cannot be judged from its own words, by adding a LANG_OVERRIDES
 * entry.
 *
 * The tag lands on the DATA, not on the reader: each block ships as
 *   { type, html, segs:[ {lang:'fr'|'en', text:'…'}, … ] }
 * where html already contains one <span class="ttsSeg" data-seg="i"
 * data-lang="fr"> per segment. The reader speaks segs[i].text with the voice
 * and speed for segs[i].lang and highlights the matching span — it makes no
 * language decisions of its own.
 *
 * ---------------------------------------------------------------------------
 * ENCRYPTION
 * ---------------------------------------------------------------------------
 * Unchanged from the other two builders: AES-256-GCM, key derived from a
 * passphrase via PBKDF2-SHA-256, so the public repo holds only ciphertext.
 * The reader asks for the passphrase once and decrypts in the browser.
 *   (PowerShell)  $env:BOOK_PASSPHRASE="your secret"; node build_books_mixed.js .\books-src\ .
 * Book and chapter TITLES stay in clear so the picker works before you type
 * it. Use the SAME passphrase in the reader.
 *
 * No external dependencies — only Node's built-in fs/path/crypto/readline.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================== options ==============================

const argv = process.argv.slice(2);
const flags = argv.filter(a => a.startsWith('--'));
const positional = argv.filter(a => !a.startsWith('--'));

function flagValue(name, dflt){
  const hit = flags.find(f => f === '--'+name || f.startsWith('--'+name+'='));
  if(!hit) return dflt;
  const eq = hit.indexOf('=');
  return eq < 0 ? true : hit.slice(eq+1);
}
const SRC  = positional[0] || path.join(__dirname, 'books-src');
const OUT  = positional[1] || path.join(__dirname, 'site');
const DATA_NAME = positional[2] || 'data-mixed';
const DATA = path.join(OUT, DATA_NAME);

const WANT_REPORT        = !!flagValue('report', false);
const DEFAULT_LANG       = (flagValue('default-lang', 'en') === 'fr') ? 'fr' : 'en';
const EMIT_TITLE_BLOCK   = !flagValue('no-title-block', false);
const SPEAK_PRONUNCIATION= !!flagValue('keep-pronunciation', false);

// ============================== encryption ==============================

const PBKDF2_ITER = 250000;
function encryptJSON(obj, key){
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([ c.update(Buffer.from(JSON.stringify(obj),'utf8')), c.final() ]);
  const tag = c.getAuthTag();
  // browsers' SubtleCrypto expect the 16-byte GCM tag appended to the ciphertext
  return { v:1, iv: iv.toString('base64'), ct: Buffer.concat([ct, tag]).toString('base64') };
}
function getPassphrase(){
  if(process.env.BOOK_PASSPHRASE) return Promise.resolve(process.env.BOOK_PASSPHRASE);
  return new Promise(res => {
    const rl = require('readline').createInterface({ input:process.stdin, output:process.stdout });
    process.stdout.write('Passphrase to encrypt the books (you type this in the reader to decrypt): ');
    rl._writeToOutput = () => {};                 // hide typed characters
    rl.question('', ans => { rl.close(); process.stdout.write('\n'); res(ans); });
  });
}

// ==================== language identification ====================
//
// Function words first: they are the highest-signal, lowest-effort way to
// tell these two languages apart, and they work on fragments far too short
// for anything statistical ("un peu" -> fr, "a little" -> en).

const FR_FUNCTION = new Set([
  // pronouns
  'je','tu','il','elle','nous','vous','ils','elles','te','se','me',
  'moi','toi','lui','leur','leurs','y','en','ce','cela','ça',
  // articles / determiners
  'le','la','les','un','une','des','du','cet','cette','ces',
  'mon','ma','mes','ton','ta','tes','sa','ses','notre','nos','votre','vos',
  'quel','quelle','quels','quelles','tout','toute','tous','toutes','chaque',
  // prepositions / conjunctions
  'de','à','au','aux','dans','sur','sous','avec','sans','pour','par','chez',
  'vers','entre','depuis','pendant','selon','contre','avant','après','sauf',
  'et','ou','mais','donc','ni','puis','alors','parce','car','comme','lorsque',
  'que','qui','quoi','dont','où','quand','comment','pourquoi','combien',
  'si','ne','pas','moins','très','trop','aussi','encore','jamais',
  'toujours','ici','là','oui','non','bien','peu','beaucoup','rien','tout',
  // être / avoir / aller / faire and other high-frequency verbs
  'est','sont','suis','es','êtes','sommes','être','était','étaient','sera',
  'ai','avons','avez','ont','avoir','avait','avaient','aura',
  'vais','vas','va','allons','allez','vont','aller','allait',
  'fais','fait','faites','faisons','font','faire','faisait',
  'veux','veut','voulez','voulons','veulent','vouloir',
  'peux','peut','pouvez','pouvons','peuvent','pouvoir',
  'dois','doit','devez','devons','doivent','devoir',
  'sais','sait','savez','savons','savent','savoir',
  'dit','dis','dites','disons','disent','dire',
  'utilisez','utilise','utilisent','choisissez','complétez','écrivez',
  'mettez','traduisez','répondez','décidez','décrivez','placez','accordez',
  'conjuguez','identifiez','transformez','lisez','regardez',
]);

const EN_FUNCTION = new Set([
  'the','an','this','that','these','those','is','are','was','were','be',
  'been','being','am','to','of','and','in','at','for','with','from','by',
  'but','so','or','nor','not','no','yes',
  'you','he','she','they','we','it','i','him','her','them','us',
  'his','their','my','your','our','its','mine','yours','hers','theirs',
  'have','has','had','do','does','did','will','would','can','could','should',
  'shall','may','might','must','going','get','got','make','makes','made',
  'what','which','who','whom','whose','when','where','why','how',
  'about','into','onto','than','then','there','here','very','too','also',
  'if','because','while','during','between','against','without','through',
  'over','under','after','before','again','once','all','both','each','every',
  'some','any','most','more','much','many','few','little','other','another',
  'own','same','such','only','just','even','still','yet','out','up','down',
  'now','always','never','often','sometimes','usually','well','back',
]);

// French content words that settle a fragment on their own, with no French
// function word present. Deliberately weighted toward what these course
// books actually put in headings, table cells and one-word utterances.
const FR_LEXICON = new Set([
  'bonjour','bonsoir','bonne','bon','nuit','journée','matin','soir','jour',
  'salut','merci','voilà','voici','pardon','excusez','enchanté','enchantée',
  'bienvenue','accord','demain','hier','aujourd','maintenant','ensuite',
  'français','française','françaises','anglais','anglaise','langue','langues',
  'livre','livres','lettre','lettres','histoire','chapitre','chapitres',
  'partie','parties','leçon','leçons','exemple','exemples','règle','règles',
  'niveau','niveaux','voisin','voisine','voisins','mère','père','grand',
  'grande','petit','petite','ami','amie','amis','famille','fille','fils',
  'femme','homme','gens','personne','personnes','enfant','enfants',
  'présenter','présente','présentations','appelle','appelez','appelles',
  'salutations','salutation','pronom','pronoms','verbe','verbes','nom','noms',
  'adjectif','adjectifs','conjugaison','singulier',
  'pluriel','masculin','féminin','nombre','nombres','accord',
  'vouvoyer','tutoyer','politesse','exercice','exercices',
  'réponse','réponses','corrigé','vocabulaire','grammaire',
  'astuce','mémorisation','remarque','importants',
  'importante','importantes','autres','mots',
  'fatigué','fatiguée','gentil','gentille','beau','belle','joli','jolie',
  'thé','pain','eau','chaise','tasse',
  'prochain','prochaine','suivant','suivante','début','fin','travail',
  'formel','formelle','informel','informelle','poli','polie',
  'métier','métiers','profession','professions','nationalité','nationalités',
  'mot','forme','formes',
  'utilisation','utilisations','sens','titre',
  'apprendre','apprenez','appris','parler','parlez','comprendre','écouter',
  'être','avoir','aller','faire','venir','prendre','mettre','partir',
  'premier','première','deuxième','troisième','dernier','dernière',
  'rencontre','rencontrer','aide','comptoir','magasin','marché','boulangerie',
  'jeudi','vendredi','samedi','dimanche','lundi','mardi','mercredi',
  'semaine','mois','année','heure','heures','minute','minutes',
  'chose','choses','fois','moyen','façon','manière','endroit','monde',
  'droite','gauche','devant','derrière','dessus','dessous','loin','près',
]);

// English content words in the same spirit: what shows up in this book's
// English headings, glosses and table columns.
const EN_LEXICON = new Set([
  'hello','goodbye','good','evening','morning','night','day','thanks','thank',
  'please','welcome','sorry','excuse','name','little','tired','neighbor',
  'neighbour','grandmother','grandfather','tomorrow','yesterday','today',
  'greeting','greetings','introduction','introductions','pronoun','pronouns',
  'verb','verbs','noun','nouns','adjective','adjectives',
  'number','numbers','gender','singular','plural','masculine','feminine',
  'formal','informal','polite','politeness','usage','use','used','using',
  'meaning','means','meant','example','examples','exercise','exercises',
  'answer','answers','key','vocabulary','grammar','summary','story',
  'cultural','practice','review','preview','next','coming','first',
  'second','third','fourth','person','people','family','friend','friends',
  'mother','father','daughter','woman','man','child','children',
  'chapter','chapters','part','book','books','level','levels','lesson',
  'lessons','page','pages','word','words','sentence',
  'sentences','tips','memory',
  'spotlight','sidebar','box','list','lists','guide',
  'pronunciation','learn','learned','learning','learner','learners','speak',
  'speaking','spoken','say','says','said','said','write','writing','written',
  'read','reading','listen','listening','understand','understanding',
  'english','french','spanish','german','american','british','canadian',
  'beginner','beginners','complete','completely','difference',
  'differences','between','choose','choosing','correct','correctly','wrong',
  'translate','translation','complete','fill','blank','blanks','order',
  'describe','identify','transform','conjugate','match',
  'work','works','working','job','jobs','city','town','house',
  'home','coffee','shop','market','airport','train','bus','station',
  // food words the frequency generator declines because their French
  // zipf is inflated by proper nouns and abbreviations ('ham', 'lamb')
  'ham','pork','beef','lamb','onion','garlic','cabbage','pear','peach',
  'plum','grape','grapes','carrot','sausage','strawberry','apple',
  'focus','rule','rules','golden',
  'insight','glance','series','edition','coverage','target','range','score',
  'skill','skills','program','minimum','typical','primary','when','whenever',
  'one','two','three','four','five','seven','eight','nine','ten',
  'zero','hundred','thousand','half','whole','full','empty','new','old',
  'goal','goals','step','steps','stage','stages','start','starting','end',
  'ending','ready','done','next','previous','above','below','left','right',
  'true','false','same','different','similar','common','rare',
  'easy','hard','difficult','clear','unclear','helps','help',
  'helping','helpful','choice',
  'choices','relationship','shows','show',
]);

// Words that are NOT evidence, and would be actively misleading if counted:
// loan-words, honorifics, proper names — and, most importantly, the many
// French/English pairs spelled identically ("dialogue", "table", "important",
// "question", "articles", "culture"). A cognate in either lexicon casts a
// vote it has no business casting: "les tables" came out English purely
// because "tables" was on the English list, cancelling out "les".
const NEUTRAL = new Set([
  // identical in both languages — never evidence for either side
  // ambiguous across the two languages — spelled the same, or common in
  // both ('on', 'son', 'as', 'a', 'six', 'plus', 'village')
  'on','son','as','a','six','plus','village',
  'article','articles','table','tables','question','questions','phrase',
  'phrases','expression','expressions','culture','cultures','dialogue',
  'dialogues','important','note','notes','moment','moments','situation',
  'situations','genre','genres','possible','simple','respect','age','image',
  'nation','national','social','animal','animals','capital','festival',
  'attention','exception','exceptions','plus','regions','region','service',
  'services','conversation','conversations','conversation','information',
  'construction','position','positions','description','descriptions',
  'transformation','communication',
  'café','cafés','cafe','cafes','croissant','croissants','baguette','menu',
  'fiancé','fiancée','résumé','cliché','déjà','vu','naïve','naive','crêpe',
  'crêpes','crepe','crepes','crème','creme','pâté','purée','soufflé','éclair',
  'éclairs','brûlée','flambé','sauté','entrée','entrées','saké','madame',
  'monsieur','mademoiselle','mesdames','messieurs','bravo',
  'emma','marcel','sophie','élise','lucas','henri','martin','dubois',
  'france','paris','tours','saint','véran','loire','portland','oregon',
  'québec','quebec','delf','tef','tcf','clb','tgv','a1','a2','b1','b2','c1',
  'ok','okay','um','uh','oh','ah','eh','mm','hmm',
]);

// Last resort for a phrase that simply cannot be judged from its own words.
// Tested against the fragment's cleaned text, in order, before scoring; the
// first match wins. Add entries here when --report shows something wrong
// that no word-list change can fix.
const LANG_OVERRIDES = [
  // [ /pattern/i, 'fr' | 'en' ],
  // e.g. [ /^Tu vs Vous$/i, 'fr' ],
];

/* ---------------------------------------------------------------------------
 * GENERATED LEXICON  (lexicon.js, produced by tools/make_lexicon.py)
 * ---------------------------------------------------------------------------
 * The hand-written lists above encode what reading the audit report taught us
 * about THIS book. They can't cover the long tail, though, and that gap
 * caused a real misreading: a table column of "20 vingt / 21 vingt et un /
 * 22 vingt-deux / …" had no French function word in most cells, so almost
 * every cell scored as no-evidence and one stray miscount flipped the whole
 * column to English.
 *
 * Filling that tail by hand is how cognate bugs get in — "six" is French AND
 * English, as are "cent", "sept", "pour", "table", "chat", "main", "plus".
 * So lexicon.js is generated from corpus frequencies instead, keeping a word
 * only when it is at least 100x commoner in one language than the other AND
 * not an everyday word in the other language at all. Cognates fail both tests
 * and are dropped automatically rather than being noticed later.
 *
 * Precedence is deliberate: NEUTRAL wins over everything, the curated lists
 * win over the generated ones, and a generated word that would contradict a
 * curated one is discarded rather than turning that curated word ambiguous.
 * So adding this file can only ever ADD evidence where there was none — it
 * cannot overturn a decision the hand lists were already making.
 *
 * If lexicon.js is missing the build still works, with a warning; it just
 * falls back to the curated lists alone.
 */
let GEN_FR = new Set(), GEN_EN = new Set();
(function loadGeneratedLexicon(){
  let gen;
  try { gen = require(path.join(__dirname,'lexicon.js')); }
  catch(e){
    console.warn('NOTE: lexicon.js not found next to this script — using the built-in word lists only.');
    console.warn('      Regenerate it with:  python3 tools/make_lexicon.py > lexicon.js');
    return;
  }
  const handFr = new Set([...FR_FUNCTION, ...FR_LEXICON]);
  const handEn = new Set([...EN_FUNCTION, ...EN_LEXICON]);
  let droppedFr = 0, droppedEn = 0;
  for(const w of (gen.fr||[])){
    if(NEUTRAL.has(w) || handEn.has(w)){ droppedFr++; continue; }
    GEN_FR.add(w);
  }
  for(const w of (gen.en||[])){
    if(NEUTRAL.has(w) || handFr.has(w)){ droppedEn++; continue; }
    GEN_EN.add(w);
  }
  if(process.env.LEXICON_VERBOSE){
    console.log('lexicon.js: +'+GEN_FR.size+' FR, +'+GEN_EN.size+' EN  ('
      + droppedFr+'/'+droppedEn+' dropped as already curated or neutral)');
  }
})();

// Words sitting on both sides cancel out in score() and are therefore dead
// weight rather than evidence — easy to introduce by editing a list and not
// noticing. Say so at build time instead of letting it go quiet.
(function checkLexiconCollisions(){
  const both = [...FR_FUNCTION, ...FR_LEXICON].filter(w => EN_FUNCTION.has(w) || EN_LEXICON.has(w));
  const neut = [...FR_FUNCTION, ...FR_LEXICON, ...EN_FUNCTION, ...EN_LEXICON].filter(w => NEUTRAL.has(w));
  if(both.length) console.warn('NOTE: '+both.length+' word(s) are in BOTH the French and English lists, so they vote for neither: '+both.slice(0,12).join(', ')+(both.length>12?'…':''));
  if(neut.length) console.warn('NOTE: '+neut.length+' word(s) are in a language list AND in NEUTRAL, so the list entry has no effect: '+neut.slice(0,12).join(', ')+(neut.length>12?'…':''));
})();

const DIACRITIC = /[àâäçéèêëîïôöùûüÿœæ]/i;
// French elision — l'arrivée, j'ai, qu'il, aujourd'hui. A very strong signal,
// and one that survives in fragments too short for anything else to work.
const ELISION = /\b(?:j|l|d|n|m|t|s|c|qu|jusqu|lorsqu|puisqu|quelqu|aujourd)['\u2019][a-zà-ÿœæ]/i;
// French typography puts a space before ! ? ; : and inside « »; English never
// does. This turns out to be one of the most reliable signals in the whole
// book — across all 18,500 segments it appears in 1,262 unmistakably French
// ones and exactly 1 English one (and that one is a French imperative quoted
// inside an English sentence). It rescues short French fragments that carry
// no other evidence at all: "Sachons !", "Allons-y !", "Culture : …".
const FR_PUNCT_SPACE = /\s[!?;:\u00bb]|\u00ab\s/;
const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
// Endings that are English and essentially never French. These matter more
// than they look: English's most useful marker, "a", is also the French verb
// "a" (il a) and therefore has to be ignored as ambiguous, which leaves plenty
// of ordinary English fragments ("Saying hello", "Usually formal") with no
// function word at all to vote for them.
const EN_SUFFIX = /^[a-z]{3,}(?:ing|ly|ness|ful|less)$/;

function tokens(text){
  return (text.replace(/['\u2019]/g,' ').match(WORD_RE) || []);
}

// 'fr' | 'en' | 'none' for one fragment. 'none' is a real answer, not a
// failure: it means "no evidence", and the caller resolves it from context
// rather than guessing here.
// Is this token's spelling itself French evidence?
//   lowercase + accent anywhere      -> French ("français", "écrivez", "été")
//   capitalised + accent inside      -> French ("Première", "Réponses")
//   capitalised + accent ONLY first  -> not evidence: that shape is almost
//                                       always a name or loan-word dropped
//                                       into English text ("Élise", "Été" as
//                                       a title), and counting it made whole
//                                       English sentences come out French.
function accentEvidence(t){
  if(NEUTRAL.has(t.toLowerCase())) return false;
  if(!DIACRITIC.test(t)) return false;
  if(/^[a-zà-ÿœæ]/.test(t)) return true;      // lowercase word -> French
  return DIACRITIC.test(t.slice(1));          // capitalised -> accent must be inside
}

function score(text){
  const toks = tokens(text);
  let fr = 0, en = 0;
  for(const t of toks){
    const lt = t.toLowerCase();
    if(NEUTRAL.has(lt)) continue;
    const isFr = FR_FUNCTION.has(lt) || FR_LEXICON.has(lt) || GEN_FR.has(lt);
    const isEn = EN_FUNCTION.has(lt) || EN_LEXICON.has(lt) || GEN_EN.has(lt) || EN_SUFFIX.test(lt);
    if(isFr && isEn) continue;       // e.g. "a", "on", "sur" — ambiguous, ignore
    if(isFr) fr++;
    if(isEn) en++;
  }
  // Orthographic evidence, independent of vocabulary: elision, accent
  // placement, and French punctuation spacing. Each counts once per fragment,
  // and together they also decide a tie — a fragment that LOOKS French is
  // French even when its words were all unrecognised.
  const hasElision = ELISION.test(text);
  const hasAccent = toks.some(accentEvidence);
  const hasFrPunct = FR_PUNCT_SPACE.test(text);
  const frOrtho = hasElision || hasAccent || hasFrPunct;
  return {
    fr: fr + (hasElision ? 1 : 0) + (hasAccent ? 1 : 0) + (hasFrPunct ? 1 : 0),
    en: en,
    frOrtho: frOrtho
  };
}
// A CITED word is not the language of the sentence citing it. These books
// quote French constantly inside English explanations ('Saying "Bonjour": A
// Golden Rule'), and the quoted word would otherwise outvote the sentence
// around it. So the sentence is scored with its quoted spans removed; only if
// that leaves no evidence at all does the full text get scored instead.
// (Quoted spans are also split out as their own fragments upstream, so the
// cited word still gets read in its own language where the quoting is
// unambiguous — this is only about not letting it hijack its neighbours.)
const QUOTED = /"[^"\n]*"|\u201c[^\u201d\n]*\u201d|\u00ab[^\u00bb\n]*\u00bb/g;
function wordCount(s){ return (s.match(WORD_RE) || []).length; }

function classify(text){
  if(!text || !text.trim()) return 'none';
  for(const [re, lang] of LANG_OVERRIDES){ if(re.test(text.trim())) return lang; }

  const unquoted = text.replace(QUOTED,' ');
  const restWords = wordCount(unquoted);
  const quotedWords = wordCount(text) - restWords;
  // Discount the quotation only when there is a real sentence around it doing
  // the citing. When the quote is most of the fragment — 'Mini response (to
  // "Qu'est-ce qui est important pour réussir dans la vie?")' — the quote IS
  // the content, and scoring the two remaining words instead would hand a long
  // French question to the English voice.
  const citingSentence = restWords >= 2 && restWords >= quotedWords;
  let s = citingSentence ? score(unquoted) : score(text);
  if(s.fr === 0 && s.en === 0) s = score(text);

  if(s.fr === 0 && s.en === 0) return 'none';
  if(s.fr > s.en) return 'fr';
  if(s.en > s.fr) return 'en';
  return s.frOrtho ? 'fr' : 'en';   // tie -> French orthography decides
}

// ============================== text utilities ==============================

function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
// Characters no voice can say usefully. Beyond emoji this has to cover the
// symbol ranges these grammar books actually use: arrows in transformation
// rules ("je -> j'"), the box-drawing and geometric characters of their ASCII
// flowcharts, the clock and triangle markers, and literal bullet glyphs. Left
// in, a flowchart gets read out as "vertical line, down-pointing triangle,
// box drawings light horizontal..." for a couple of minutes.
const SYMBOLS = new RegExp('[' +
  '\\u{1F000}-\\u{1FAFF}' +   // emoji & pictographs
  '\\u{1F1E6}-\\u{1F1FF}' +   // regional indicators (flags)
  '\\u2190-\\u21FF' +         // arrows
  '\\u2300-\\u23FF' +         // misc technical
  '\\u2500-\\u257F' +         // box drawing
  '\\u2580-\\u259F' +         // block elements
  '\\u25A0-\\u25FF' +         // geometric shapes
  '\\u2600-\\u27BF' +         // dingbats
  '\\u2022\\u2023\\u2043\\u00b7' +  // bullet glyphs
  '\\u{FE0F}\\u{20E3}' +      // variation selector, combining keycap
  ']', 'gu');

// What gets handed to the speech engine. The display keeps everything; speech
// drops what no voice can say usefully: the symbols above, and the long runs
// of underscores these books use as fill-in-the-blank slots (an engine either
// says nothing or spells "underscore" eight times) - replaced by an ellipsis,
// which most engines render as a short pause.
function speechText(raw){
  let s = raw.replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,'');
  s = s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  s = s.replace(SYMBOLS,' ');
  s = s.replace(/[_]{2,}/g,' \u2026 ');
  s = s.replace(/\*+/g,'');
  return s.replace(/\s+/g,' ').trim();
}
// Same cleanup, but used for CLASSIFYING rather than speaking, so the scorer
// never sees emoji or markdown leftovers as words.
function scoreText(raw){ return speechText(raw); }

// ============================== fragmenting one line ==============================

// Bold / italic spans. "_" is intentionally absent: in these books "_____"
// is an answer blank, not emphasis, and treating it as italic markup mangles
// every exercise.
const SPAN_RE = /\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*/g;
function splitSpans(line){
  const out = [];
  let pos = 0, m;
  SPAN_RE.lastIndex = 0;
  while((m = SPAN_RE.exec(line))){
    if(m.index > pos) out.push({ kind:'plain', raw: line.slice(pos, m.index) });
    if(m[1] !== undefined) out.push({ kind:'bold', raw: m[1] });
    else out.push({ kind:'italic', raw: m[2] || '' });
    pos = m.index + m[0].length;
  }
  if(pos < line.length) out.push({ kind:'plain', raw: line.slice(pos) });
  return out;
}

// Sentence ends: terminal punctuation plus any closing quote/bracket, and
// French's spaced-out "?" / "!" come along for free since we only look left.
const SENT_END = /[.!?\u2026]+["'\u201d\u2019\u00bb)\]]*(?=\s|$)/g;
function splitSentences(text){
  const out = [];
  let last = 0, m;
  SENT_END.lastIndex = 0;
  while((m = SENT_END.exec(text))){
    const end = m.index + m[0].length;
    out.push({ raw: text.slice(last, end), endsSentence: true });
    last = end;
  }
  if(last < text.length) out.push({ raw: text.slice(last), endsSentence: false });
  return out.filter(p => p.raw !== '');
}

// The places these books switch language mid-line with no other warning:
//   " / "            "### Salutations / Greetings"
//   " — "            "**Book One: L'Héritage** — *You are here*"
//   ": "             "Exception: … take -s: le festival, les festivals"
//                    (English-style only — a colon with a space BEFORE it is
//                    French typography, and splitting there would throw away
//                    that signal: "Introduction :" would lose the very thing
//                    that identifies it as French)
//   (parentheses)    "### Les Salutations (Greetings)"
//   "quoted text"    'Saying "Bonjour": A Golden Rule'
//   le/la/les        "Only 3rd person changes: le/la/les (direct)"
// Split on all of them but KEEP the separator as its own fragment, so the
// line can be reassembled character for character.
//
// Two subtleties, both learned from real misreadings:
//   * The parenthesis pattern deliberately refuses to match a parenthetical
//     containing a quote, so that in 'Mini response (to "Qu'est-ce qui est
//     important…?"):' the quoted French is split out on its own instead of
//     being swallowed whole by the parentheses around it.
//   * A slash-joined cluster with NO spaces ("le/la/les", "je/tu/il/ils",
//     "nous/vous") is how the grammar books cite a set of French forms inside
//     an English sentence. Treating it as one fragment lets it be tagged
//     French on its own merits without dragging the English sentence with it.
//     " / " with spaces stays a plain separator — that's the bilingual
//     heading pattern, a different thing.
const SEP_RE = /(\s+\/\s+|\s*[\u2014\u2013]\s*|(?<=\S):\s+|[\w'\u2019\u00e0-\u00ff-]+(?:\/[\w'\u2019\u00e0-\u00ff-]+)+|\([^()"\u201c\u00ab]*\)|"[^"\n]*"|\u201c[^\u201d\n]*\u201d|\u00ab[^\u00bb\n]*\u00bb)/;
// Pure punctuation separators carry no language of their own; a parenthesised,
// quoted or slash-joined fragment does, and gets classified like any other.
const PURE_SEP = /^(?:\s+\/\s+|\s*[\u2014\u2013]\s*|:\s+)$/;
function splitSeparators(text){
  return text.split(SEP_RE).filter(s => s !== '' && s !== undefined)
             .map(s => ({ raw:s, isSep: PURE_SEP.test(s) }));
}

// One source line -> ordered, tagged, merged segments.
// `seed` is the language to fall back to for a fragment with no evidence and
// no tagged neighbour — normally the language of the previous line, so a
// multi-line dialogue or list doesn't flip voice on its untaggable lines.
function segmentLine(line, seed){
  const pieces = [];
  for(const span of splitSpans(line)){
    for(const sent of splitSentences(span.raw)){
      const subs = splitSeparators(sent.raw);
      subs.forEach((sub, i) => {
        const isLast = (i === subs.length - 1);
        pieces.push({
          kind: span.kind,
          raw: sub.raw,
          // Only the fragment that actually carries the terminal punctuation
          // closes the sentence, so merging stops in the right place.
          endsSentence: isLast && sent.endsSentence,
          lang: sub.isSep ? 'none' : classify(scoreText(sub.raw))
        });
      });
    }
  }

  // Merge while the tags agree and no sentence has ended. An untagged
  // fragment joins whatever it is next to rather than becoming its own
  // one-word utterance.
  const segs = [];
  for(const p of pieces){
    const cur = segs[segs.length - 1];
    const compatible = cur && !cur.closed &&
      (p.lang === 'none' || cur.lang === 'none' || cur.lang === p.lang);
    if(compatible){
      cur.pieces.push(p);
      if(cur.lang === 'none') cur.lang = p.lang;
    } else {
      segs.push({ lang: p.lang, pieces: [p], closed: false });
    }
    if(p.endsSentence) segs[segs.length - 1].closed = true;
  }

  // Anything still untagged takes its nearest tagged neighbour's language.
  for(let i = 0; i < segs.length; i++){
    if(segs[i].lang !== 'none') continue;
    let lang = null;
    for(let j = i - 1; j >= 0 && !lang; j--) if(segs[j].lang !== 'none') lang = segs[j].lang;
    for(let j = i + 1; j < segs.length && !lang; j++) if(segs[j].lang !== 'none') lang = segs[j].lang;
    segs[i].lang = lang || seed || DEFAULT_LANG;
  }

  return segs.map(s => {
    const html = s.pieces.map(p => {
      const esc = escapeHtml(p.raw);
      if(p.kind === 'bold') return '<strong>'+esc+'</strong>';
      if(p.kind === 'italic') return '<em>'+esc+'</em>';
      return esc;
    }).join('');
    return { lang: s.lang, html: html, text: speechText(s.pieces.map(p => p.raw).join('')) };
  }).filter(s => s.html.trim() !== '');
}

// ============================== block assembly ==============================

// Wraps each segment's HTML in the span the reader highlights and speaks
// from. `counter.n` is the running data-seg index within the block, since one
// block can be several lines (or a whole table) of segments.
//
// A fragment left with no speakable text after cleanup — a flowchart's "│",
// a cell holding only "→" — is emitted as bare HTML with no span and no segs
// entry. It is still displayed; it just never becomes something the reader
// tries to speak or highlight, which keeps the segment indices meaning
// "things that get read aloud".
function renderSegs(segs, counter, out){
  return segs.map(s => {
    if(!s.text || !s.text.trim()) return s.html;
    const i = counter.n++;
    out.push({ lang: s.lang, text: s.text });
    return '<span class="ttsSeg" data-seg="'+i+'" data-lang="'+s.lang+'">'+s.html+'</span>';
  }).join('');
}

const BULLET = /^(\s*)([-*+\u2022\u2023\u2043])\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
// The grammar books draw decision flowcharts out of box-drawing characters.
// A run of lines containing any of those is treated as preformatted art: it
// must not be reflowed as prose (proportional font + collapsed whitespace
// turns it into nonsense), and its frame characters must not be read aloud.
// The TEXT inside the boxes is still spoken, line by line, which is the part
// that's actually useful — "Is it the SUBJECT of the relative clause? YES NO".
const BOX_DRAWING = /[\u2500-\u257F]/;

// A paragraph block: several source lines, each kept on its own display line
// (<br>) and each starting a fresh segment, so dialogue lines and list items
// stay individually highlightable and never merge into one another.
function buildParagraphBlock(lines, isQuote){
  const segs = [], counter = { n:0 };
  const htmlLines = [], lineMap = [];
  let seed = null;
  const isArt = lines.some(l => BOX_DRAWING.test(l));
  for(const rawLine of lines){
    let line = rawLine.replace(/\s+$/,'');
    let prefix = '';
    if(!isArt){
      const mb = BULLET.exec(line);
      if(mb){
        // Show the bullet, but don't speak it: a lone "-" is read as "dash"
        // by some engines and as nothing by others, and a literal "•" in the
        // source (which some of these books use instead of markdown) is read
        // as "bullet". Markdown markers are normalised to "•"; a glyph the
        // author typed is shown exactly as they typed it.
        const marker = /[-*+]/.test(mb[2]) ? '\u2022' : mb[2];
        prefix = '<span class="liMark">'+marker+' </span>';
        line = line.slice(mb[0].length);
      } else if(NUMBERED.test(line)){
        // Numbers DO get spoken — "3." is meaningful in an exercise list.
      }
    }
    const lineSegs = segmentLine(line, seed);
    if(!lineSegs.length){
      // A line with nothing speakable — a bare "│" or "▼" in a flowchart —
      // still has to be displayed, or the diagram loses its connectors.
      const shown = escapeHtml(line);
      if(prefix || shown) htmlLines.push(prefix + shown);
      continue;
    }
    seed = lineSegs[lineSegs.length - 1].lang;
    const segFrom = counter.n;
    htmlLines.push(prefix + renderSegs(lineSegs, counter, segs));
    // Remember which segments came from which source line. The exercise pass
    // needs this to point the reader at one question inside a block that
    // holds a whole numbered list, and it is deleted again before output.
    lineMap.push({ raw: line, segFrom: segFrom, segTo: counter.n - 1 });
  }
  if(!segs.length) return null;
  const block = isArt
    ? { type:'art', quote: isQuote || undefined, html: htmlLines.join('\n'), segs: segs }
    : { type:'p',   quote: isQuote || undefined, html: htmlLines.join('<br>'), segs: segs };
  block._lines = lineMap;
  return block;
}

function buildHeadingBlock(lines, level){
  const segs = [], counter = { n:0 };
  let seed = null;
  const htmlLines = lines.map(l => {
    const lineSegs = segmentLine(l.replace(/\s+$/,''), seed);
    if(lineSegs.length) seed = lineSegs[lineSegs.length - 1].lang;
    return renderSegs(lineSegs, counter, segs);
  }).filter(Boolean);
  if(!segs.length) return null;
  return { type:'heading', level: level, html: htmlLines.join('<br>'), segs: segs };
}

// ---- pipe tables ----
function splitTableRow(line){
  const PLACEHOLDER = '\u0000';
  const guarded = line.trim().replace(/\\\|/g, PLACEHOLDER);
  let cells = guarded.split('|').map(c => c.trim().replace(new RegExp(PLACEHOLDER,'g'),'|'));
  if(cells.length && cells[0] === '') cells.shift();
  if(cells.length && cells[cells.length-1] === '') cells.pop();
  return cells;
}
function isSeparatorRow(cells){
  return cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c.trim()) || c.trim() === '');
}
const PRONUNCIATION_HEADER = /pronunciation|prononciation|phonetic|phonétique/i;

// Tables are where per-cell tagging earns its keep: one row routinely holds
// French, English and a phonetic respelling side by side. Each cell is tagged
// on its own; a cell with no evidence of its own falls back to its COLUMN,
// decided by majority vote over that column's confident cells (with the
// header cell as tiebreaker) — which is what makes a column of bare glosses
// like "Hello / Good day", "Good evening" come out English even though no
// single cell contains a function word.
function buildTableBlock(rawLines, isQuote){
  const rows = rawLines.map(splitTableRow).filter(c => c.length);
  if(!rows.length) return null;
  const header = rows[0];
  let body = rows.slice(1);
  if(body.length && isSeparatorRow(body[0])) body = body.slice(1);

  const nCols = rows.reduce((n,r) => Math.max(n, r.length), 0);
  const skipCol = [];
  const colLang = [];
  for(let c = 0; c < nCols; c++){
    skipCol[c] = !SPEAK_PRONUNCIATION && PRONUNCIATION_HEADER.test(header[c] || '');
    const votes = { fr:0, en:0 };
    for(const r of body){
      const g = classify(scoreText(r[c] || ''));
      if(g !== 'none') votes[g]++;
    }
    if(votes.fr > votes.en) colLang[c] = 'fr';
    else if(votes.en > votes.fr) colLang[c] = 'en';
    else {
      const h = classify(scoreText(header[c] || ''));
      colLang[c] = (h === 'none') ? null : h;
    }
  }
  // The header ROW is usually written in one language throughout (these books
  // label columns "Book | Title | Level | Chapters"), so an untaggable header
  // cell follows its row-mates rather than its own column — otherwise "Title"
  // gets read in French just because the column under it is French.
  const hVotes = { fr:0, en:0 };
  header.forEach(h => { const g = classify(scoreText(h || '')); if(g !== 'none') hVotes[g]++; });
  const headerLang = hVotes.fr > hVotes.en ? 'fr' : hVotes.en > hVotes.fr ? 'en' : null;

  const segs = [], counter = { n:0 };
  // A cell renders its segments inside the <th>/<td>; a skipped or untaggable
  // cell renders as plain text with no segment, so it shows but stays silent.
  function cellHtml(text, col, tag){
    if(!text || !text.trim()) return '<'+tag+'></'+tag+'>';
    if(skipCol[col]) return '<'+tag+' class="noSpeak">'+escapeHtml(text)+'</'+tag+'>';
    // A cell whose own words gave no answer inherits its column (body) or its
    // header row (header) — that's what `fallback` is, passed as the seed.
    const fallback = (tag === 'th' ? (headerLang || colLang[col]) : colLang[col]) || DEFAULT_LANG;
    const cellSegs = segmentLine(text, fallback);
    if(!cellSegs.length) return '<'+tag+'>'+escapeHtml(text)+'</'+tag+'>';
    cellSegs.forEach(s => { if(!s.lang || s.lang === 'none') s.lang = fallback; });
    return '<'+tag+'>'+renderSegs(cellSegs, counter, segs)+'</'+tag+'>';
  }
  // Cells are emitted row by row, left to right, so the recorded segment
  // order IS the reading order.
  let html = '<table class="mixTable"><thead><tr>';
  header.forEach((c,i) => { html += cellHtml(c, i, 'th'); });
  html += '</tr></thead><tbody>';
  const rowMap = [];
  body.forEach(r => {
    const segFrom = counter.n;
    html += '<tr>';
    for(let c = 0; c < nCols; c++) html += cellHtml(r[c] || '', c, 'td');
    html += '</tr>';
    rowMap.push({ cells: r.slice(), segFrom: segFrom, segTo: counter.n - 1 });
  });
  html += '</tbody></table>';

  if(!segs.length) return null;
  const block = { type:'table', quote: isQuote || undefined, html: html, segs: segs };
  block._header = header.slice();
  block._rows = rowMap;
  return block;
}

// ============================== book extraction ==============================

function stripFrontmatter(raw){
  if(!/^---\s*\r?\n/.test(raw)) return { fm:'', body:raw };
  const m = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if(!m) return { fm:'', body:raw };
  return { fm:m[1], body:raw.slice(m[0].length) };
}
function rawTitle(fm){
  const m = fm.match(/^title:\s*(.+?)\s*$/m);
  if(!m) return '';
  let t = m[1].trim();
  if((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1,-1);
  return t.trim();
}
// Unlike build_books.js, a bilingual "French / English" title is kept whole —
// this reader shows both languages, so there is no side to pick.
function titleFromFilename(file){
  let t = path.basename(file, path.extname(file));
  t = t.replace(/[_\-]+/g,' ').trim();
  return t || path.basename(file, path.extname(file));
}

const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;

function extractBook(file){
  const raw = fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const { fm, body } = stripFrontmatter(raw);
  const title = rawTitle(fm) || titleFromFilename(file);

  const chapters = [];
  let cur = null;              // current chapter
  let h1 = null;               // most recent "#" heading, prefixed onto "##" chapters
  let paraBuf = [], paraQuote = false;
  let tableBuf = [], tableQuote = false;
  // These two let consecutive headings merge instead of producing an empty
  // chapter (chapter level) or two half-blocks (in-place level).
  let chapterOpenForMerge = false;   // current chapter has a title but no content yet
  let lastHeadingBlock = null;       // in-place heading block that a following heading can join

  function commitPara(){
    if(!paraBuf.length) return;
    const b = buildParagraphBlock(paraBuf, paraQuote);
    if(b && cur){ cur.blocks.push(b); lastHeadingBlock = null; chapterOpenForMerge = false; }
    paraBuf = [];
  }
  function commitTable(){
    if(!tableBuf.length) return;
    const b = buildTableBlock(tableBuf, tableQuote);
    if(b && cur){ cur.blocks.push(b); lastHeadingBlock = null; chapterOpenForMerge = false; }
    tableBuf = [];
  }
  function commitAll(){ commitPara(); commitTable(); }

  function startChapter(text, level){
    // "## Vocabulaire du Chapitre" is identical in every chapter, so it gets
    // the parent "#" heading prefixed to stay distinguishable in the picker.
    const full = (level === 2 && h1) ? (h1 + ' \u2014 ' + text) : text;
    cur = { title: full, own: text, titleLines: [text], level: level,
            h1: (level === 1 ? text : h1), blocks: [] };
    chapters.push(cur);
    chapterOpenForMerge = true;
    lastHeadingBlock = null;
  }

  // These books print each heading twice, once per language, on consecutive
  // lines. Merging those into one chapter is what keeps the picker showing
  // both halves. But "consecutive same-level headings" also describes a part
  // divider followed by its first chapter —
  //     # Appendices
  //     ---
  //     # Appendix A: Exam Preparation Guide
  // — and merging THAT produced a chapter titled "Appendices / Appendix A…"
  // which, having no content of its own, was then dropped, losing the
  // "Appendix A" title entirely. So a merge requires actual evidence of a
  // bilingual pair: the two headings must be in DIFFERENT languages.
  //
  // The comparison uses each heading's LEADING segment rather than the
  // heading as a whole, because a heading routinely cites the other language
  // further along: "## Grammar Spotlight: Abstract Relative Pronouns (ce qui,
  // ce que, ce dont, ce à quoi)" is an English heading whose French
  // parenthetical is longer than its English part, so scoring the whole
  // string called it French and the pair failed to merge. A heading always
  // opens in its own language; the citations come after.
  function headingLang(text){
    const segs = segmentLine(text, null);
    if(segs.length) return segs[0].lang;
    return classify(scoreText(text));
  }
  function isBilingualPair(a, b){
    const la = headingLang(a), lb = headingLang(b);
    return la !== 'none' && lb !== 'none' && la !== lb;
  }

  for(const rawLine of body.split('\n')){
    let line = rawLine;
    let isQuote = false;
    const tq = line.trim();
    if(/^>/.test(tq)){                       // strip one level of "> "
      isQuote = true;
      line = tq.replace(/^>\s?/,'');
    }
    const t = line.trim();

    const mHead = t.match(/^(#{1,6})\s+(.*)$/);
    if(mHead){
      commitAll();
      const level = mHead[1].length;
      const text = mHead[2].replace(/\s+/g,' ').trim();
      if(!text) continue;

      if(level <= 2){
        // A chapter heading arriving while the current chapter is still empty
        // is this book's second-language title for the SAME chapter — but only
        // if it really is in the other language (see isBilingualPair).
        if(cur && chapterOpenForMerge && cur.level === level &&
           isBilingualPair(cur.titleLines[cur.titleLines.length-1], text)){
          cur.titleLines.push(text);
          cur.title += ' / ' + text;
          cur.own += ' / ' + text;
        } else {
          if(level === 1) h1 = text;
          startChapter(text, level);
        }
        if(level === 1 && cur) h1 = cur.own.split(' / ')[0];
      } else {
        if(!cur) startChapter(title, 1);
        // Same merge, one level down: "### Dialogue 1 : À l'aéroport" and
        // "> ### Dialogue 1: At the Airport" become one two-line block. Same
        // bilingual-pair requirement, so two unrelated sub-headings in a row
        // stay two separate blocks.
        if(lastHeadingBlock && lastHeadingBlock.level === level &&
           isBilingualPair(lastHeadingBlock.lines[lastHeadingBlock.lines.length-1], text)){
          const merged = buildHeadingBlock(lastHeadingBlock.lines.concat([text]), level);
          if(merged){
            cur.blocks[cur.blocks.length - 1] = merged;
            lastHeadingBlock.lines.push(text);
          }
        } else {
          const b = buildHeadingBlock([text], level);
          if(b){
            cur.blocks.push(b);
            lastHeadingBlock = { level: level, lines: [text] };
          }
        }
      }
      continue;
    }

    if(t === ''){ commitAll(); continue; }
    if(HR_RE.test(t)){
      // Horizontal rule: no text, so no block — but it IS a section break, so
      // a heading after it is a new section rather than a translation of the
      // heading before it.
      commitAll();
      chapterOpenForMerge = false;
      lastHeadingBlock = null;
      continue;
    }

    if(/^\|/.test(t)){
      if(paraBuf.length) commitPara();            // table starting mid-run of text
      if(tableBuf.length && tableQuote !== isQuote) commitTable();
      tableQuote = isQuote;
      tableBuf.push(t);
    } else {
      if(tableBuf.length) commitTable();          // text resuming right after a table
      if(paraBuf.length && paraQuote !== isQuote) commitPara();
      paraQuote = isQuote;
      paraBuf.push(line);
    }
  }
  commitAll();

  // Emit each chapter's own heading as its opening block, so the chapter
  // starts by showing (and reading, in both languages) its title.
  //
  // This also acts as the safety net that makes a chapter title impossible to
  // lose. A chapter with no content of its own — a part divider like
  // "# Appendices", or the first half of a bilingual pair that wasn't
  // recognised as one — used to be dropped along with its heading text. Now
  // it keeps its title block and survives as a one-block chapter, which in
  // this reader is perfectly sensible: it shows the heading, reads it, and
  // (with auto-chapter on) flows straight into the next one.
  if(EMIT_TITLE_BLOCK){
    for(const c of chapters){
      const b = buildHeadingBlock(c.titleLines, c.level);
      if(b) c.blocks.unshift(b);
    }
  }

  const kept = chapters.filter(c => c.blocks.length > 0);
  return { title, source: path.basename(file), chapters: kept };
}

/* ===========================================================================
 * EXERCISE MODE: pairing questions with the book's own answers
 * ===========================================================================
 * The reader's exercise mode reads a question, waits for the person to type
 * their attempt, then reads out the answer THE BOOK GIVES. That only works if
 * the two can be matched at build time, because they are never next to each
 * other: questions sit in an exercise section and answers in a separate
 * answer-key section, which this builder has already turned into a different
 * chapter.
 *
 * The governing principle is that a confidently WRONG answer is much worse
 * than no answer. An early version of this pass paired a vocabulary-matching
 * exercise with the answers to a true/false comprehension quiz — every answer
 * plausible, every answer wrong. So a pairing is only made on an explicit key
 * that both sides carry, and only when exactly one candidate fits. Anything
 * else is left unmatched and the reader says so.
 *
 * These books use three keying schemes:
 *
 *   1. AN ORDINAL on both sides (the TEF drills, the Café des Langues keys):
 *        ### Drill 2: Translation Sprint      ### Drill 2 Answers
 *        ### Exercice 1 : Complétez…          **Exercice 1 :**
 *      The answer label may be a bold paragraph line rather than a heading,
 *      and it sits in the SAME block as the answers it introduces, so labels
 *      are recognised mid-block.
 *
 *   2. A LETTER plus a section name (the graded readers):
 *        ## Exercices de vocabulaire          ## Les réponses
 *        ### A. Associez les mots…            ### Vocabulaire A - Associez
 *        ### B. Complétez les phrases…        ### Vocabulaire B - Complétez
 *      The letter comes from the question heading and the section name from
 *      the question's CHAPTER, matched against the answer heading's two parts.
 *
 *   3. NEITHER, for a test numbered straight through (Mini TEF practice
 *      tests):
 *        ## 📝 Mini TEF Practice Test         ## 📋 Answer Key & Explanations
 *        **1.** Quel temps fera-t-il lundi ?  | 1 | B | "Lundi, il pleuvra…" |
 *      Here the only evidence is adjacency, so the bar is higher: the
 *      question group must announce itself as an exercise, the answer group
 *      must be the nearest un-keyed one after it, and EVERY question number
 *      must appear in it.
 *
 * Matching never crosses a "#" boundary. Every chapter of every one of these
 * books has an "Exercice 1"; without that scope Chapter 1's questions would
 * cheerfully pair with Chapter 9's answers.
 */

// A heading or label that introduces answers. Always tested FIRST, because
// "Drill 2 Answers" and "🔑 Réponses aux exercices" match both patterns.
const ANS_HEADING = /\b(answers?|answer\s*keys?|r[ée]ponses?|corrig[ée]s?|solutions?|mod[èe]les?)\b/i;
// A heading that announces questions. Deliberately narrow: bare "practice",
// "part" and "test" are not enough, or "💬 Dialogue Practice" and
// "Partie 1 : Les Premiers Pas" get treated as exercise sections.
const EX_HEADING = /\b(exercices?|exercises?|drills?|quiz|practice\s+tests?|test\s+blanc|examen\s+blanc)\b/i;
// "Exercice 3", "Drill 2", "Exercise 10" — the ordinal of scheme 1.
const EX_ORDINAL = /\b(exercices?|exercises?|drills?|activit[ée]s?|activity)\s*(?:n[°o]\s*)?(\d+)/i;
// "A. Associez…", "B) Complétez…", "F. Registre et style" — scheme 2's
// letter. The range runs to J because the graded readers go up to F and
// stopping at E silently dropped those groups into the un-keyed fallback.
const EX_LETTER = /^\s*(?:\*\*)?([A-J])\s*[.)]\s/;
// A numbered item, with the "**1.**" bolding the practice tests use.
const ITEM_RE = /^\s*(?:\*\*)?(\d+)\s*[.)]\s*(?:\*\*)?\s*(.*)$/;
// A bold-only line acting as a group label: "**Exercice 1 :**"
const BOLD_LABEL_RE = /^\s*\*\*(.+?)\*\*\s*:?\s*$/;

// "exercice" and "exercise" are the same word in two languages and the books
// use both for the same exercise, so the kind is normalised before matching.
function exKind(text){
  const m = EX_ORDINAL.exec(text || '');
  if(!m) return null;
  const w = m[1].toLowerCase();
  return { kind: /^exerc/.test(w) ? 'ex' : /^drill/.test(w) ? 'drill' : 'act',
           num: parseInt(m[2], 10) };
}
function groupKey(g){ return g ? g.kind + ':' + g.num : null; }
function letterOf(text){ const m = EX_LETTER.exec(text || ''); return m ? m[1].toUpperCase() : null; }

// Significant words of a section name, accent-stripped, for comparing
// "Exercices de vocabulaire" with "Vocabulaire A - Associez".
const SECTION_STOP = new Set(['de','du','des','la','le','les','un','une','et','aux','au',
  'the','of','and','for','with','your','chapter','chapitre','partie','part']);
function sectionWords(text){
  const t = speechText(String(text || '')).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return new Set((t.match(/[a-z]{3,}/g) || []).filter(w => !SECTION_STOP.has(w)));
}
function wordsOverlap(a, b){ for(const w of a) if(b.has(w)) return true; return false; }

// An answer heading of scheme 2 splits into a section and an optional letter:
// "Vocabulaire A - Associez" -> section "Vocabulaire", letter "A".
// "Grammaire - Pratique"     -> section "Grammaire",   letter null.
function answerLabelParts(label){
  const m = /^(.*?)\s*[-\u2013\u2014]\s*(.*)$/.exec(label || '');
  let left = m ? m[1] : (label || '');
  let letter = null;
  const lm = /\s([A-J])$/.exec(left.trim());
  if(lm){ letter = lm[1].toUpperCase(); left = left.trim().slice(0, -1); }
  return { section: left, letter: letter };
}

// Pull numbered items out of a block's lines. A line that isn't numbered
// continues the item above it — which is how multiple-choice options
// ("A) Il fera beau") stay attached to their question instead of becoming
// items of their own.
function itemsFromLines(lines, blockIdx, onLabel){
  const out = [];
  let cur = null;
  for(const ln of lines){
    const lab = BOLD_LABEL_RE.exec(ln.raw);
    if(lab && onLabel){ onLabel(lab[1]); cur = null; continue; }
    const m = ITEM_RE.exec(ln.raw);
    if(m){
      cur = { num: parseInt(m[1], 10), blockIdx: blockIdx,
              segFrom: ln.segFrom, segTo: ln.segTo, lines: [ln.raw] };
      out.push(cur);
    } else if(cur){
      cur.segTo = Math.max(cur.segTo, ln.segTo);
      cur.lines.push(ln.raw);
    }
  }
  return out;
}

// Drill tables ("| 1 | je / manger | |") and answer tables ("| 1 | B | … |")
// are both keyed by a numeric first column. Any other table in an exercise
// section — a word bank, a conjugation chart — is reference material, not
// questions, so the header has to look like a question grid.
function itemsFromTable(block, blockIdx){
  const h0 = ((block._header && block._header[0]) || '').replace(/\*/g,'').trim();
  if(!/^(#|n[\u00b0o]\.?|no\.?|question|q)$/i.test(h0)) return [];
  const out = [];
  for(const row of (block._rows || [])){
    const first = (row.cells[0] || '').replace(/\*/g,'').trim();
    if(!/^\d+$/.test(first)) continue;
    out.push({ num: parseInt(first, 10), blockIdx: blockIdx,
               segFrom: row.segFrom, segTo: row.segTo,
               lines: [row.cells.slice(1).filter(c => c && c.trim()).join(' \u2014 ')] });
  }
  return out;
}

function htmlToText(html){
  return speechText(String(html || '').replace(/<br\s*\/?>/gi, ' '));
}

// Split one chapter into groups, each introduced by a heading or bold label.
// `allowLabels` is set only for answer chapters, where "**Exercice 1 :**"
// genuinely introduces a group. In a question chapter a bold line is just
// emphasis — "**Soutenu :**" inside a register-transformation exercise — and
// treating it as a group boundary chopped one exercise into a set per item.
function collectGroups(chapter, allowLabels){
  const groups = [];
  let cur = null;
  function open(label){
    cur = { label: label, ord: exKind(label), letter: letterOf(label),
            isAnswers: ANS_HEADING.test(label), items: [], extra: [] };
    groups.push(cur);
    return cur;
  }
  chapter.blocks.forEach((bl, i) => {
    if(bl.type === 'heading'){ open(htmlToText(bl.html)); return; }
    if(!cur) open(chapter.own || chapter.title || '');
    if(bl.type === 'p'){
      const items = itemsFromLines(bl._lines || [], i, allowLabels ? open : null);
      if(items.length) cur.items.push(...items);
      else cur.extra.push({ text: htmlToText(bl.html) });
      return;
    }
    if(bl.type === 'table'){
      const items = itemsFromTable(bl, i);
      if(items.length) cur.items.push(...items);
      return;
    }
  });
  return groups;
}

// Build the display + speech form of one answer. An answer can itself be
// bilingual ("Bonne nuit ! / Good night!"), so the reader gets per-fragment
// language tags rather than one language for the lot.
function answerPayload(lines){
  const raw = lines.join(' ').replace(/\s+/g,' ').trim();
  const segs = segmentLine(raw, null);
  return {
    html: segs.map(s => s.html).join('') || escapeHtml(raw),
    segs: segs.filter(s => s.text && s.text.trim()).map(s => ({ lang: s.lang, text: s.text })),
    text: segs.map(s => s.text).filter(Boolean).join(' ')
  };
}
// Strip the leading "1." from an answer so it isn't read back as a number;
// keep it on the question, where it is the label.
function stripItemNumber(line){ const m = ITEM_RE.exec(line); return m ? m[2] : line; }

function attachExercises(book){
  const stats = { sets: 0, items: 0, answered: 0, unmatched: 0, byRule: {} };

  const parts = new Map();
  book.chapters.forEach((c, i) => {
    const k = c.h1 || '\u0000top';
    if(!parts.has(k)) parts.set(k, []);
    parts.get(k).push(i);
  });

  for(const idxs of parts.values()){
    // Answer sections are the reliably identifiable side, so they are found
    // first and everything else is matched against them.
    const answerGroups = [], questionChapters = [];
    for(const ci of idxs){
      const ch = book.chapters[ci];
      const own = ch.own || ch.title || '';
      if(ANS_HEADING.test(own)){
        for(const g of collectGroups(ch, true)){
          if(!g.items.length) continue;
          g.chapterIdx = ci;
          g.section = answerLabelParts(g.label);
          g.words = sectionWords(g.section.section);
          answerGroups.push(g);
        }
      } else {
        questionChapters.push(ci);
      }
    }
    if(!answerGroups.length) continue;

    for(const ci of questionChapters){
      const ch = book.chapters[ci];
      const own = ch.own || ch.title || '';
      const chWords = sectionWords(own);
      // A chapter only holds questions if it announces itself as an exercise
      // section, or its name matches an answer section's name. Without this
      // gate an ordinary numbered list — "Important points:" under a grammar
      // heading, a vocabulary table of the numbers 1 to 20 — becomes a set of
      // questions and gets some other exercise's answers bolted onto it.
      const named = answerGroups.some(a => wordsOverlap(chWords, a.words));
      if(!EX_HEADING.test(own) && !named) continue;

      for(const q of collectGroups(ch, false)){
        if(!q.items.length) continue;
        const qNums = q.items.map(it => it.num);
        const qOrd = groupKey(q.ord);
        const qLetter = q.letter;
        const qIsEx = EX_HEADING.test(q.label) || EX_HEADING.test(own);

        const candidates = [];
        for(const a of answerGroups){
          if(a.chapterIdx < ci) continue;              // answers come after questions
          const nums = new Set(a.items.map(it => it.num));
          const covered = qNums.filter(n => nums.has(n)).length;
          const aOrd = groupKey(a.ord), aLetter = a.section.letter;

          // Scheme 1: an explicit ordinal on both sides.
          if(qOrd && aOrd === qOrd && covered >= Math.ceil(qNums.length / 2)){
            candidates.push({ a: a, rule: 'ordinal', dist: a.chapterIdx - ci }); continue;
          }
          // Scheme 2: a letter on both sides, plus agreeing section names.
          if(qLetter && aLetter === qLetter && covered === qNums.length &&
             wordsOverlap(chWords, a.words)){
            candidates.push({ a: a, rule: 'letter', dist: a.chapterIdx - ci }); continue;
          }
          // Scheme 3: no key on either side. Adjacency only, and only for a
          // group that really is an exercise, with every number covered — and
          // every number still UNCLAIMED. A practice test numbers its
          // questions straight through its parts (Part A takes 1-3, Part B
          // takes 4-6), so once a part has claimed a number no later group can
          // have it. That is what stops a "Part D: Recognition Exercise"
          // further down the chapter, numbered 1-5 of its own, from helping
          // itself to the MCQ answer table that belongs to Parts A and B.
          if(!qOrd && !qLetter && !aOrd && !aLetter && qIsEx && covered === qNums.length){
            const claimed = a._claimed || (a._claimed = new Set());
            if(qNums.some(n => claimed.has(n))) continue;
            candidates.push({ a: a, rule: 'adjacent', dist: a.chapterIdx - ci }); continue;
          }
        }

        // Ambiguity is treated as failure for the keyed rules: two plausible
        // answer groups means the key didn't actually identify anything, and
        // guessing is what produced confidently wrong answers before. For the
        // un-keyed rule the nearest following group is the intended one.
        let pick = null;
        for(const rule of ['ordinal','letter','adjacent']){
          const c = candidates.filter(x => x.rule === rule);
          if(!c.length) continue;
          if(c.length === 1 || rule === 'adjacent'){
            c.sort((x,y) => x.dist - y.dist);
            pick = c[0];
          }
          break;
        }
        if(!pick){ stats.unmatched += q.items.length; continue; }

        if(pick.rule === 'adjacent'){
          const claimed = pick.a._claimed || (pick.a._claimed = new Set());
          qNums.forEach(n => claimed.add(n));
        }
        const ansByNum = new Map();
        for(const it of pick.a.items) if(!ansByNum.has(it.num)) ansByNum.set(it.num, it);

        const set = { title: q.label, match: pick.rule, source: pick.a.label, items: [] };
        for(const it of q.items){
          const entry = { n: it.num, block: it.blockIdx, from: it.segFrom, to: it.segTo,
                          q: htmlToText(escapeHtml(it.lines.join(' '))) };
          const ans = ansByNum.get(it.num);
          if(ans){
            const pay = answerPayload(ans.lines.map(stripItemNumber));
            if(pay.text){ entry.a = pay.text; entry.aHtml = pay.html; entry.aSegs = pay.segs; stats.answered++; }
          }
          set.items.push(entry);
          stats.items++;
        }
        stats.byRule[pick.rule] = (stats.byRule[pick.rule] || 0) + 1;
        (ch.exercises || (ch.exercises = [])).push(set);
        stats.sets++;
      }

      if(ch.exercises) ch.exercises.sort((x,y) =>
        (x.items[0] ? x.items[0].block : 0) - (y.items[0] ? y.items[0].block : 0));
    }
  }
  return stats;
}

// The per-line/row maps exist only for the pass above; shipping them would
// roughly double the size of every chapter file for no reader benefit.
function stripBuildScaffolding(book){
  for(const ch of book.chapters){
    for(const bl of ch.blocks){ delete bl._lines; delete bl._rows; delete bl._header; }
    delete ch.own; delete ch.titleLines; delete ch.level; delete ch.h1;
  }
}

// ============================== driver ==============================

if(!fs.existsSync(SRC)){ console.error('Source folder not found: '+SRC); process.exit(1); }
const files = fs.readdirSync(SRC).filter(f => /\.mdx?$/i.test(f));
if(!files.length){ console.error('No .md files in '+SRC); process.exit(1); }

const books = files.map(f => extractBook(path.join(SRC,f)));
books.forEach(b => { b.exStats = attachExercises(b); stripBuildScaffolding(b); });
books.sort((a,b) => a.title.localeCompare(b.title));

const usedIds = [];
books.forEach(b => {
  let base = b.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'book';
  let id = base, n = 2;
  while(usedIds.includes(id)) id = base + '-' + (n++);
  usedIds.push(id); b.id = id;
});

function stats(b){
  let blocks = 0, segs = 0, fr = 0, en = 0, tables = 0;
  b.chapters.forEach(c => c.blocks.forEach(bl => {
    blocks++; if(bl.type === 'table') tables++;
    bl.segs.forEach(s => { segs++; if(s.lang === 'fr') fr++; else en++; });
  }));
  return { blocks, segs, fr, en, tables };
}

function writeReport(){
  const lines = [];
  books.forEach(b => {
    lines.push('='.repeat(78));
    lines.push('BOOK: '+b.title+'   ['+b.id+']   <- '+b.source);
    lines.push('='.repeat(78));
    b.chapters.forEach((c,ci) => {
      lines.push('');
      lines.push('--- CHAPTER '+(ci+1)+': '+c.title);
      c.blocks.forEach((bl,bi) => {
        lines.push('  [block '+(bi+1)+'] '+bl.type+(bl.level?(' h'+bl.level):'')+(bl.quote?' (quote)':''));
        bl.segs.forEach((s,si) => lines.push('    '+String(si).padStart(3)+'  '+s.lang.toUpperCase()+'  '+s.text));
      });
    });
  });
  fs.writeFileSync(path.join(DATA,'segments-report.txt'), lines.join('\n'), 'utf8');
}

// Audit file for exercise mode: every question the reader will ask, next to
// the answer it will read out. This is the only way to check the pairing is
// right — a confidently wrong answer is worse than no answer at all.
function writeExerciseReport(){
  const lines = [];
  books.forEach(b => {
    if(!b.chapters.some(c => c.exercises)) return;
    lines.push('='.repeat(78));
    lines.push('BOOK: '+b.title+'   <- '+b.source);
    lines.push('='.repeat(78));
    b.chapters.forEach((c,ci) => {
      if(!c.exercises) return;
      lines.push('');
      lines.push('--- CHAPTER '+(ci+1)+': '+c.title);
      c.exercises.forEach(set => {
        lines.push('  SET: '+set.title);
        lines.push('       matched by: '+set.match+'   from answer group: '+(set.source||'?'));
        set.items.forEach(it => {
          lines.push('    Q'+it.n+'  '+it.q);
          lines.push('      A   '+(it.a !== undefined ? it.a : '*** NO ANSWER FOUND ***'));
        });
      });
    });
  });
  fs.writeFileSync(path.join(DATA,'exercises-report.txt'), lines.join('\n'), 'utf8');
}

(async () => {
  const passphrase = (await getPassphrase()).trim();
  if(!passphrase){ console.error('No passphrase provided (set BOOK_PASSPHRASE or type one). Aborting.'); process.exit(1); }
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITER, 32, 'sha256');

  fs.rmSync(DATA, { recursive:true, force:true });
  fs.mkdirSync(DATA, { recursive:true });

  const manifest = {
    // Key-derivation params are public (the salt is not a secret). Book and
    // chapter TITLES stay in clear so the picker works before the passphrase
    // is typed; the block text and its language tags are encrypted.
    crypto: { alg:'AES-GCM', kdf:'PBKDF2', hash:'SHA-256', iter:PBKDF2_ITER, salt: salt.toString('base64') },
    mixed: true,
    books: books.map(b => {
      const rel = DATA_NAME + '/' + b.id + '.enc';
      fs.writeFileSync(path.join(OUT, rel), JSON.stringify(encryptJSON({ title:b.title, chapters:b.chapters }, key)));
      // `source` is only the .md filename; it lets the verification tools
      // match a built book back to the file it came from.
      return { id:b.id, title:b.title, source:b.source, file:rel, chapters:b.chapters.map(c => c.title) };
    })
  };
  fs.writeFileSync(path.join(DATA,'manifest.json'), JSON.stringify(manifest));
  if(WANT_REPORT){ writeReport(); writeExerciseReport(); }

  console.log('Wrote '+path.join(path.relative(process.cwd(),DATA),'manifest.json')+'  (block text encrypted)');
  books.forEach(b => {
    const s = stats(b);
    console.log('  '+b.title);
    console.log('    ['+b.id+']  '+b.chapters.length+' ch, '+s.blocks+' blocks ('+s.tables+' tables), '
      + s.segs+' segments  \u2014  '+s.fr+' FR / '+s.en+' EN   <- '+b.source);
    const x = b.exStats;
    if(x && x.items){
      const pct = (100*x.answered/x.items).toFixed(1);
      console.log('      exercises: '+x.sets+' sets, '+x.items+' questions, '
        + x.answered+' with an answer from the book ('+pct+'%)'
        + '  [' + Object.keys(x.byRule).map(r => r+':'+x.byRule[r]).join(' ') + ']'
        + (x.unmatched ? '; '+x.unmatched+' question(s) left unmatched' : ''));
    }
  });
  if(WANT_REPORT){
    console.log('Wrote '+path.join(path.relative(process.cwd(),DATA),'segments-report.txt')+'  (language tagging audit)');
    console.log('Wrote '+path.join(path.relative(process.cwd(),DATA),'exercises-report.txt')+'  (exercise pairing audit)');
  }
})();
