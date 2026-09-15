#!/usr/bin/env python3
"""Flag likely mis-tagged segments in a segments-report.txt.

Independent of the builder's own logic on purpose: it uses a small set of
words that are unambiguous in one language and effectively never appear in the
other, and reports segments where that evidence contradicts the tag. So it can
catch the builder being wrong without inheriting the builder's blind spots.
"""
import re
import sys
from collections import Counter

REPORT = sys.argv[1] if len(sys.argv) > 1 else 'site2/data-mixed/segments-report.txt'

# Words with essentially no counterpart usage in the other language.
FR_SURE = re.compile(r"\b(le|la|les|des|une|est|sont|vous|nous|dans|avec|qui|que|"
                     r"pour|elle|ils|elles|c'est|j'ai|n'est|d'un|d'une|du|au|aux|"
                     r"être|avoir|faire|cette|ces|mais|donc|pas|plus|très|bien)\b", re.I)
EN_SURE = re.compile(r"\b(the|and|is|are|was|were|of|with|that|this|these|those|"
                     r"you|she|he|they|have|has|had|will|would|which|what|there|"
                     r"their|from|about|because|been|being|does|did)\b", re.I)

segs, cur_book, cur_chapter = [], None, None
for line in open(REPORT, encoding='utf-8'):
    line = line.rstrip('\n')
    m = re.match(r'^BOOK: (.*?)\s+\[', line)
    if m:
        cur_book = m.group(1)
        continue
    m = re.match(r'^--- CHAPTER \d+: (.*)$', line)
    if m:
        cur_chapter = m.group(1)
        continue
    m = re.match(r'^\s+\d+\s+(FR|EN)\s\s(.*)$', line)
    if m:
        segs.append((cur_book, cur_chapter, m.group(1), m.group(2)))

def strength(text, pat):
    return len(pat.findall(text))

bad_fr, bad_en = [], []
for book, chapter, lang, text in segs:
    f, e = strength(text, FR_SURE), strength(text, EN_SURE)
    if lang == 'FR' and e >= 2 and f == 0:
        bad_fr.append((book, chapter, text, e))
    elif lang == 'EN' and f >= 2 and e == 0:
        bad_en.append((book, chapter, text, f))

print(f'{len(segs)} segments audited')
print(f'  tagged FR but reads clearly English: {len(bad_fr)}  '
      f'({100*len(bad_fr)/max(1,len(segs)):.3f}%)')
print(f'  tagged EN but reads clearly French : {len(bad_en)}  '
      f'({100*len(bad_en)/max(1,len(segs)):.3f}%)')

for label, rows in (('FR that should be EN', bad_fr), ('EN that should be FR', bad_en)):
    if not rows:
        continue
    print(f'\n===== {label} =====')
    by_book = Counter(r[0] for r in rows)
    for b, n in by_book.most_common():
        print(f'   {n:5}  {b[:70]}')
    print('  --- examples (strongest evidence first):')
    for book, chapter, text, n in sorted(rows, key=lambda r: -r[3])[:30]:
        print(f'   [{n}] {text[:100]}')
        print(f'        ^ {(chapter or "")[:80]}')
