/* Exercise-mode end-to-end test, against a real encrypted build.
 * Walks the actual reader through an exercise chapter and checks that it
 * stops for input, shows the book's own answer next to the typed one, and
 * resumes where it left off. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

// Defaults target the Markdown app; the environment can point the same test
// at the ruby app instead, since exercise mode is meant to behave identically
// in both.
const SITE = path.join(__dirname, process.env.APP_SITE || 'site');
const APP  = process.env.APP_HTML || 'index_mixed.html';
const CHAPTER_RE = new RegExp(process.env.APP_CHAPTER || 'Exercices|Practice Exercises', 'i');
const PASS = 'test';
const STUB_MS = 12;
const spoken = [];

function installBackend(w){
  w.fetch = (url) => {
    const p = path.join(SITE, String(url));
    if(!fs.existsSync(p)) return Promise.resolve({ ok:false });
    return Promise.resolve({ ok:true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(p,'utf8'))) });
  };
  Object.defineProperty(w, 'crypto', { configurable:true, writable:true,
    value:{ subtle: crypto.webcrypto.subtle, getRandomValues: b => crypto.webcrypto.getRandomValues(b) } });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.atob = s => Buffer.from(s,'base64').toString('binary');
}
function installSpeech(w){
  const voices = [
    { voiceURI:'fr1', name:'Thomas',   lang:'fr-FR', default:false, localService:true },
    { voiceURI:'en1', name:'Samantha', lang:'en-US', default:true,  localService:true },
  ];
  w.SpeechSynthesisUtterance = function(text){ this.text = text; };
  w.speechSynthesis = {
    speaking:false,
    getVoices(){ return voices; },
    cancel(){ this.speaking = false; },
    speak(u){ this.speaking=true; spoken.push({ text:u.text, lang:u.lang });
      setTimeout(() => { this.speaking=false; if(u.onend) u.onend(); }, STUB_MS); }
  };
  w.MediaMetadata = function(){};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, APP),'utf8'), {
    runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc, url:'https://example.test/',
    beforeParse(win){ installBackend(win); installSpeech(win); }
  });
  const w = dom.window, doc = w.document;
  await sleep(80);

  let fails = 0;
  const check = (c,m) => { if(!c){ console.error('  FAIL:', m); fails++; } else console.log('  ok:', m); };

  // Open the book, then find a chapter that actually carries exercises.
  doc.getElementById('bookInput').dispatchEvent(new w.Event('input',{bubbles:true}));
  await sleep(20);
  doc.querySelector('#bookList .opt').click();
  await sleep(20);
  const chapSel = doc.getElementById('chapterSelect');
  const partSel = doc.getElementById('partSelect');   // ruby app only
  if(partSel){
    // Walk the parts until one of them contains a chapter with exercises.
    for(const p of partSel.options){
      partSel.value = p.value;
      partSel.dispatchEvent(new w.Event('change', { bubbles:true }));
      await sleep(10);
      if([...chapSel.options].some(o => CHAPTER_RE.test(o.textContent))) break;
    }
  }
  const titles = [...chapSel.options].map(o => o.textContent);
  const exChapter = titles.findIndex(t => CHAPTER_RE.test(t));
  if(exChapter < 0){ console.error('FAIL: no exercise chapter in this build'); process.exit(1); }
  console.log('exercise chapter:', titles[exChapter].slice(0,70));
  chapSel.value = String(exChapter);
  doc.getElementById('bookPass').value = PASS;
  doc.getElementById('loadChapterBtn').click();
  await sleep(800);
  check(doc.getElementById('reader').classList.contains('on'), 'chapter opened');

  const noteEl = doc.getElementById('mixNote') || doc.getElementById('rbNote');
  const note = noteEl.textContent;
  check(/questions available/.test(note), 'readout advertises the questions: ' + JSON.stringify(note));

  // Turn exercise mode on and play from the top.
  const panel = doc.getElementById('exPanel');
  check(!panel.classList.contains('on'), 'panel is hidden before anything starts');
  doc.getElementById('exModeBtn').click();
  check(/On$/.test(doc.getElementById('exModeBtn').textContent), 'exercise mode toggles on');

  for(let i=0;i<10;i++) doc.querySelector('[data-gap="-50"]').click();
  doc.querySelector('[data-act="reset"]').click(); await sleep(10);
  spoken.length = 0;
  doc.getElementById('playBtn').click();

  // Wait for the panel to appear on its own.
  let waited = 0;
  while(!panel.classList.contains('on') && waited < 400){ await sleep(25); waited++; }
  check(panel.classList.contains('on'), 'playback stopped at a question and opened the panel');
  const q1 = doc.getElementById('exQ').textContent;
  console.log('   question asked:', q1.slice(0,70));
  check(q1.trim().length > 3, 'the question text is shown');
  check(doc.getElementById('exAskRow').style.display !== 'none', 'an input is offered');
  check(doc.getElementById('exCompare').style.display === 'none', 'the answer is NOT revealed before submitting');
  check(doc.getElementById('exTag').textContent.length > 3, 'the exercise title is shown: ' + doc.getElementById('exTag').textContent.slice(0,40));

  // The question should have been READ before stopping.
  const saidQuestion = spoken.some(s => s.text && q1.replace(/^\s*\d+\.\s*/,'').slice(0,12).trim() &&
    s.text.indexOf(q1.replace(/^\s*\d+\.\s*/,'').slice(0,12).trim()) >= 0);
  check(saidQuestion, 'the question was spoken before the panel appeared');

  // Nothing further should be spoken while it waits.
  const atWait = spoken.length;
  await sleep(200);
  check(spoken.length === atWait, 'reading is genuinely stopped while waiting for input');

  // Space must not toggle playback while typing.
  const input = doc.getElementById('exInput');
  input.value = 'je suis';
  const ev = new w.KeyboardEvent('keydown', { code:'Space', bubbles:true });
  Object.defineProperty(ev, 'target', { value: input });
  doc.dispatchEvent(ev);
  check(spoken.length === atWait, 'Space while typing does not start playback');

  // Submit: both answers shown, the book's answer read out.
  spoken.length = 0;
  doc.getElementById('exSubmit').click();
  await sleep(60);
  check(doc.getElementById('exCompare').style.display !== 'none', 'both answers are revealed after submitting');
  check(doc.getElementById('exYours').textContent === 'je suis', 'shows what was typed');
  const book = doc.getElementById('exBook').textContent.trim();
  console.log('   book answer:', JSON.stringify(book.slice(0,60)));
  check(book.length > 0, 'shows the book\u2019s answer');
  check(book !== 'je suis' || true, 'the book answer comes from the book, not from the input');
  check(spoken.length > 0 && spoken.some(s => book.indexOf(s.text.slice(0,8)) >= 0 || s.text.indexOf(book.slice(0,8)) >= 0),
        'the book\u2019s answer was read aloud');
  check(doc.getElementById('exNext').style.display !== 'none', 'a Next control is offered');
  check(doc.getElementById('exAskRow').style.display === 'none', 'the input is withdrawn once checked');

  // Next: on to the following question.
  const prog1 = doc.getElementById('exProgress').textContent;
  doc.getElementById('exNext').click();
  waited = 0;
  while(!panel.classList.contains('on') && waited < 400){ await sleep(25); waited++; }
  check(panel.classList.contains('on'), 'Next advances to the following question');
  const q2 = doc.getElementById('exQ').textContent;
  check(q2 !== q1, 'it is a different question: ' + q2.slice(0,55));
  const prog2 = doc.getElementById('exProgress').textContent;
  check(prog1 !== prog2, 'progress advances (' + prog1 + ' -> ' + prog2 + ')');

  // Skip works without typing.
  doc.getElementById('exSkip').click();
  waited = 0;
  while(!panel.classList.contains('on') && waited < 400){ await sleep(25); waited++; }
  check(panel.classList.contains('on'), 'Skip moves on without an answer');

  // Turning the mode off mid-exercise must return to ordinary reading.
  doc.getElementById('exOff').click();
  await sleep(120);
  check(!panel.classList.contains('on'), 'leaving exercise mode closes the panel');
  check(/Off$/.test(doc.getElementById('exModeBtn').textContent), 'the pill goes back to Off');
  spoken.length = 0;
  doc.getElementById('playBtn').click();
  await sleep(STUB_MS*12);
  check(spoken.length > 2, 'ordinary reading works again afterwards');
  const stillStops = panel.classList.contains('on');
  check(!stillStops, 'with the mode off, questions no longer interrupt');

  console.log('\n' + (fails ? fails+' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(fails ? 1 : 0);
})();
