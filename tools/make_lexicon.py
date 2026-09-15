#!/usr/bin/env python3
"""Generate lexicon.js for build_books_mixed.js.

Why this exists
---------------
The builder's hand-written word lists were assembled by reading the audit
report and fixing what was wrong. That works, but it leaves long tails
uncovered — the French number words being the case that prompted this. A table
column of "20 vingt / 21 vingt et un / 22 vingt-deux / ..." had no French
function word in most cells, so most cells scored as no-evidence, and one
single miscount was enough to flip the entire column to English.

Guessing more words by hand is how cognate bugs get introduced ("six" is
French AND English; "cent", "sept", "pour", "table", "chat", "son", "main",
"plus" all look French but are ordinary English words too). So instead of
guessing, each candidate is checked against real corpus frequencies and only
kept when it is *decisively* more one language than the other.

The rule
--------
A word joins the French list only if

    zipf_fr(word) >= MIN_Z            it is actually common in French
    zipf_fr(word) - zipf_en(word) >= MARGIN    and far commoner in French

and symmetrically for English. Zipf is a log10 scale, so MARGIN = 2.0 means
"at least 100x commoner in French than in English". That threshold is what
keeps cognates out automatically:

    vingt   fr 4.82  en 1.96   diff 2.86  -> French      (kept)
    cinq    fr 5.28  en 2.17   diff 3.11  -> French      (kept)
    six     fr 5.15  en 5.29   diff -0.14 -> ambiguous   (dropped)
    sept    fr 5.00  en 4.35   diff 0.65  -> ambiguous   (dropped, and rightly:
                                             English "Sept." is September)
    cent    fr 4.65  en 4.83   diff -0.18 -> ambiguous   (dropped)

MARGIN alone is not quite enough, because a word can clear it while still
being common in the other language in absolute terms:

    pour    fr 6.98  en 4.10   diff 2.88  -> clears MARGIN, but English
                                             "pour the milk" is ordinary,
                                             so MAX_Z_OTHER drops it

MAX_Z_OTHER is that second gate: whatever the ratio, a word is never claimed
for one language if it is a normal everyday word in the other.

The French list keeps only UNACCENTED words. Accented French is already
identified by the builder's accentEvidence() rule, so listing "frère" or
"écrivez" would add nothing but bytes; "vingt" and "fromage" are the ones that
need help.

Usage
-----
    pip install wordfreq
    python3 make_lexicon.py > lexicon.js

Raise MARGIN to be more conservative (fewer words, less chance of a cognate
slipping through); lower MIN_Z to reach further into rare vocabulary.
"""

import re
import sys

from wordfreq import top_n_list, zipf_frequency

# The two margins are deliberately different. French corpora are full of
# English (loanwords, quoted English, bilingual text) while English corpora
# contain comparatively little French, so an ordinary English word like
# "cheese" scores fr 3.23 / en 4.57 — a gap of only 1.34 — and a symmetric
# 2.0 threshold would reject most everyday English nouns. Measured against a
# guard list of French vocabulary (see FRENCH_GUARD), lowering the English
# margin to 1.2 admits 16 of 19 wanted English words and lets through zero
# French ones, so the asymmetry costs nothing in safety.
MARGIN_FR = 2.0    # French must be >=100x commoner in French than English
MARGIN_EN = 1.2    # English needs a smaller gap, for the reason above
MIN_Z = 3.2        # minimum frequency in its own language
MAX_Z_OTHER = 4.0  # hard ceiling on how common it may be in the OTHER language
TOP_N = 40000      # how far down each frequency list to look

# Words that must never be claimed for English, whatever the numbers say.
# This is a tripwire, not a filter: if any of these ever lands on the English
# list the generator refuses to write the file, because that is precisely the
# failure mode ("six" on the English list) this whole approach exists to stop.
FRENCH_GUARD = """
fromage poulet lait tomate jambon fraise carotte saucisse bonjour bonsoir
merci vingt cinq trente quarante cinquante soixante deux trois quatre huit
neuf dix onze douze treize quatorze quinze oncle voisine boulangerie aliments
soeur maison ville livre fille salut pardon matin soir jour nuit pain eau
chaise tasse village bien tout avec dans pour sans chez leur elle vous nous
""".split()

PLAIN = re.compile(r"^[a-z]{2,}$")            # French: unaccented words only
ANY = re.compile(r"^[a-zà-ÿœæ]{2,}$")         # English: any letters


def build(lang, other, pattern, margin):
    return [
        w
        for w in top_n_list(lang, TOP_N, wordlist="best")
        if pattern.match(w)
        and zipf_frequency(w, lang) >= MIN_Z
        and zipf_frequency(w, other) < MAX_Z_OTHER
        and zipf_frequency(w, lang) - zipf_frequency(w, other) >= margin
    ]


def main():
    fr = build("fr", "en", PLAIN, MARGIN_FR)
    en = build("en", "fr", ANY, MARGIN_EN)

    overlap = set(fr) & set(en)
    if overlap:   # impossible by construction, but never ship it unchecked
        sys.exit(f"ABORT: {len(overlap)} words in both lists: {sorted(overlap)[:10]}")

    leaked = sorted(set(en) & set(FRENCH_GUARD))
    if leaked:
        sys.exit(f"ABORT: French words landed on the English list: {leaked}")

    out = sys.stdout.write
    out("/* lexicon.js — GENERATED FILE, do not edit by hand.\n")
    out(" * Produced by tools/make_lexicon.py; see that script for the rule.\n")
    out(" * Words kept only when clearly commoner in one language than\n")
    out(" * the other, which is what keeps cognates (six, sept, cent, table,\n")
    out(" * chat, main, plus) out of both lists automatically.\n")
    out(" *   French: %d words (unaccented only — accented French is already\n" % len(fr))
    out(" *           recognised by accentEvidence() in the builder)\n")
    out(" *   English: %d words\n" % len(en))
    out(" * Edit the hand-curated lists in build_books_mixed.js instead; they\n")
    out(" * take precedence over anything in here.\n")
    out(" */\n")
    out("'use strict';\n")
    out("module.exports = {\n")
    out("  fr: '" + " ".join(fr) + "'.split(' '),\n")
    out("  en: '" + " ".join(en) + "'.split(' ')\n")
    out("};\n")


if __name__ == "__main__":
    main()
