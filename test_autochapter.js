/* Focused test for automatic chapter advance.
 * Loads the real encrypted book, jumps to the last block of a chapter, and
 * checks that playback rolls into the next chapter without stopping, that the
 * flash appears and clears on its own, and that the toggle turns it off. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.join(__dirname, 'site');
const PASS = 'test';
const STUB_MS = 20;
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
    speak(u){ this.speaking = true; spoken.push({ text:u.text, lang:u.lang });
      setTimeout(() => { this.speaking = false; if(u.onend) u.onend(); }, STUB_MS); }
  };
  w.MediaMetadata = function(){};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Block buttons read the target block once and then stop; wait for that to
// finish, otherwise clicking play next would land mid-block and PAUSE instead.
async function waitIdle(doc){
  for(let i=0;i<200;i++){
    if(doc.getElementById('playBtn').textContent === '\u25b6') return true;
    await sleep(25);
  }
  return false;
}

(async () => {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname,'index_mixed.html'),'utf8'), {
    runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc, url:'https://example.test/',
    beforeParse(win){ installBackend(win); installSpeech(win); }
  });
  const w = dom.window, doc = w.document;
  await sleep(80);

  let fails = 0;
  const check = (c,m) => { if(!c){ console.error('  FAIL:', m); fails++; } else console.log('  ok:', m); };

  // open book, chapter 5
  doc.getElementById('bookInput').dispatchEvent(new w.Event('input',{bubbles:true}));
  await sleep(20);
  doc.querySelector('#bookList .opt').click();
  await sleep(20);
  const chapSel = doc.getElementById('chapterSelect');
  const chapterTitles = [...chapSel.options].map(o => o.textContent);
  chapSel.value = '4';
  doc.getElementById('bookPass').value = PASS;
  doc.getElementById('loadChapterBtn').click();
  await sleep(800);

  const total = +doc.getElementById('total').textContent;
  console.log('chapter 5 opened,', total, 'blocks');
  console.log('next chapter is:', chapterTitles[5].slice(0,60));

  // Park on the LAST block, then start continuous playback from there.
  doc.querySelector('[data-act="reset"]').click(); await sleep(10);
  for(let i=0;i<total-1;i++){ doc.querySelector('[data-act="nextBlock"]').click(); await sleep(15); }
  await waitIdle(doc);
  check(doc.getElementById('pos').textContent === String(total), 'parked on the last block of the chapter');

  // Kill the language gap so the test runs fast, then play continuously.
  for(let i=0;i<10;i++) doc.querySelector('[data-gap="-50"]').click();
  spoken.length = 0;
  doc.getElementById('playBtn').click();     // toggle -> play(false), continuous
  await sleep(STUB_MS*30);

  const toast = doc.getElementById('chapterToast');
  console.log('\nafter playing past the end of the chapter:');
  check(doc.getElementById('reader').classList.contains('on'), 'still in the reader');
  check(spoken.length > 3, 'audio kept going across the boundary ('+spoken.length+' utterances)');

  // It should now be in the NEXT chapter, still playing.
  const nowPlaying = doc.getElementById('playBtn').textContent !== '\u25b6';
  check(nowPlaying, 'still playing after the chapter turned over');
  check(chapSel.value === '5', 'chapter dropdown followed the auto-advance (now '+chapSel.value+')');

  // ---- the flash overlay ----
  console.log('\nflash overlay:');
  // Re-trigger a chapter change and watch the toast within its ~1s window.
  spoken.length = 0;
  doc.getElementById('nextChapterBtn').click();
  await sleep(30);
  check(toast.classList.contains('show'), 'flash is visible right after a chapter change');
  check(toast.classList.contains('flash'), 'flash uses the compact variant, not the long info toast');
  check(toast.textContent === chapterTitles[+chapSel.value],
        'flash shows the chapter now open: '+toast.textContent.slice(0,45));
  const cs = w.getComputedStyle(toast);
  check(cs.position === 'absolute' && cs.pointerEvents === 'none',
        'flash is an overlay that cannot affect or intercept the text (position:'+cs.position+', pointer-events:'+cs.pointerEvents+')');
  // It must survive the hide-all-controls view, which is when it matters most.
  doc.getElementById('hideBtn').click();
  await sleep(10);
  check(doc.getElementById('topbar').style.opacity === '0', 'controls are hidden');
  check(toast.classList.contains('show') && w.getComputedStyle(toast).opacity !== '0',
        'flash still shows with all controls hidden');
  doc.getElementById('hideBtn').click();
  await sleep(1200);
  check(!toast.classList.contains('show'), 'flash clears itself after about a second');

  // ---- the Off toggle ----
  console.log('\nauto-chapter toggle:');
  const btn = doc.getElementById('autoNextBtn');
  check(/On$/.test(btn.textContent), 'defaults to On');
  btn.click();
  check(/Off$/.test(btn.textContent), 'toggles to Off');

  const t2 = +doc.getElementById('total').textContent;
  doc.querySelector('[data-act="reset"]').click(); await sleep(10);
  for(let i=0;i<t2-1;i++){ doc.querySelector('[data-act="nextBlock"]').click(); await sleep(12); }
  await waitIdle(doc);
  const chapBefore = chapSel.value;
  doc.getElementById('playBtn').click();
  await sleep(STUB_MS*30);
  check(doc.getElementById('playBtn').textContent === '\u25b6', 'with Auto-chapter Off, playback stops at the end of the chapter');
  check(chapSel.value === chapBefore, 'and it stays in the same chapter');

  console.log('\n' + (fails ? fails+' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(fails ? 1 : 0);
})();
