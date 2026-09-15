/* End-to-end check of index_mixed.html in jsdom, with speechSynthesis and
 * WebCrypto/fetch stubbed enough to exercise the real code paths:
 * manifest load -> passphrase -> decrypt -> render -> playback.
 * Asserts that what the engine is asked to say matches the block's tagged
 * segments, in order, with the right voice language and rate. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.join(__dirname, 'site');
const PASS = 'test';

// ---- what the stub engine was asked to speak ----
const spoken = [];
const STUB_MS = 30;   // simulated duration of one utterance

function makeDom(){
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  vc.on('error', (...a) => console.error('PAGE console.error:', ...a));

  const dom = new JSDOM(fs.readFileSync(path.join(__dirname,'index_mixed.html'),'utf8'), {
    runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc, url:'https://example.test/',
    // The page fetches its manifest as soon as its script runs, so the
    // backing stubs have to be in place before parsing starts.
    beforeParse(win){ installBackend(win); installSpeech(win); }
  });
  const w = dom.window;

  return dom;
}

function installSpeech(w){
  // --- speechSynthesis stub: records each utterance, then fires onend async ---
  const voices = [
    { voiceURI:'fr1', name:'Thomas',  lang:'fr-FR', default:false, localService:true },
    { voiceURI:'en1', name:'Samantha', lang:'en-US', default:true,  localService:true },
  ];
  w.SpeechSynthesisUtterance = function(text){ this.text = text; };
  w.speechSynthesis = {
    speaking:false,
    getVoices(){ return voices; },
    cancel(){ this.speaking = false; },
    speak(u){
      this.speaking = true;
      spoken.push({ text:u.text, lang:u.lang, voice:u.voice && u.voice.name, rate:u.rate });
      // Each stub utterance takes a real (if short) amount of time, so that
      // pausing mid-block actually has something to interrupt.
      setTimeout(() => { this.speaking = false; if(u.onend) u.onend(); }, STUB_MS);
    }
  };
  w.MediaMetadata = function(){};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
}

// --- fetch + WebCrypto stubs backed by the REAL built files ---
function installBackend(w){
  w.fetch = (url) => {
    const p = path.join(SITE, String(url));
    if(!fs.existsSync(p)) return Promise.resolve({ ok:false });
    return Promise.resolve({ ok:true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(p,'utf8'))) });
  };
  // Node's webcrypto does everything the page needs (PBKDF2 + AES-GCM).
  // window.crypto is a read-only accessor in jsdom, so it has to be redefined.
  Object.defineProperty(w, 'crypto', {
    configurable:true, writable:true,
    value:{ subtle: crypto.webcrypto.subtle, getRandomValues: b => crypto.webcrypto.getRandomValues(b) }
  });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.atob = s => Buffer.from(s,'base64').toString('binary');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = makeDom();
  const w = dom.window, doc = w.document;
  await sleep(80);   // let the page's manifest fetch settle

  // Pick the book through the real combobox, exactly as a person would.
  const input = doc.getElementById('bookInput');
  input.value = '';
  input.dispatchEvent(new w.Event('input', { bubbles:true }));
  await sleep(20);
  let opts = doc.querySelectorAll('#bookList .opt');
  if(!opts.length){ console.error('FAIL: book list empty — manifest never reached the page'); process.exit(1); }
  console.log('books listed:', opts.length, '->', opts[0].textContent.slice(0,45));
  opts[0].click();
  await sleep(20);

  const chapSel = doc.getElementById('chapterSelect');
  console.log('chapters listed:', chapSel.options.length);
  // Chapter 5 (0-based 4) is the mixed FR/EN airport dialogue.
  chapSel.value = '4';

  doc.getElementById('bookPass').value = PASS;
  doc.getElementById('loadChapterBtn').click();
  await sleep(700);   // PBKDF2 at 250k iterations + decrypt

  const err = doc.getElementById('err').textContent;
  if(!doc.getElementById('reader').classList.contains('on')){
    console.error('FAIL: reader never opened. err =', JSON.stringify(err)); process.exit(1);
  }
  console.log('chapter opened. blocks:', doc.getElementById('total').textContent);

  // ---- walk to the mixed dialogue block and read it ----
  function gotoBlockIndex(n){
    doc.getElementById('reader');
    for(let i=0;i<n;i++) doc.querySelector('[data-act="nextBlock"]').click();
  }

  // Find the dialogue block by looking for one with both languages in it.
  let target = -1, total = +doc.getElementById('total').textContent;
  for(let i=0;i<total;i++){
    doc.querySelector('[data-act="reset"]').click();
    break;
  }
  // Step forward until the readout reports a block containing both languages.
  doc.querySelector('[data-act="reset"]').click();
  await sleep(10);
  for(let i=0;i<total;i++){
    const note = doc.getElementById('mixNote').textContent;
    if(/fr/.test(note) && /en/.test(note)){ target = i; break; }
    doc.querySelector('[data-act="nextBlock"]').click();
    await sleep(30);
  }
  if(target < 0){ console.error('FAIL: no mixed-language block found in this chapter'); process.exit(1); }
  console.log('mixed block found at index', target+1, '->', doc.getElementById('mixNote').textContent);

  // Read it, with the language-change gap turned off so the test is quick.
  for(let i=0;i<10;i++) doc.querySelector('[data-gap="-50"]').click();
  spoken.length = 0;
  doc.querySelector('[data-act="replay"]').click();
  await sleep(STUB_MS*8);

  console.log('\nutterances produced:', spoken.length);
  spoken.slice(0,10).forEach(s => console.log('   ', s.lang, '| rate', s.rate.toFixed(2), '|', s.text.slice(0,55)));

  // ---- assertions ----
  const el = doc.getElementById('blockEl');
  const segLangs = [...el.querySelectorAll('.ttsSeg')].map(s => s.getAttribute('data-lang'));
  let fails = 0;
  function check(cond, msg){ if(!cond){ console.error('  FAIL:', msg); fails++; } else console.log('  ok:', msg); }

  console.log('\nchecks:');
  check(spoken.length > 1, 'block produced multiple utterances (one per segment)');
  check(spoken.some(s => /^fr/.test(s.lang)) && spoken.some(s => /^en/.test(s.lang)),
        'both a French-tagged and an English-tagged utterance were issued');
  // Rate must follow the per-language wpm, not one global speed.
  const frRates = new Set(spoken.filter(s=>/^fr/.test(s.lang)).map(s=>s.rate.toFixed(3)));
  const enRates = new Set(spoken.filter(s=>/^en/.test(s.lang)).map(s=>s.rate.toFixed(3)));
  check(frRates.size===1 && enRates.size===1 && [...frRates][0] !== [...enRates][0],
        'French and English utterances got different, consistent rates ('+[...frRates][0]+' vs '+[...enRates][0]+')');
  check(new Set(segLangs).size === 2, 'rendered block carries both data-lang values');

  // Speaking order must equal the tagged segment order.
  const spokenLangs = spoken.map(s => /^fr/.test(s.lang) ? 'fr' : 'en');
  check(JSON.stringify(spokenLangs) === JSON.stringify(segLangs),
        'utterance language sequence matches the rendered segment sequence');

  // Speeds are independently adjustable.
  const beforeFr = doc.getElementById('wpmValFR').textContent;
  doc.querySelector('.wpmDualRow [data-wpm="fr"][data-d="10"]').click();
  check(doc.getElementById('wpmValFR').textContent !== beforeFr &&
        doc.getElementById('wpmValEN').textContent === '250',
        'French speed changes independently of English');

  // Muting a language must silence it without changing the text on screen.
  const htmlBefore = el.innerHTML;
  doc.getElementById('langBtnEN').click();
  await sleep(10);
  spoken.length = 0;
  doc.querySelector('[data-act="replay"]').click();
  await sleep(STUB_MS*8);
  check(spoken.length > 0 && spoken.every(s => /^fr/.test(s.lang)),
        'with English muted, only French fragments are spoken ('+spoken.length+' utterances)');
  check(doc.getElementById('blockEl').innerHTML === htmlBefore,
        'muting a language leaves the displayed text untouched');
  doc.getElementById('langBtnEN').click();

  // ---- the hard case: a long block that alternates language many times ----
  doc.querySelector('[data-act="reset"]').click(); await sleep(10);
  let best = -1, bestN = 0;
  for(let i=0;i<total;i++){
    const n = doc.querySelectorAll('#blockEl .ttsSeg').length;
    if(n > bestN){ bestN = n; best = i; }
    doc.querySelector('[data-act="nextBlock"]').click(); await sleep(25);
  }
  doc.querySelector('[data-act="reset"]').click(); await sleep(10);
  for(let i=0;i<best;i++){ doc.querySelector('[data-act="nextBlock"]').click(); await sleep(25); }
  const bigLangs = [...doc.querySelectorAll('#blockEl .ttsSeg')].map(s=>s.getAttribute('data-lang'));
  console.log('\nlongest block in chapter: index '+(best+1)+', '+bigLangs.length+' segments, '
    + (bigLangs.join('').match(/(fr|en)(?!\1)/g)||[]).length + ' language switches');
  spoken.length = 0;
  doc.querySelector('[data-act="replay"]').click();
  await sleep(STUB_MS*40);
  const bigSpoken = spoken.map(s => /^fr/.test(s.lang) ? 'fr' : 'en');
  check(JSON.stringify(bigSpoken) === JSON.stringify(bigLangs),
        'long alternating block: all '+bigLangs.length+' segments spoken in order in the right language');

  // ---- pause / resume must replay the current segment, not restart ----
  doc.querySelector('[data-act="replay"]').click();
  await sleep(STUB_MS*4 + 10);            // a few segments in
  doc.getElementById('playBtn').click();  // pause
  await sleep(60);
  const atPause = spoken.length;
  check(doc.getElementById('playBtn').textContent === '\u25b6', 'pause updates the play button');
  await sleep(200);
  check(spoken.length === atPause, 'nothing is spoken while paused');
  doc.getElementById('playBtn').click();  // resume
  await sleep(80);
  check(spoken.length > atPause, 'resume continues speaking');
  check(spoken[atPause].text === spoken[atPause-1].text,
        'resume replays the segment that was interrupted, rather than restarting the block');

  console.log('\n' + (fails ? fails+' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(fails ? 1 : 0);
})();
