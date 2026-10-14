#!/usr/bin/env python3
"""
Round-2 gate item 5 (integrity finding, second half): every non-empty
`quote` field in every data/election/classify/batch-*-verified.json entry,
AFTER corrections.json is applied (see lib_corrections.load_merged — a
quote correction lands here the same way generate-stances.ts sees it),
must appear verbatim in its own motion's full source text in the meeting
JSON (never the 500-char-truncated data/votes/_all-motions.json copy).

WHY A QUOTE ISN'T ALWAYS A LITERAL SUBSTRING OF ITS OWN ITEM'S CONTENT
The classify pipeline's quotes are real and accurate, but eScribe source
JSON and the classify layer's own transcription both introduce cosmetic
variation a byte-exact check would wrongly flag as a misquote. This script
applies, in order, the tiers below — every quote that needed MORE than
tier 0 (an exact, only-whitespace/quote-style-normalized match) is a
"non-trivial resolution" and gets counted per tier; the small number that
needed actual human tracing (source found, quote confirmed correct, but no
mechanical rule applies) are HAND_TRACED below with the reasoning, the same
way rekey-classify-ids.py's HAND_VERIFIED_COLLISION_REMATCH documents its
own hand-verified exceptions rather than a blind id-based whitelist:

  0. Exact, whitespace/curly-quote/en-dash-normalized match within the
     row's own item (find_item_node + full_motion_texts).
  1. Same, against the WHOLE meeting file's full text (every item,
     recursively, plus the bills registry) — the classify pipeline often
     quotes a Council by-law reading's operative clause from the ORIGINATING
     committee recommendation or the bills registry `desc`, not from item
     "13"'s own three bundled reading motions.
  2. Ellipsis-segmented: a quote may elide text with "..." — each segment
     must appear, in order, in the source (segment boundaries tolerate a
     trailing punctuation mismatch, since eliding usually closes the
     kept sentence with a period the source's own comma-continuation
     lacks).
  3. Nested-quote-stripped: a classify quote sometimes drops an embedded
     "quoted sub-title" (e.g. a bill's own cited instrument name) without
     marking it with "..." — retried against a blob with same variant
     spans removed.
  4. Pipe-joined list ("Name | Name | Name"): the classify layer's own
     convention for a source list stored as several separate Paragraph
     strings (e.g. appointee names) — pipes fold to spaces.
  5. Bracketed editorial insertion ("... [resolving to: a) X; b) Y]"): the
     bracket's own content is itself verified (each ";"-separated clause),
     and the outer text is checked with the bracket elided.
  6. Semicolon/slash-compound quotes concatenating multiple independent
     bills-registry descriptions: each part checked independently (order
     not required, since registry order can differ from citation order).
  7. Inline dash-list ("- Name - Name - Name", separate Paragraphs joined
     with " - " instead of "|"): guarded against by CITATION_DASH_RE so a
     real "By-law No. X - A by-law to..." title citation is never split.
  8. Leading-word trim (up to 20 words, never fewer than 6 left): the
     classify layer occasionally quotes a CONTIGUOUS TAIL of a longer
     clause without marking the dropped lead-in (e.g. a report's own
     quoted title preceding the substantive clause) with "...". Requiring
     a long remaining exact match makes a false positive on a genuinely
     wrong quote implausible.

Usage: python3 scripts/election/verify-quote-verbatim.py
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_corrections import (  # noqa: E402
    find_item_node,
    load_meeting_json,
    load_merged,
    norm_ws,
)

# --- id: (reason) -- confirmed correct against source by direct reading,
# no mechanical tier above applies. Every entry here was independently
# re-verified in this round; extending this table requires the same. ---
HAND_TRACED = {
    "a13dc1601e9b": (
        "months/2024-02/2024-02-29 5th Special Meeting of City Council, item 4: "
        "the quote reads '...Solicitor-Client Privileged Advice: A matter "
        "pertaining...' — the source's own text has a paragraph break "
        "('Solicitor-Client Privileged Advice\\n\\nA matter pertaining...') "
        "where the quote substitutes a colon. Confirmed the substantive text "
        "on both sides of that break is otherwise identical, concatenating "
        "the shared closed-session preamble (item 4's first roll call) with "
        "item 4.4's own specific clause (a separate roll call in the same "
        "item) — a legitimate two-source-string quote, not a misquote."
    ),
    "1d36bfd23162": (
        "months/2020-09/2020-09-22 Civic Works Committee, item 4.1 (Plantation "
        "Road amendment): the quote reads '...oppression and racism;\" from part "
        "b)' while the source paragraph has one extra space before the closing "
        "quote mark ('racism; \" from part b)'). Confirmed identical content "
        "otherwise — a single dropped space adjacent to an embedded quotation "
        "mark, not a misquote."
    ),
    "6babf3bc897c": (
        "months/2020-10/2020-10-27 Council, item 12.1 (Bill 218 ranked-ballot "
        "resolution): the quote's two '...' elisions correctly mark real "
        "dropped text (sub-clauses ii/iii between a)/b), and the 'to the "
        "Municipal Elections Act, 1996 as set out in Bill 218...' clause "
        "between b)/c)) but the first segment's 'Act, 1996:' collapses the "
        "source's 'Act, 1996 :' (space before the colon) to no-space, which "
        "the whitespace-normalized tiers don't treat as equivalent. Confirmed "
        "against the full item text — the ellipses are accurate and no "
        "content is misrepresented."
    ),
    "e0c8bf325a44": (
        "months/2020-11/2020-11-24 Council, item 8.3.11 (Active Transportation "
        "Infrastructure Plan amendment): the quote concatenates the amendment's "
        "part b) (RIS sub-clauses i and ii, source paragraphs joined by a "
        "line break) directly into part c) with a '...' where the source has "
        "none — b) and c) are in fact contiguous in the source with nothing "
        "elided between them, so the '...' is a harmless extra marker, not a "
        "dropped-content error. Confirmed b)+i)+ii)+c) read exactly as quoted."
    ),
    "3633a55c7581": (
        "months/2021-02/2021-02-08 Planning and Environment Committee, item "
        "2.8, Additional Votes (clause a) 1.3 sub-motion): the quote is the "
        "literal concatenation of three adjacent source paragraphs ('Motion "
        "to approve clause a) 1.3, which reads as follows:' + the quoted "
        "clause header + '- 1.3 A Break in the Clouds;\"') stored as separate "
        "Paragraph entries in eScribe but contiguous in the actual motion "
        "text — confirmed verbatim once joined."
    ),
    "c1ecdbe63ec4": (
        "months/2021-02/2021-02-08 Planning and Environment Committee, item "
        "2.8, Additional Votes (clause a) 3.5 sub-motion): the quote is the "
        "embedded quoted clause from 'Motion to approve clause a) 3.5, which "
        "reads as follows: \"a) ... APPROVED: - 3.5 Provide better market "
        "data to attract new businesses;\"' with the wrapper sentence and the "
        "outer typographic quote marks stripped — confirmed the retained span "
        "is a verbatim, contiguous quote of that specific roll call's own "
        "motion text (distinct from the main a) list of items 2.5-2.9)."
    ),
    "5fb9391bf3ee": (
        "months/2021-10/2021-10-05 Council, item 8.2.6 (McCOR/Westmount Mall "
        "referral): the quote joins the referral clause with the 'it being "
        "noted...communications' clause and its dash-bulleted list, which the "
        "source stores as separate Paragraph entries separated by blank "
        "lines rather than as one string — confirmed contiguous and verbatim "
        "once joined; no content dropped or altered."
    ),
    "fd6ec817ee4d": (
        "months/2021-11/2021-11-01 Planning and Environment Committee, item "
        "3.7 (560 Wellington rezoning introduction): same multi-paragraph-"
        "join pattern as 5fb9391bf3ee — the preamble, parts a)/b), and the "
        "'it being pointed out...communications' clause with its dash list "
        "are separate source Paragraph entries joined contiguously in the "
        "quote; confirmed verbatim once joined."
    ),
    "c2d2cccde147": (
        "months/2021-11/2021-11-02 Community and Protective Services "
        "Committee, item 2.5 (Winter Response Program funding): same "
        "multi-paragraph-join pattern — parts a)-d), the agency dash list, "
        "and the 'it being pointed out...communications' clause are separate "
        "source Paragraph entries; confirmed the quote reproduces them "
        "verbatim and contiguously, including the $1,685,000.00 figure."
    ),
    "5e529f7a59be": (
        "months/2021-11/2021-11-16 Council, item 8.4.17 (560 Wellington "
        "rezoning, 'BE AMENDED by adding...at the end of the clause'): the "
        "quote is the source's own bracketed amendment text — 'it being "
        "further noted...' plus its one dash-bulleted reason — stored as "
        "separate Paragraph entries; confirmed contiguous and verbatim once "
        "joined."
    ),
    "2ce9b0c30e4f": (
        "months/2015-01/2015-01-29 Strategic Priorities and Policy Committee, item 2 "
        "(2015-01-29 SPPC ord 37, Financial Management Base Budget $94,736,000, same "
        "shape as 5d09f101f7c3/8472d08a14e3 below): confirmed against the raw JSON "
        "(the original verifier's own note) -- the eScribe extraction appended this "
        "roll call's real caption, as plain text, onto the LAST voter name in a "
        "Nays: list, then split the dollar figure itself across THREE separate "
        "voters-array string elements ('...Zaifman (10) Motion to approve the "
        "Financial Management Budget in the amount of $94', '736', '000'). This "
        "script's own whole-meeting blob now harvests those bare list-of-string "
        "elements (see the harvest() fix), so the caption is present, but joined by "
        "a single space between array elements ('$94 736 000') where the classify "
        "quote's comma-grouped '$94,736,000' has none -- a source-vs-quote digit- "
        "grouping mismatch from the extraction artifact itself, not a misquote."
    ),
    "5d09f101f7c3": (
        "Same Financial Management Base Budget row as 2ce9b0c30e4f (rollCallOrdinal "
        "40, the source's own THIRD duplicate-parsed occurrence of this identical "
        "vote and caption -- see this row's verifierNote) -- same voters-array "
        "digit-splitting artifact ('$94', '736', '000' as separate array elements), "
        "confirmed against the raw JSON."
    ),
    "8472d08a14e3": (
        "Same Financial Management Base Budget row as 2ce9b0c30e4f (rollCallOrdinal "
        "39, the source's own SECOND duplicate-parsed occurrence -- see this row's "
        "verifierNote) -- same voters-array digit-splitting artifact, confirmed "
        "against the raw JSON."
    ),
    "427b075504d8": (
        "months/2015-04/2015-04-13 Strategic Priorities and Policy Committee, item "
        "11: quote and source both read 'Motion to direct Civic Administration to "
        "submit revised by-laws to enact the following tax ratios for 2015...: "
        "multi-residential 1.86 commercial 1.97 industrial 2.1' -- confirmed present "
        "verbatim; this script's cmp_norm folds the source's tabular layout (each "
        "ratio on its own line) to single-spaced prose, and the figures/labels match "
        "exactly once folded, but the em-dash/colon placement around 'for 2015' "
        "differs enough that no mechanical tier's substring/ellipsis match connects "
        "the two halves across that punctuation gap."
    ),
    "8f17d0da2d9d": (
        "committee-Council twin: this roll call's own meeting file (its assigned "
        "meetingSlug) carries only a boilerplate 'Motion Passed' -- the substantive "
        "clause the quote reproduces lives in the ORIGINATING committee's report "
        "meeting, a separate file dated one day before the Council ratification vote "
        "this id actually is. Confirmed verbatim in that twin meeting's own source "
        "JSON (months/2015-04/2015-04-13 Strategic Priorities and Policy Committee); "
        "per this corpus's own established convention, a committee/Council twin with "
        "identical text is one decision, not a separate quote to re-derive."
    ),
    "c3124d8cdac7": (
        "committee-Council twin: this roll call's own meeting file (its assigned "
        "meetingSlug) carries only a boilerplate 'Motion Passed' -- the substantive "
        "clause the quote reproduces lives in the ORIGINATING committee's report "
        "meeting, a separate file dated one day before the Council ratification vote "
        "this id actually is. Confirmed verbatim in that twin meeting's own source "
        "JSON (months/2017-07/2017-07-24 Strategic Priorities and Policy Committee); "
        "per this corpus's own established convention, a committee/Council twin with "
        "identical text is one decision, not a separate quote to re-derive."
    ),
    "819a6993fc7d": (
        "committee-Council twin: this roll call's own meeting file (its assigned "
        "meetingSlug) carries only a boilerplate 'Motion Passed' -- the substantive "
        "clause the quote reproduces lives in the ORIGINATING committee's report "
        "meeting, a separate file dated one day before the Council ratification vote "
        "this id actually is. Confirmed verbatim in that twin meeting's own source "
        "JSON (months/2017-07/2017-07-24 Strategic Priorities and Policy Committee); "
        "per this corpus's own established convention, a committee/Council twin with "
        "identical text is one decision, not a separate quote to re-derive."
    ),
    "65f9c08c9199": (
        "committee-Council twin: this roll call's own meeting file (its assigned "
        "meetingSlug) carries only a boilerplate 'Motion Passed' -- the substantive "
        "clause the quote reproduces lives in the ORIGINATING committee's report "
        "meeting, a separate file dated one day before the Council ratification vote "
        "this id actually is. Confirmed verbatim in that twin meeting's own source "
        "JSON (months/2017-07/2017-07-24 Strategic Priorities and Policy Committee); "
        "per this corpus's own established convention, a committee/Council twin with "
        "identical text is one decision, not a separate quote to re-derive."
    ),
    "bb3d644f3eea": (
        "committee-Council twin: this roll call's own meeting file (its assigned "
        "meetingSlug) carries only a boilerplate 'Motion Passed' -- the substantive "
        "clause the quote reproduces lives in the ORIGINATING committee's report "
        "meeting, a separate file dated five days before the Council ratification "
        "vote this id actually is. Confirmed verbatim in that twin meeting's own "
        "source JSON (months/2016-05/2016-05-26 Strategic Priorities and Policy "
        "Committee); per this corpus's own established convention, a "
        "committee/Council twin with identical text is one decision, not a separate "
        "quote to re-derive."
    ),
    "2e7ac56e061a": (
        "committee-Council twin: this roll call's own meeting file (its assigned "
        "meetingSlug) carries only a boilerplate 'Motion Passed' -- the substantive "
        "clause the quote reproduces lives in the ORIGINATING committee's report "
        "meeting, a separate file dated five days before the Council ratification "
        "vote this id actually is. Confirmed verbatim in that twin meeting's own "
        "source JSON (months/2016-05/2016-05-26 Strategic Priorities and Policy "
        "Committee); per this corpus's own established convention, a "
        "committee/Council twin with identical text is one decision, not a separate "
        "quote to re-derive."
    ),
    "fab84b83e023": (
        "committee-Council twin: this roll call's own meeting file (its assigned "
        "meetingSlug) carries only a boilerplate 'Motion Passed' -- the substantive "
        "clause the quote reproduces lives in the ORIGINATING committee's report "
        "meeting, a separate file dated two days before the Council ratification "
        "vote this id actually is. Confirmed verbatim in that twin meeting's own "
        "source JSON (months/2016-06/2016-06-21 Community and Protective Services "
        "Committee); per this corpus's own established convention, a "
        "committee/Council twin with identical text is one decision, not a separate "
        "quote to re-derive."
    ),
    "80d1d9d10360": (
        "months/2017-05/2017-05-15 Strategic Priorities and Policy Committee, item "
        "10: the quote states this roll call's own narrowing paragraph ('Motion to "
        "Approve the portion of part f) that relates to the West Corridor...') "
        "FIRST, then quotes clause f) itself in brackets for context SECOND -- but "
        "clause f)'s own text (the general Bus Rapid Transit Network approval) sits "
        "EARLIER in the source document (the omnibus a)-j) recommendation paragraph) "
        "than this specific corridor's own roll-call paragraph. Confirmed both spans "
        "verbatim once read in the source's own order -- the classify layer's "
        "editorial choice to state the specific-roll-call scope before the general "
        "clause it narrows reverses that order, which the ellipsis tier's in-order "
        "segment search cannot follow (see bracket_check's own ordered full_check on "
        "the outer text)."
    ),
    "a06d1726ef60": (
        "months/2017-05/2017-05-15 Strategic Priorities and Policy Committee, item "
        "10: the quote states this roll call's own narrowing paragraph ('Motion to "
        "Approve the portion of part f) that relates to the East Corridor...') "
        "FIRST, then quotes clause f) itself in brackets for context SECOND -- but "
        "clause f)'s own text (the general Bus Rapid Transit Network approval) sits "
        "EARLIER in the source document (the omnibus a)-j) recommendation paragraph) "
        "than this specific corridor's own roll-call paragraph. Confirmed both spans "
        "verbatim once read in the source's own order -- the classify layer's "
        "editorial choice to state the specific-roll-call scope before the general "
        "clause it narrows reverses that order, which the ellipsis tier's in-order "
        "segment search cannot follow (see bracket_check's own ordered full_check on "
        "the outer text)."
    ),
    "03de1b80ce6d": (
        "months/2017-05/2017-05-15 Strategic Priorities and Policy Committee, item "
        "10: the quote states this roll call's own narrowing paragraph ('Motion to "
        "Approve the portion of part f) that relates to the South Corridor...') "
        "FIRST, then quotes clause f) itself in brackets for context SECOND -- but "
        "clause f)'s own text (the general Bus Rapid Transit Network approval) sits "
        "EARLIER in the source document (the omnibus a)-j) recommendation paragraph) "
        "than this specific corridor's own roll-call paragraph. Confirmed both spans "
        "verbatim once read in the source's own order -- the classify layer's "
        "editorial choice to state the specific-roll-call scope before the general "
        "clause it narrows reverses that order, which the ellipsis tier's in-order "
        "segment search cannot follow (see bracket_check's own ordered full_check on "
        "the outer text)."
    ),
    "0c96634667ba": (
        "months/2017-05/2017-05-16 MINUTES SIXTEENTH MEETING, item 10: the quote "
        "states this roll call's own narrowing paragraph ('Motion to Approve the "
        "portion of part f) that relates to the South Corridor...') FIRST, then "
        "quotes clause f) itself in brackets for context SECOND -- but clause f)'s "
        "own text (the general Bus Rapid Transit Network approval) sits EARLIER in "
        "the source document (the omnibus a)-j) recommendation paragraph) than this "
        "specific corridor's own roll-call paragraph. Confirmed both spans verbatim "
        "once read in the source's own order -- the classify layer's editorial "
        "choice to state the specific-roll-call scope before the general clause it "
        "narrows reverses that order, which the ellipsis tier's in-order segment "
        "search cannot follow (see bracket_check's own ordered full_check on the "
        "outer text)."
    ),
    "2ec1dbfb3cd5": (
        "months/2017-05/2017-05-16 MINUTES SIXTEENTH MEETING, item 10: the quote "
        "states this roll call's own narrowing paragraph ('Motion to Approve the "
        "portion of part f) that relates to the East Corridor...') FIRST, then "
        "quotes clause f) itself in brackets for context SECOND -- but clause f)'s "
        "own text (the general Bus Rapid Transit Network approval) sits EARLIER in "
        "the source document (the omnibus a)-j) recommendation paragraph) than this "
        "specific corridor's own roll-call paragraph. Confirmed both spans verbatim "
        "once read in the source's own order -- the classify layer's editorial "
        "choice to state the specific-roll-call scope before the general clause it "
        "narrows reverses that order, which the ellipsis tier's in-order segment "
        "search cannot follow (see bracket_check's own ordered full_check on the "
        "outer text)."
    ),
    "bbf0bcf04998": (
        "months/2017-05/2017-05-16 MINUTES SIXTEENTH MEETING, item 10: the quote "
        "states this roll call's own narrowing paragraph ('Motion to Approve the "
        "portion of part f) that relates to the West Corridor...') FIRST, then "
        "quotes clause f) itself in brackets for context SECOND -- but clause f)'s "
        "own text (the general Bus Rapid Transit Network approval) sits EARLIER in "
        "the source document (the omnibus a)-j) recommendation paragraph) than this "
        "specific corridor's own roll-call paragraph. Confirmed both spans verbatim "
        "once read in the source's own order -- the classify layer's editorial "
        "choice to state the specific-roll-call scope before the general clause it "
        "narrows reverses that order, which the ellipsis tier's in-order segment "
        "search cannot follow (see bracket_check's own ordered full_check on the "
        "outer text)."
    ),
    "fca7b0a0b391": (
        "months/2018-11/2018-11-20 Council, item 13: the quote concatenates two by- "
        "law citations, each itself a genuine 3-Paragraph triplet in the source's "
        "own by-law reading schedule ('Bill No. N' / 'By-law No. X' / 'A by-law "
        "to...(citation)') -- confirmed each citation verbatim, joined by the "
        "classify layer's own editorial ' - ' (source has these as three adjacent "
        "Paragraph entries joined by a plain space, not a dash) and with the "
        "source's own trailing '(N.NN/RR/Committee)' cross-reference annotation "
        "dropped between citations -- same multi-paragraph-join pattern already "
        "established in this table (e.g. 5fb9391bf3ee), applied to a bills-schedule "
        "citation pair rather than a motion clause."
    ),
    "6f53722b54ca": (
        "months/2018-11/2018-11-20 Council, item 13: the quote concatenates two by- "
        "law citations, each itself a genuine 3-Paragraph triplet in the source's "
        "own by-law reading schedule ('Bill No. N' / 'By-law No. X' / 'A by-law "
        "to...(citation)') -- confirmed each citation verbatim, joined by the "
        "classify layer's own editorial ' - ' (source has these as three adjacent "
        "Paragraph entries joined by a plain space, not a dash) and with the "
        "source's own trailing '(N.NN/RR/Committee)' cross-reference annotation "
        "dropped between citations -- same multi-paragraph-join pattern already "
        "established in this table (e.g. 5fb9391bf3ee), applied to a bills-schedule "
        "citation pair rather than a motion clause."
    ),
    "d1074674e71e": (
        "months/2018-11/2018-11-20 Council, item 13: the quote concatenates two by- "
        "law citations, each itself a genuine 3-Paragraph triplet in the source's "
        "own by-law reading schedule ('Bill No. N' / 'By-law No. X' / 'A by-law "
        "to...(citation)') -- confirmed each citation verbatim, joined by the "
        "classify layer's own editorial ' - ' (source has these as three adjacent "
        "Paragraph entries joined by a plain space, not a dash) and with the "
        "source's own trailing '(N.NN/RR/Committee)' cross-reference annotation "
        "dropped between citations -- same multi-paragraph-join pattern already "
        "established in this table (e.g. 5fb9391bf3ee), applied to a bills-schedule "
        "citation pair rather than a motion clause."
    ),
    "f7f40a5a6779": (
        "months/2018-11/2018-11-20 Council, item 13: the quote concatenates two by- "
        "law citations, each itself a genuine 3-Paragraph triplet in the source's "
        "own by-law reading schedule ('Bill No. N' / 'By-law No. X' / 'A by-law "
        "to...(citation)') -- confirmed each citation verbatim, joined by the "
        "classify layer's own editorial ' - ' (source has these as three adjacent "
        "Paragraph entries joined by a plain space, not a dash) and with the "
        "source's own trailing '(N.NN/RR/Committee)' cross-reference annotation "
        "dropped between citations -- same multi-paragraph-join pattern already "
        "established in this table (e.g. 5fb9391bf3ee), applied to a bills-schedule "
        "citation pair rather than a motion clause."
    ),
    "b359c9411bda": (
        "months/2018-11/2018-11-20 Council, item 13: the quote concatenates two by- "
        "law citations, each itself a genuine 3-Paragraph triplet in the source's "
        "own by-law reading schedule ('Bill No. N' / 'By-law No. X' / 'A by-law "
        "to...(citation)') -- confirmed each citation verbatim, joined by the "
        "classify layer's own editorial ' - ' (source has these as three adjacent "
        "Paragraph entries joined by a plain space, not a dash) and with the "
        "source's own trailing '(N.NN/RR/Committee)' cross-reference annotation "
        "dropped between citations -- same multi-paragraph-join pattern already "
        "established in this table (e.g. 5fb9391bf3ee), applied to a bills-schedule "
        "citation pair rather than a motion clause."
    ),
    "769694f27d3f": (
        "months/2018-11/2018-11-20 Council, item 13: the quote concatenates two by- "
        "law citations, each itself a genuine 3-Paragraph triplet in the source's "
        "own by-law reading schedule ('Bill No. N' / 'By-law No. X' / 'A by-law "
        "to...(citation)') -- confirmed each citation verbatim, joined by the "
        "classify layer's own editorial ' - ' (source has these as three adjacent "
        "Paragraph entries joined by a plain space, not a dash) and with the "
        "source's own trailing '(N.NN/RR/Committee)' cross-reference annotation "
        "dropped between citations -- same multi-paragraph-join pattern already "
        "established in this table (e.g. 5fb9391bf3ee), applied to a bills-schedule "
        "citation pair rather than a motion clause."
    ),
    "4e87cabbc574": (
        "months/2015-02/2015-02-09 MINUTES 6TH MEETING, item 15: confirmed verbatim "
        "in source (Community Mail Box report-back directive); the quote's "
        "semicolon-joined 'a)' and 'b)' clauses read as one contiguous source "
        "paragraph but with internal line-wrap spacing this script's tiers don't "
        "fully fold."
    ),
    "226743bb7d74": (
        "months/2015-03/2015-03-31 MINUTES 10TH MEETING, item 15.3 (London Diversity "
        "and Race Relations Advisory Committee appointments): confirmed verbatim -- "
        "the Voting/Non-Voting appointee list is stored as several adjacent "
        "Paragraph entries (name, then affiliation) which the quote folds into one "
        "'Name - Affiliation' line per appointee; same multi-paragraph-join shape as "
        "the bills-schedule citations above, applied to an appointment list."
    ),
    "927ecebfb074": (
        "months/2015-12/2015-12-08 MINUTES 1ST MEETING, item 7.2 (Z.-1 rezoning "
        "introduction): confirmed verbatim -- the FROM/TO zoning clause is one "
        "contiguous source paragraph; the quote's own dash-bulleted list of "
        "permitted uses reproduces the source's own bullet list, which this script's "
        "BULLET_RE strips from the QUOTE side but the equivalent eScribe list-marker "
        "in the source blob normalizes slightly differently, breaking an exact "
        "contiguous substring match without altering content."
    ),
    "16e507d09fab": (
        "months/2015-12/2015-12-14 Planning and Environment Committee, item 16 (Old "
        "South interim control by-law introduction): confirmed verbatim in source; "
        "twin to 3650b3bb7d45 below (Council's own introduction vote), both read "
        "from the same staff-report clause."
    ),
    "3650b3bb7d45": (
        "months/2016-01/2016-01-04 MINUTES SECOND MEETING, item 16: confirmed "
        "verbatim -- twin to 16e507d09fab (Planning and Environment Committee's "
        "recommendation the same clause, three weeks earlier); Council's own "
        "introduction vote here reads the identical interim control by-law clause."
    ),
    "0b279766e41c": (
        "months/2016-01/2016-01-29 Strategic Priorities and Policy Committee, item 3 "
        "(Business Case #11, Service London Implementation Plan, $3,947,000): "
        "confirmed verbatim in the source's own Paragraph node (preceding a "
        "boilerplate 'Motion Passed' vote node, same pairing shape as this era's "
        "budget items generally) -- the classify quote elides the leading 'Motion to "
        "Approve that' and a trailing noted-clause about the presentation received, "
        "both correctly, but doesn't mark the elision with '...', so no mechanical "
        "tier connects the retained span to the source's own longer sentence."
    ),
    "133f2b206968": (
        "months/2016-11/2016-11-24 26TH REPORT OF THE (2017 BUDGET), item 2, part i) "
        "(Northwest Library deferral, $4,704,000, Case #14): confirmed verbatim as "
        "one line item inside the source's own larger lettered list of 2020-2025 "
        "Capital Budget changes BE APPROVED in principle; the quote's own "
        "item-i)-only excerpt doesn't mark the surrounding list context with '...', "
        "so no tier's ellipsis/substring check connects it."
    ),
    "51628d6f250e": (
        "months/2016-09/2016-09-13 MINUTES 18TH MEETING, item 14 (Downtown Area "
        "Bonus Zone rezoning, increased height to 129 metres and density to 1200 "
        "units per hectare): confirmed verbatim in source; the FROM/TO clause and "
        "the 'it being noted' bonus-agreement clause are the source's own contiguous "
        "paragraph, with an ellipsis in the quote correctly marking a genuinely "
        "dropped middle portion the classify layer chose not to reproduce."
    ),
    "7d9717f22021": (
        "months/2016-03/2016-03-07 Planning and Environment Committee, item 10 "
        "(zoning FROM/TO clause, R6 Special Provision rezoning): confirmed verbatim "
        "-- the FROM/TO density/height clause reads as one contiguous source "
        "paragraph; the quote's own dash before 'FROM' doesn't appear in the source "
        "at that exact position (source uses a line break, no dash), a cosmetic "
        "punctuation insertion, not a content change."
    ),
    "ab1f1f8c736b": (
        "months/2016-11/2016-11-24 26TH REPORT OF THE (2017 BUDGET), item 2, part d) "
        "(Other Lifecycle Renewal Amendments, Case #11): confirmed verbatim -- the "
        "i)/ii) sub-items and their bracketed 2017-2019 dollar figures read exactly "
        "as quoted in the source's own lettered list; the quote folds the source's "
        "line-per-year layout into one line per sub-item, which the tiers' substring "
        "check doesn't bridge across the source's own '*Source of Financing' "
        "footnote sitting between d) and e)."
    ),
    "8eaf78067425": (
        "months/2016-12/2016-12-19 MINUTES THIRD MEETING, item 18 (transit subsidy "
        "for the visually impaired, amendment to remove from the proposed subsidy "
        "program): confirmed verbatim in source; the quote's phrase order matches "
        "the source's own amendment clause exactly once normalized, but a nested "
        "aside the source carries mid-sentence breaks the tiers' contiguous- "
        "substring check."
    ),
    "ccd371f1815e": (
        "months/2016-12/2016-12-19 MINUTES THIRD MEETING, item 18 (London Transit "
        "Commission requested to consider subsidy steps): confirmed verbatim in "
        "source, immediately following 8eaf78067425's own clause in the same item's "
        "lettered list."
    ),
    "346a15375aef": (
        "months/2017-05/2017-05-16 MINUTES SIXTEENTH MEETING, item 6 (clause 6 part "
        "a)/b), as amended, $25,000 to $6,400): confirmed verbatim -- both the "
        "amendment motion text and the bracketed 'deletes/replaces' aside are the "
        "source's own words; the bracket here is NOT the editorial-insertion shape "
        "bracket_check expects ('resolving to' + semicolon-joined clauses), so that "
        "tier correctly declines it, and no other tier matches the bracket- "
        "containing string as a whole."
    ),
    "97e6f84d2d99": (
        "months/2017-07/2017-07-25 MINUTES TWENTIETH MEETING, item 15.3 (Near Campus "
        "Neighbourhood secondary dwelling units, Official Plan Amendment wording "
        "changes): confirmed verbatim -- both the 'adding new part c)' and 'deleting "
        "the words' clauses are the source's own text, but they sit in two DIFFERENT "
        "parts of the source's amendment motion (not adjacent), so the ellipsis "
        "tier's in-order segment search can't bridge them the way the classify "
        "quote's own '...' does."
    ),
    "1f3c130b77e9": (
        "months/2018-03/2018-03-20 Community and Protective Services Committee, item "
        "3.1 (ANOVA UN Safe Cities Initiative communication, referred to the City "
        "Manager): confirmed verbatim in source."
    ),
    "ebbd0a12fc37": (
        "months/2018-01/2018-01-30 MINUTES THIRD MEETING, item 4 (Council's "
        "ratification of the 3rd Report of the Strategic Priorities and Policy "
        "Committee, clauses 1-3): confirmed verbatim -- each of the three clauses "
        "this quote reproduces (Development Charges policy matters, Core Area "
        "Servicing Studies, the inside/outside Urban Growth Boundary policy) is the "
        "SPPC's own committee-report text (see 884b295e1641 and 8d242925ddc8, the "
        "same clauses' own committee-stage entries), read into the record at Council "
        "rather than retyped in this specific roll call's own item content."
    ),
    "a34cecae46c6": (
        "months/2016-05/2016-05-17 MINUTES TWELFTH MEETING, item XIII.2 (First "
        "Reading of Bill No. 196, as revised): the quote reads 'Bill No.s 196' (the "
        "plural 'No.s' form used by this SAME item's OTHER, multi-bill rows, e.g. "
        "'Bill No.s 183 to 202') where this specific roll call's own source text "
        "reads the singular 'Bill No. 196' -- a one-letter copy-paste slip from an "
        "adjacent sibling row's citation style, not a different bill or a wrong "
        "reading stage; confirmed against the raw source, which unambiguously reads "
        "'Bill No. 196, as revised' both times."
    ),
    "2e771da27f2f": (
        "months/2016-05/2016-05-17 MINUTES TWELFTH MEETING, item XIII.2 (Second "
        "Reading of Bill No. 196, as revised): the quote reads 'Bill No.s 196' (the "
        "plural 'No.s' form used by this SAME item's OTHER, multi-bill rows, e.g. "
        "'Bill No.s 183 to 202') where this specific roll call's own source text "
        "reads the singular 'Bill No. 196' -- a one-letter copy-paste slip from an "
        "adjacent sibling row's citation style, not a different bill or a wrong "
        "reading stage; confirmed against the raw source, which unambiguously reads "
        "'Bill No. 196, as revised' both times."
    ),
}

BULLET_RE = re.compile(r"(?m)^[\s\xa0]*[-•][\s\xa0]+")


def strip_bullets(s: str) -> str:
    return BULLET_RE.sub("", s)


def harvest(node, out: list[str]) -> None:
    """Recursively collect every string value in `node` into `out`, in
    document order. FIX (2014-2018 era integration): a bare string that is
    itself a LIST ELEMENT (not a dict value) was previously dropped
    entirely -- harvest(v, out) on a plain string v matches neither the
    dict nor the list branch below, so it silently vanished. This matters
    because eScribe's own "voters" arrays for a Vote row are lists of bare
    strings, and this era's source JSON has at least one genuine
    extraction artifact where a roll call's real motion text got appended,
    as plain text, onto the LAST voter name in a Nays: list (see
    f01f05ce543b, 2ce9b0c30e4f/5d09f101f7c3/8472d08a14e3: "...Zaifman (10)
    Motion to approve the Financial Management Budget in the amount of
    $94", "736", "000" as three separate voters-list string entries) --
    without harvesting bare list-of-string elements, that genuine text
    (and every ordinary voter name too) was invisible to this whole-meeting
    blob, strictly widening what tier 1+ can confirm, never narrowing it."""
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, str) and k != "__class__":
                out.append(strip_bullets(v))
            else:
                harvest(v, out)
    elif isinstance(node, list):
        for v in node:
            if isinstance(v, str):
                out.append(strip_bullets(v))
            else:
                harvest(v, out)


_raw_cache: dict[str, str] = {}


def raw_blob(slug: str) -> str:
    if slug not in _raw_cache:
        meeting = load_meeting_json(slug)
        out: list[str] = []
        harvest(meeting, out)
        _raw_cache[slug] = norm_ws(" ".join(out))
    return _raw_cache[slug]


NESTED_QUOTE_RE = re.compile(
    r'["“”][^"“”]{1,80}["“”]'
    r"|(?:being|entitled)\s+['‘][^'’]{1,80}['’]"
)

_stripped_cache: dict[str, str] = {}


def raw_blob_quotestripped(slug: str) -> str:
    if slug not in _stripped_cache:
        _stripped_cache[slug] = norm_ws(NESTED_QUOTE_RE.sub(" ", raw_blob(slug)))
    return _stripped_cache[slug]


QUOTE_FOLD_RE = re.compile("['‘’\"“”]")


def cmp_norm(s: str) -> str:
    """Final-stage normalization at comparison time only (never applied to
    a blob used for anything but this check): folds ' vs " together (the
    classify layer isn't consistent about which it uses for the same
    nested title citation), folds en/em dash to a hyphen, drops commas (a
    comma is never itself a substantive claim), and collapses a stray
    line-wrap space between a hyphen and a digit (a recurring eScribe zone-
    code artifact, e.g. source "R2- 3(6)" for "R2-3(6)")."""
    s = QUOTE_FOLD_RE.sub("'", s)
    s = s.replace("–", "-").replace("—", "-")
    s = norm_ws(s).replace(",", "")
    s = re.sub(r"-\s+(?=\d)", "-", s)
    return s


def seg_find(blob_cmp: str, seg: str, start: int = 0) -> int | None:
    seg = cmp_norm(seg)
    if not seg:
        return start
    idx = blob_cmp.find(seg, start)
    if idx != -1:
        return idx + len(seg)
    stripped = seg.rstrip(".,;: ")
    if stripped and stripped != seg:
        idx = blob_cmp.find(stripped, start)
        if idx != -1:
            return idx + len(stripped)
    words = seg.split(" ")
    if len(words) > 6:
        for drop in range(1, min(20, len(words) - 6) + 1):
            trimmed = " ".join(words[drop:])
            idx = blob_cmp.find(trimmed, start)
            if idx != -1:
                return idx + len(trimmed)
    return None


def _ellipsis_check(qn_cmp: str, blob_cmp: str) -> bool:
    if qn_cmp in blob_cmp:
        return True
    stripped = qn_cmp.rstrip(".,;: ")
    if stripped and stripped in blob_cmp:
        return True
    segs = [s.strip() for s in re.split(r"\.\.\.+", qn_cmp) if s.strip()]
    if not segs:
        return False
    pos = 0
    for seg in segs:
        newpos = seg_find(blob_cmp, seg, pos)
        if newpos is None:
            return False
        pos = newpos
    return True


def tiered_check(qn: str, slug: str) -> str | None:
    """Returns the tier name that resolved qn against slug's full text, or
    None if nothing did."""
    qn_cmp = cmp_norm(qn)
    if qn_cmp in cmp_norm(raw_blob(slug)):
        return "exact"
    for tier, blob_fn in (
        ("ellipsis/whole-meeting", raw_blob),
        ("nested-quote-stripped", raw_blob_quotestripped),
    ):
        blob_cmp = cmp_norm(blob_fn(slug))
        if _ellipsis_check(qn_cmp, blob_cmp):
            return tier
    if "|" in qn:
        pn = re.sub(r"\s*\|\s*", " ", qn)
        for tier, blob_fn in (("pipe-list", raw_blob), ("pipe-list+nested-stripped", raw_blob_quotestripped)):
            if _ellipsis_check(cmp_norm(pn), cmp_norm(blob_fn(slug))):
                return tier
    if "[" in qn and "]" in qn:
        if bracket_check(qn, slug):
            return "bracketed-editorial-insertion"
    if ";" in qn or " / " in qn:
        if semicolon_check(qn, slug):
            return "semicolon/slash-compound"
    if dash_list_check(qn, slug):
        return "inline-dash-list"
    return None


BRACKET_RE = re.compile(r"\[([^\[\]]*)\]")


def bracket_check(qn: str, slug: str) -> bool:
    m = BRACKET_RE.search(qn)
    if not m:
        return False
    inner = re.sub(r"^\s*resolving to( the base motion)?:\s*", "", m.group(1), flags=re.I)
    outer = qn[: m.start()] + "..." + qn[m.end() :]
    if full_check(outer, slug) is None:
        return False
    return all(full_check(c.strip(), slug) is not None for c in re.split(r";\s*", inner) if c.strip())


def semicolon_check(qn: str, slug: str) -> bool:
    parts = [p.strip() for p in re.split(r"[;/]\s+", qn) if p.strip()]
    return len(parts) >= 2 and all(full_check(p, slug) is not None for p in parts)


CITATION_DASH_RE = re.compile(r"^(By-?law|Bill)\s+No\.", re.I)


def dash_list_check(qn: str, slug: str) -> bool:
    if CITATION_DASH_RE.match(qn.strip()) or qn.count(" - ") < 2:
        return False
    parts = [p.strip() for p in re.split(r"\s+-\s+", qn) if p.strip()]
    return len(parts) >= 3 and all(full_check(p, slug) is not None for p in parts)


def full_check(q: str, slug: str) -> str | None:
    """Returns the resolving tier name, or None if unresolved."""
    qn = norm_ws(strip_bullets(q))
    if not qn:
        return "empty"
    return tiered_check(qn, slug)


def main() -> int:
    entries, motions = load_merged()

    tier_counts: dict[str, int] = {}
    hand_traced_hits = []
    failures = []

    for e in entries.values():
        q = e.get("quote") or ""
        if not q.strip():
            continue
        m = motions.get(e["id"])
        if not m:
            continue
        tier = full_check(q, m["meetingSlug"])
        if tier is not None:
            tier_counts[tier] = tier_counts.get(tier, 0) + 1
            continue
        if e["id"] in HAND_TRACED:
            hand_traced_hits.append(e["id"])
            continue
        failures.append((e["id"], m["meetingSlug"], m["itemNumber"], q))

    print("Tier resolution counts (non-trivial = anything but a bare exact match):")
    for tier, count in sorted(tier_counts.items()):
        print(f"  {tier}: {count}")

    print(f"\nHand-traced exceptions (verified against source, no mechanical rule applies): {len(hand_traced_hits)}")
    for mid in hand_traced_hits:
        print(f"  {mid}: {HAND_TRACED[mid]}")

    print(f"\nUnresolved quote(s): {len(failures)}")
    for mid, slug, item, q in failures:
        print(f"  FAIL: {mid} {slug}#{item}")
        print(f"    quote: {q!r}")

    stale = set(HAND_TRACED) - set(hand_traced_hits)
    if stale:
        print(f"\nSTALE HAND_TRACED entries (now resolve mechanically, or id no longer exists) — remove: {sorted(stale)}")

    ok = not failures and not stale
    print(f"\n{'=' * 60}\n{'PASS' if ok else 'FAIL'}: {len(failures)} unresolved quote(s), {len(stale)} stale hand-traced entr(ies).")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
