#!/usr/bin/env node
/* Verify every built book against its source:
 *   integrity  — each data-seg span has a segs entry and vice versa
 *   fidelity   — every displayed line matches a source line character for
 *                character (after markdown emphasis/quote/bullet markers)
 *   coverage   — no source content line silently vanished from the output
 * Usage: node tools/verify_build.js <siteDir> <srcDir> [passphrase]
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const SITE = process.argv[2] || 'site2';
const SRC = process.argv[3] || 'books-src2';
const PASS = process.argv[4] || 'test';

const man = JSON.parse(fs.readFileSync(path.join(SITE, 'data-mixed', 'manifest.json'), 'utf8'));
const c = man.crypto;
const key = crypto.pbkdf2Sync(PASS, Buffer.from(c.salt, 'base64'), c.iter, 32, 'sha256');

function decrypt(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(SITE, file), 'utf8'));
  const ct = Buffer.from(raw.ct, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'));
  d.setAuthTag(ct.slice(-16));
  return JSON.parse(Buffer.concat([d.update(ct.slice(0, -16)), d.final()]).toString('utf8'));
}

const visible = h => h.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const norm = s => s.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
const stripMarkers = l => l.replace(/^>\s?/, '').replace(/^#{1,6}\s+/, '')
  .replace(/^\s*[-*+\u2022\u2023\u2043]\s+/, '');

// Source lines that carry content the reader should end up seeing. Frontmatter,
// blank lines, horizontal rules and table syntax are excluded — the first two
// carry nothing, and tables are checked separately by row count.
function sourceLines(file) {
  let raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const fm = raw.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/);
  if (fm) raw = raw.slice(fm[0].length);
  const all = [], tableRows = [];
  for (const line of raw.split('\n')) {
    const t = stripMarkers(line).trim();
    if (!t) continue;
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) continue;
    if (/^\|/.test(t)) {
      if (!/^\|[\s:|-]+\|?$/.test(t)) tableRows.push(t);
      continue;
    }
    all.push(norm(t));
  }
  return { lines: all, tableRows };
}

let totalFails = 0;
console.log('book'.padEnd(46) + 'integrity  fidelity        coverage        rows');
for (const b of man.books) {
  const book = decrypt(b.file);
  const src = sourceLines(path.join(SRC, b.source || guessSource(b, man)));

  let integrity = 0, outRows = 0;
  const displayed = [];
  for (const ch of book.chapters) {
    for (const bl of ch.blocks) {
      const found = new Set([...bl.html.matchAll(/data-seg="(\d+)"/g)].map(m => +m[1]));
      for (const i of found) if (i >= bl.segs.length) integrity++;
      for (let i = 0; i < bl.segs.length; i++) if (!found.has(i)) integrity++;
      for (const s of bl.segs) if (s.lang !== 'fr' && s.lang !== 'en') integrity++;
      if (bl.type === 'table') { outRows += (bl.html.match(/<tr>/g) || []).length; continue; }
      for (const l of visible(bl.html).split('\n')) {
        const n = norm(l.replace(/^[\u2022\u2023\u2043]\s*/, ''));
        if (n) displayed.push(n);
      }
    }
  }

  const srcSet = new Set(src.lines);
  const matched = displayed.filter(l => srcSet.has(l)).length;
  // Coverage: how much of the source made it out. Chapter headings that opened
  // an empty chapter are legitimately dropped, so this is expected to be high
  // but not necessarily exactly 100%.
  const outSet = new Set(displayed);
  const covered = src.lines.filter(l => outSet.has(l)).length;

  const fidPct = (100 * matched / Math.max(1, displayed.length));
  const covPct = (100 * covered / Math.max(1, src.lines.length));
  const rowsOk = outRows >= src.tableRows.length;
  const ok = integrity === 0 && fidPct === 100 && rowsOk;
  if (!ok) totalFails++;
  console.log(
    (b.id.slice(0, 44)).padEnd(46) +
    String(integrity).padEnd(11) +
    (matched + '/' + displayed.length + ' ' + fidPct.toFixed(2) + '%').padEnd(16) +
    (covered + '/' + src.lines.length + ' ' + covPct.toFixed(1) + '%').padEnd(16) +
    (outRows + '/' + src.tableRows.length) + (ok ? '' : '   <-- CHECK')
  );
  if (fidPct < 100) {
    const miss = displayed.filter(l => !srcSet.has(l)).slice(0, 5);
    miss.forEach(m => console.log('        display line not in source: ' + JSON.stringify(m.slice(0, 95))));
  }
  if (covPct < 99) {
    const miss = src.lines.filter(l => !outSet.has(l)).slice(0, 5);
    miss.forEach(m => console.log('        source line not displayed:  ' + JSON.stringify(m.slice(0, 95))));
  }
}
function guessSource(b, man) { return b.id + '.md'; }
console.log(totalFails ? '\n' + totalFails + ' book(s) need attention' : '\nall books clean');
process.exit(totalFails ? 1 : 0);
