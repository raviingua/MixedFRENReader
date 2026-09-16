/* Whole-chapter view.
 *
 * The requirement was explicitly "the functionality should not change" — so
 * most of this file is about what must stay the same when the view is on:
 * reading continues block by block, the right block is highlighted, exercise
 * mode still stops for input, and switching back leaves everything as it was.
 *
 * Runs against either app:
 *   node test_chapterview.js
 *   APP_SITE=site-ruby APP_HTML=index_ruby.html node test_chapterview.js
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

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
    speaking:false, getVoices(){ return voices; }, cancel(){ this.speaking=false; },
    speak(u){ this.speaking=true; spoken.push({ text:u.text, lang:u.lang });
      setTimeout(() => { this.speaking=false; if(u.onend) u.onend(); }, STUB_MS); }
  };
  w.MediaMetadata = function(){};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  // jsdom has no layout, so scrollIntoView is absent; the page calls it.
  w.Element.prototype.scrollIntoView = function(){};
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
  await sleep(90);

  let fails = 0;
  const check = (c,m) => { if(!c){ console.error('  FAIL:', m); fails++; } else console.log('  ok:', m); };
  const blocksOnScreen = () => doc.querySelectorAll('#textInner [data-blk]').length;

  // ---- open a chapter that has exercises, so both concerns are covered ----
  doc.getElementById('bookInput').dispatchEvent(new w.Event('input',{bubbles:true}));
  await sleep(20);
  doc.querySelector('#bookList .opt').click();
  await sleep(30);
  const chapSel = doc.getElementById('chapterSelect');
  const partSel = doc.getElementById('partSelect');
  if(partSel){
    for(const p of partSel.options){
      partSel.value = p.value;
      partSel.dispatchEvent(new w.Event('change',{bubbles:true}));
      await sleep(10);
      if([...chapSel.options].some(o => CHAPTER_RE.test(o.textContent))) break;
    }
  }
  const ci = [...chapSel.options].findIndex(o => CHAPTER_RE.test(o.textContent));
  if(ci < 0){ console.error('FAIL: no exercise chapter found'); process.exit(1); }
  chapSel.value = chapSel.options[ci].value;
  doc.getElementById('bookPass').value = PASS;
  doc.getElementById('loadChapterBtn').click();
  await sleep(800);
  check(doc.getElementById('reader').classList.contains('on'), 'chapter opened');

  const total = +doc.getElementById('total').textContent;
  console.log('   chapter has', total, 'blocks');

  // ---- block mode: exactly one block on screen ----
  const viewBtn = doc.getElementById('viewBtn');
  check(/Block$/.test(viewBtn.textContent), 'view defaults to one block at a time');
  check(blocksOnScreen() === 1, 'block mode shows exactly one block');
  const firstText = doc.getElementById('blockEl').textContent.trim().slice(0,40);

  // ---- chapter mode ----
  viewBtn.click();
  await sleep(30);
  check(/Chapter$/.test(viewBtn.textContent), 'the pill switches to Chapter');
  check(blocksOnScreen() === total, 'chapter mode shows every block (' + blocksOnScreen() + '/' + total + ')');
  check(doc.getElementById('textDisplay').classList.contains('viewAll'), 'the stage is put into chapter layout');
  check(doc.querySelectorAll('#textInner .isCurrent').length === 1, 'exactly one block is marked current');
  check(doc.getElementById('blockEl') !== null, 'the current block still carries id="blockEl"');
  check(doc.getElementById('blockEl').getAttribute('data-blk') === '0', 'and it is the block being read');
  check(doc.getElementById('blockEl').textContent.trim().slice(0,40) === firstText,
        'the same block is current as before the switch');

  // ---- reading must be unchanged ----
  for(let i=0;i<10;i++) doc.querySelector('[data-gap="-50"]').click();
  spoken.length = 0;
  doc.querySelector('[data-act="replay"]').click();
  await sleep(STUB_MS*25);
  check(spoken.length > 0, 'the current block is read aloud in chapter view (' + spoken.length + ' utterances)');
  // Highlighting must land inside the CURRENT block, not on a same-numbered
  // segment of some other block — every block numbers its segments from 0.
  spoken.length = 0;
  doc.querySelector('[data-act="replay"]').click();
  await sleep(STUB_MS*2);
  const lit = doc.querySelectorAll('#textInner .ttsSeg.speaking');
  const strayLit = [...lit].filter(el => el.closest('[data-blk]') !== doc.getElementById('blockEl'));
  check(lit.length === 0 || strayLit.length === 0,
        'highlighting stays inside the current block (' + lit.length + ' lit, ' + strayLit.length + ' stray)');
  await sleep(STUB_MS*30);

  // ---- advancing keeps the page and moves the marker ----
  const before = blocksOnScreen();
  doc.querySelector('[data-act="nextBlock"]').click();
  await sleep(60);
  check(blocksOnScreen() === before, 'moving to the next block does not rebuild the page');
  check(doc.getElementById('blockEl').getAttribute('data-blk') === '1', 'the marker moved to the next block');
  check(doc.querySelectorAll('#textInner .isCurrent').length === 1, 'still exactly one block marked');
  check(doc.getElementById('pos').textContent === '2', 'the position readout follows');

  // ---- exercise mode must still work ----
  doc.getElementById('exModeBtn').click();
  doc.querySelector('[data-act="reset"]').click(); await sleep(20);
  check(blocksOnScreen() === total, 'still the whole chapter after a reset');
  spoken.length = 0;
  doc.getElementById('playBtn').click();
  let waited = 0;
  const panel = doc.getElementById('exPanel');
  while(!panel.classList.contains('on') && waited < 400){ await sleep(25); waited++; }
  check(panel.classList.contains('on'), 'exercise mode still stops for input in chapter view');
  check(blocksOnScreen() === total, 'and the chapter is still all on screen behind the panel');
  const qEl = doc.getElementById('exQ').textContent;
  doc.getElementById('exInput').value = 'réponse';
  doc.getElementById('exSubmit').click();
  await sleep(60);
  check(doc.getElementById('exCompare').style.display !== 'none', 'checking an answer works');
  check(doc.getElementById('exBook').textContent.trim().length > 0, 'the book answer is shown');
  doc.getElementById('exNext').click();
  waited = 0;
  while(!panel.classList.contains('on') && waited < 400){ await sleep(25); waited++; }
  check(panel.classList.contains('on') && doc.getElementById('exQ').textContent !== qEl,
        'Next advances to the following question');
  doc.getElementById('exOff').click();
  await sleep(50);

  // ---- switching back ----
  viewBtn.click();
  await sleep(30);
  check(/Block$/.test(viewBtn.textContent), 'the pill switches back to Block');
  check(blocksOnScreen() === 1, 'block mode shows one block again');
  check(!doc.getElementById('textDisplay').classList.contains('viewAll'), 'the chapter layout is removed');
  check(doc.getElementById('blockEl') !== null, 'the current block is still identified');
  spoken.length = 0;
  doc.querySelector('[data-act="replay"]').click();
  await sleep(STUB_MS*20);
  check(spoken.length > 0, 'reading still works after switching back');

  // ---- a new chapter rebuilds correctly in chapter view ----
  viewBtn.click(); await sleep(20);
  doc.getElementById('nextChapterBtn').click();
  await sleep(700);
  const t2 = +doc.getElementById('total').textContent;
  check(blocksOnScreen() === t2, 'a newly opened chapter renders in full (' + blocksOnScreen() + '/' + t2 + ')');
  check(doc.getElementById('blockEl').getAttribute('data-blk') === '0', 'starting at its first block');

  console.log('\n' + (fails ? fails+' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(fails ? 1 : 0);
})();
