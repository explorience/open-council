"""
Parser for 2011-2017 meeting minutes in Microsoft Word HTML export format.

These older meetings use a completely different HTML structure than the modern
eScribe format (2018+). They are Word HTML exports with MsoNormal paragraphs
and simple tables instead of structured div classes.

This parser creates the SAME class instances (MeetingItem, Motion, Mover, Vote, etc.)
as the eScribe parser, ensuring the JSON output is indistinguishable across all years.

SCOPE DISCLOSURE (issue #199 d2, verification finding): the recovery
re-scrape run against this fixed parser (recovery_scrape.py) covers only
the ~150 pre-2018 COUNCIL meetings - it does NOT cover pre-2018 COMMITTEE
meetings, which are the majority of pre-2018 motions. Boilerplate
("Motion Passed/Failed/Carried", or empty) motionText share in the
committed data/votes as of this fix: pre-2018 COUNCIL 2014-2017 dropped
from ~98% to 9.1-16.2% (genuinely fixed by this parser's _attach_content
merge); pre-2018 COMMITTEE stayed at 98.8-99.9% (thousands of stored
motions per year, still on the old, never-rescraped data). isProcedural()
in generate-votes.ts therefore still has no real motion text to match
against for the large majority of pre-2018 records - a full committee
recovery re-scrape is a separate, not-yet-scheduled follow-up, not
something this parser fix alone completes.
"""

import re
from datetime import datetime
from bs4 import BeautifulSoup, NavigableString
from callout import callout
from content import Content, Paragraph, Motion, Vote, MotionResult, Mover, Bills, BILL_TEXT


# A vote/result block that lands OUTSIDE any table - e.g. the closed-session
# "rise and report" pattern where a whole slate of in-camera items is voted
# on as bare paragraphs instead of inside a <td> - always opens with the
# result line and is immediately followed by one or more YEAS:/NAYS:/etc.
# rows. See parse_agenda_structure's stray-paragraph state machine.
VOTE_RESULT_START_RE = re.compile(r'^Motion\s+(Passed|Failed|Carried)\b', re.IGNORECASE)
VOTE_ROW_CONTINUATION_RE = re.compile(r'^(YEAS?|NAYS?|ABSENT|RECUSED?|ABSTAIN(?:ED)?|CONFLICT)S?\s*:', re.IGNORECASE)

# Pre-2018 minutes split a single roll call across two adjacent Motion
# objects: one holding the real motion text with no vote, the next holding
# the vote whose own motion_texts is just this boilerplate result echo. A
# motion whose text is exactly this (nothing else) is the tell that it's
# the vote-bearing half of that split and needs the real text merged in -
# see _attach_content's look-behind merge and issue #199 (d2).
BOILERPLATE_RESULT_TEXT_RE = re.compile(r'^Motion\s+(Passed|Failed|Carried)(\s*\([^)]*\))?\.?$', re.IGNORECASE)

# Procedural narration (someone entering/leaving the meeting, a recess)
# that can immediately precede a boilerplate vote block purely by document
# position, with no actual relationship to what was voted on. Without this
# check, _attach_content's Paragraph look-behind merge would attach this
# narration AS the motion text (issue #199 d10 - e.g. 2012-09-18 item 11#2,
# an 11-nay-voter genuinely divided motion, ended up with motionText
# "Councillor S.E. White enters the meeting at 7:54 PM." instead of what
# was actually being voted on).
NARRATIVE_PARAGRAPH_RE = re.compile(
    r'\b(enters?|leaves?|left)\s+the\s+meeting\b|\brecess(es|ed)?\b|\breconven(e|es|ed)\b',
    re.IGNORECASE
)


# Minimal MeetingItem class to avoid circular import while maintaining JSON compatibility
class MeetingItem:
    """Minimal MeetingItem for Word format meetings - matches eScribe format in JSON."""
    def __init__(self):
        self.title = None
        self.number = ""
        self.content = []
        self.items = {}
        self.datetime = None
        self.attachments = []
        self.report = None

    @classmethod
    def from_plain_data(cls, number, title, content=None, items=None):
        """Create a MeetingItem from plain data."""
        item = cls()
        item.number = number
        item.title = title
        item.content = content or []
        item.items = items or {}
        return item

    def format_markdown(self, level, number_prefix):
        """Format as markdown."""
        output = ""

        # Build number prefix: "" -> "I." -> "I.1" etc
        empty_prefix = number_prefix == ""
        if number_prefix and number_prefix[-1] != ".": number_prefix += "."
        number_prefix += self.number
        if empty_prefix: number_prefix += "."

        output += f"{'#'*level} {number_prefix}&nbsp;&nbsp;&nbsp;{self.title}\n\n"

        # Output content
        if self.content:
            for item in self.content:
                if hasattr(item, 'format_markdown'):
                    output += f"{item.format_markdown()}\n\n"
                else:
                    output += f"{item}\n\n"

        # Output subitems
        for subitem in self.items.values():
            output += subitem.format_markdown(level+1, number_prefix)

        return output


class WordMeeting:
    def __init__(self, soup, url, meeting_type, fallback_date=None):
        self.url = url
        self.meeting_type = meeting_type
        self.bills = None
        self.present = []
        self.also_present = []
        self.remote_attendance = []
        self.absent = []

        # Find the WordSection div
        word_section = soup.find('div', class_=lambda x: x and 'WordSection' in str(x))
        if not word_section:
            # Fallback: use body if no WordSection
            word_section = soup.find('body')

        # Get all paragraphs and tables
        self.paragraphs = word_section.find_all('p') if word_section else []
        self.paragraphs = [p for p in self.paragraphs if p.get_text().strip()]

        self.tables = word_section.find_all('table') if word_section else []

        # Parse meeting info
        self.title = self.extract_title()
        self.datetime = self.extract_datetime(fallback_date)
        self.extract_attendance()

        # Parse content and items
        self.content = self.extract_opening_content()
        self.items = self.parse_agenda_structure(word_section)
        self._dedupe_repeated_vote_blocks()

        # Scrape-time guardrail (issue #199 guardrail a): a re-scrape that
        # silently drops (or duplicates) roll calls must fail loudly instead
        # of shipping a quietly mis-counted meeting. Only meaningful when
        # there's a document to check against.
        if word_section is not None:
            self.assert_vote_coverage(word_section)

        # Remove BeautifulSoup objects to avoid circular references in JSON serialization
        del self.paragraphs
        del self.tables

    def extract_title(self):
        """Extract meeting title from first few paragraphs."""
        # Usually in format: "Council", "MINUTES", "3RD MEETING" or similar
        title_parts = []
        for i, p in enumerate(self.paragraphs[:10]):
            # Replace newlines with spaces and normalize whitespace
            text = ' '.join(p.get_text().split())
            # Stop at date line (contains comma and number)
            if re.search(r'\w+\s+\d{1,2},\s+\d{4}', text):
                break
            if text and text.upper() == text and len(text) < 50:
                title_parts.append(text)

        if len(title_parts) >= 2:
            # Usually "Council MINUTES 3RD MEETING" or similar
            return ' '.join(title_parts)
        return self.meeting_type

    def extract_datetime(self, fallback_date):
        """Extract date and time from meeting text.

        Uses fallback_date (from server API) as the authoritative date source,
        since document text often contains incorrect dates from referenced meetings.
        Only extracts time from the document if available.
        """
        # Use fallback_date as the primary date source (it's from the server API)
        if fallback_date:
            base_date = fallback_date.replace(hour=0, minute=0, second=0, microsecond=0)

            # Try to extract time from document text
            for p in self.paragraphs[:15]:
                text = p.get_text().strip()
                time_match = re.search(r'(\d{1,2}):(\d{2})\s*(AM|PM)', text, re.IGNORECASE)
                if time_match:
                    hour = int(time_match.group(1))
                    minute = int(time_match.group(2))
                    am_pm = time_match.group(3).upper()
                    if am_pm == 'PM' and hour != 12:
                        hour += 12
                    elif am_pm == 'AM' and hour == 12:
                        hour = 0
                    return base_date.replace(hour=hour, minute=minute)

            return base_date

        # No fallback date - try to extract from document text (legacy behavior)
        date_pattern = r'(\w+)\s+(\d{1,2}),\s+(\d{4})'
        for p in self.paragraphs[:15]:
            text = p.get_text().strip()
            match = re.search(date_pattern, text)
            if match:
                try:
                    date_str = match.group(0)
                    parsed_date = datetime.strptime(date_str, "%B %d, %Y")

                    time_match = re.search(r'(\d{1,2}):(\d{2})\s*(AM|PM)', text, re.IGNORECASE)
                    if time_match:
                        hour = int(time_match.group(1))
                        minute = int(time_match.group(2))
                        am_pm = time_match.group(3).upper()
                        if am_pm == 'PM' and hour != 12:
                            hour += 12
                        elif am_pm == 'AM' and hour == 12:
                            hour = 0
                        return parsed_date.replace(hour=hour, minute=minute)

                    return parsed_date
                except:
                    pass

        return datetime.now()

    def extract_attendance(self):
        """Extract present, absent, and also present from paragraphs."""
        for p in self.paragraphs[:30]:  # Usually in first 30 paragraphs
            text = p.get_text().strip()

            # PRESENT: Mayor X and Councillors Y, Z, ...
            if text.upper().startswith('PRESENT:'):
                self.present = self.parse_names(text.replace('PRESENT:', '').strip())

            # ALSO PRESENT: Names...
            elif text.upper().startswith('ALSO PRESENT:'):
                self.also_present = self.parse_names(text.replace('ALSO PRESENT:', '').strip())

            # ABSENT: or "except Councillors..."
            elif 'ABSENT' in text.upper() or 'except Councillor' in text:
                # Extract names after "except" or "ABSENT:"
                if 'except' in text.lower():
                    names_part = re.split(r'except\s+Councillors?', text, flags=re.IGNORECASE)
                    if len(names_part) > 1:
                        self.absent = self.parse_names(names_part[1])
                elif 'ABSENT:' in text.upper():
                    self.absent = self.parse_names(text.replace('ABSENT:', '').strip())

    def parse_names(self, text):
        """Parse names from comma-separated text."""
        # Remove line breaks and extra whitespace
        text = re.sub(r'\s+', ' ', text)

        # Remove titles
        text = (text
            .replace('Mayor', '')
            .replace('Councillors', '')
            .replace('Councillor', '')
            .replace('(Chair)', '')
            .replace('(City Clerk)', '')
            .strip())

        # Split on commas and 'and'
        text = text.replace(' and ', ', ')
        names = [n.strip() for n in text.split(',') if n.strip()]

        # Remove periods and clean up
        names = [re.sub(r'\.$', '', n).strip() for n in names]

        # Filter out empty names and single characters
        return [n for n in names if n and len(n) > 1]

    def extract_opening_content(self):
        """Extract opening content before main agenda items."""
        # Find the paragraph that starts the meeting
        for i, p in enumerate(self.paragraphs):
            text = p.get_text().strip()

            # Look for "The [Meeting Type] meets" or "The meeting is called to order"
            if ('meets in' in text.lower() or
                'called to order' in text.lower() or
                'convenes' in text.lower()):
                return [Paragraph(text)]

        return []

    def parse_agenda_structure(self, word_section):
        """Parse the full agenda structure from tables and paragraphs.

        Walks the section content in true document order (tables AND
        paragraphs interleaved) rather than tables alone, for two reasons
        (see issue #199):

        - A motion's result/vote block is sometimes its own tiny table
          immediately after the table holding the motion's real text
          (the "two adjacent Motion objects" pattern - handled by
          _attach_content's look-behind merge, not here), and sometimes
          it isn't in a table at all: the closed-session "rise and
          report" pattern votes on a whole slate of items as bare
          paragraphs. Both need to land in whichever section is
          currently open, in the order they actually occur.
        - A repeated section number (each committee report embedded in a
          Council meeting restarts its own numbering at 1, 2, 3, ...)
          must not overwrite the earlier section carrying that same
          number - see the `section_occurrence` disambiguation below.
        """
        items = {}
        current_section = None
        section_pattern = re.compile(r'^([IVX]+|[0-9]+\.?)\s*$')  # Roman numerals or numbers
        section_occurrence = {}

        # Buffer for a stray (non-table) vote/result block currently being
        # assembled - see the state machine in the `else` branch below.
        stray_vote_lines = []

        def flush_stray_vote_block():
            nonlocal stray_vote_lines, current_section
            if stray_vote_lines:
                target_section = current_section
                if target_section is None:
                    # A vote can land before the first numbered section
                    # table appears at all - e.g. 2011-12-06 Council votes
                    # on "no disclosures were made" and elects a Vice-Chair
                    # as bare paragraphs ahead of item 1's table. Rather
                    # than silently dropping it, file it under a synthetic
                    # preamble section instead of losing the roll call.
                    target_section = items.get('preamble')
                    if target_section is None:
                        target_section = MeetingItem.from_plain_data('preamble', 'Preamble')
                        items['preamble'] = target_section
                combined_text = ''.join(stray_vote_lines)
                content_items = self.parse_content_block(combined_text)
                self._attach_content(target_section, content_items)
            stray_vote_lines = []

        # Recursive so nested tables (e.g. an embedded committee-report
        # block inside a <td>) are visited too, but each nested table's
        # own <p> children are skipped below (find_parent('table') check)
        # since their text is already captured via the outer cell's
        # get_text(). A nested <table> element itself is likewise skipped
        # when reached directly - it's processed as part of its parent
        # row's cell content, not as a second top-level table.
        for el in word_section.find_all(['table', 'p']):
            if el.name == 'table':
                if el.find_parent('table') is not None:
                    continue  # nested table - handled via the outer cell's get_text()

                flush_stray_vote_block()

                for row in el.find_all('tr'):
                    # Direct children only: a cell that itself contains a
                    # nested table must count as ONE cell here, not the
                    # nested table's own <td>s flattened into this row's
                    # count (that flattening used to make the row's cell
                    # count neither 1 nor 2, silently dropping the whole
                    # row - see 2016-08-30 Council's Debt Management
                    # Policy / Budget Schedule embedded report).
                    cells = row.find_all('td', recursive=False)

                    if len(cells) == 2:
                        first_cell_text = cells[0].get_text().strip()
                        second_cell_text = cells[1].get_text().strip()

                        # Check if first cell is a section marker (Roman numeral or number)
                        match = section_pattern.match(first_cell_text)
                        if match and len(first_cell_text) <= 10:
                            section_num = match.group(1).rstrip('.')

                            # This is a new section - create real MeetingItem.
                            # `.number` always stays the plain original label
                            # (used for display); only the dict key gets
                            # disambiguated so a repeated number doesn't
                            # overwrite (and silently discard the votes of)
                            # the earlier section carrying it.
                            current_section = MeetingItem.from_plain_data(section_num, second_cell_text)
                            occurrence = section_occurrence.get(section_num, 0) + 1
                            section_occurrence[section_num] = occurrence
                            key = section_num if occurrence == 1 else f"{section_num}#{occurrence}"
                            items[key] = current_section
                        elif current_section and bool(first_cell_text) != bool(second_cell_text):
                            # A motion/vote block rendered as (content, "")
                            # or ("", content) instead of the usual
                            # single-cell shape - e.g. 2016-08-30 Council's
                            # "Motion Passed / YEAS: .../ NAYS: ..." rows
                            # put it in the first cell with an empty
                            # second cell; 2011-12-06 Council puts the
                            # same shape of content in the SECOND cell
                            # with an empty first cell. Either way, exactly
                            # one side is blank, so use whichever isn't.
                            content_items = self.parse_content_block(first_cell_text or second_cell_text)
                            self._attach_content(current_section, content_items)

                    # Single-column table: might be content for current section
                    elif len(cells) == 1 and current_section:
                        cell_text = cells[0].get_text().strip()

                        if cell_text:
                            # Check if it's a motion or voting record
                            content_items = self.parse_content_block(cell_text)
                            self._attach_content(current_section, content_items)

            else:  # <p> paragraph
                if el.find_parent('table') is not None:
                    continue  # belongs to a table cell already handled above

                text = el.get_text().strip()

                if stray_vote_lines:
                    if not text or VOTE_ROW_CONTINUATION_RE.match(text):
                        stray_vote_lines.append(text)
                        continue
                    flush_stray_vote_block()
                    # fall through - this paragraph may itself start a new block

                if VOTE_RESULT_START_RE.match(text):
                    stray_vote_lines = [text]

        flush_stray_vote_block()

        return items

    def _attach_content(self, section, content_items):
        """Append parsed content to a section, merging the pre-2018
        "two adjacent objects" split (issue #199, d2): the motion's real
        text lands in a separate preceding object with no vote, and the
        vote lands in the next Motion whose own motion_texts is just a
        boilerplate result echo ("Motion Passed"/"Motion Failed"/"Motion
        Carried"). extractMotionText() in generate-votes.ts only ever sees
        the vote-bearing one, so without this merge every pre-2018 vote
        record stores that boilerplate instead of the real motion text.

        The preceding object is a Motion with no vote when the source used
        explicit "Moved by X..." phrasing; far more commonly (Council
        adopting a committee report recommendation en bloc) it's phrased
        "That, on the recommendation of ... the following actions be
        taken..." with no "Moved by" at all, so parse_content_block
        returns it as a plain Paragraph instead - both shapes are handled
        here.
        """
        for item in content_items:
            if not (isinstance(item, Motion) and item.vote.rows and self._is_boilerplate_motion(item) and section.content):
                section.content.append(item)
                continue

            prev = section.content[-1]
            if isinstance(prev, Motion) and not prev.vote.rows and not self._is_boilerplate_motion(prev):
                section.content.pop()
                item.motion_texts = prev.motion_texts
                if not item.moved_by.string:
                    item.moved_by = prev.moved_by
                if not item.seconded_by.string:
                    item.seconded_by = prev.seconded_by
            elif (
                type(prev) is Paragraph
                and prev.string.strip()
                and not NARRATIVE_PARAGRAPH_RE.search(prev.string)
            ):
                section.content.pop()
                item.motion_texts = [prev]

            section.content.append(item)

    @staticmethod
    def _is_boilerplate_motion(motion):
        combined = ' '.join(p.string for p in motion.motion_texts if getattr(p, 'string', '')).strip()
        return combined == '' or bool(BOILERPLATE_RESULT_TEXT_RE.match(combined))

    def _dedupe_repeated_vote_blocks(self):
        """Drop a vote-bearing Motion that's an exact repeat of one already
        kept elsewhere in this meeting (issue #199 d5/verification).

        Some pre-2018 roll calls get attached to more than one agenda-item
        bucket: a floor amendment gets recorded once under its own
        numbered clause, and again under whatever item happened to still
        be `current_section` when a later stray table (with no section-
        marker first cell of its own) got appended to it - a `current_
        section` staleness bug, not a genuine second vote. Confirmed via
        2015-05-26 Council: "Approve the addition of the following new
        parts c) and d)..." (same mover, same seconder, same full
        yeas+nays voter rows) is parsed as a vote-bearing Motion under BOTH
        item 12 and item 14 - not two councillors independently wording
        two different amendments identically, the same physical roll call
        attached twice.

        This mirrors the cross-FILE re-publication dedup in generate-
        votes.ts (computeVoteBlockFingerprint) at the within-meeting level:
        normalize away any trailing boilerplate result echo that
        _attach_content's look-behind merge can append (that's exactly why
        the later, buggy copy fails an exact string match against the
        earlier, clean one otherwise), then treat an EXACT match on
        (normalized motion text, mover, seconder, result, full vote rows)
        as the same event and drop every occurrence after the first one
        encountered (self.items iterates in document order, and so does
        each item's own content list, so "first" is chronological). This
        is intentionally narrow - matching on the full voter rows as well
        as the text makes an accidental collision between two truly
        distinct roll calls essentially impossible, unlike matching on
        voters alone (many pre-2018 roll calls are legitimately unanimous
        15-0 with the same standing council and would collide on that
        basis alone).
        """
        seen = set()
        for item in self.items.values():
            kept = []
            for c in item.content:
                if isinstance(c, Motion) and c.vote.rows:
                    signature = self._vote_block_signature(c)
                    if signature and signature in seen:
                        continue  # same physical roll call already kept elsewhere
                    if signature:
                        seen.add(signature)
                kept.append(c)
            item.content = kept

    # Minimum normalized-text length before two vote blocks are trusted as
    # "the same roll call" rather than dismissed as coincidence. Below
    # this, a short/boilerplate/empty motion text is NOT deduped even on a
    # full match.
    MIN_TEXT_LEN_FOR_DEDUPE = 20

    @staticmethod
    def _vote_block_signature(motion):
        # Require a NAMED mover and seconder. A routine phrase like "That
        # it BE NOTED that no pecuniary interests were disclosed." is long
        # enough to clear MIN_TEXT_LEN_FOR_DEDUPE and legitimately recurs
        # verbatim many times in one meeting (once per report section),
        # each time as a genuinely separate roll call, but always through
        # parse_content_block's standalone-voting path (no "Moved by"),
        # so mover/seconder are always empty for it - confirmed as a false
        # positive against 2015-12-08 Council before this guard was added.
        # A floor amendment/motion moved and seconded BY NAME is specific
        # to one real event; requiring both to be present keeps this dedup
        # narrow enough to only catch the actual bug (issue #199 d5/
        # verification: the same named-mover amendment attached twice).
        if not motion.moved_by.string or not motion.seconded_by.string:
            return None

        text = ' '.join(p.string for p in motion.motion_texts if getattr(p, 'string', '')).strip()
        # Strip a trailing boilerplate result echo - _attach_content's
        # look-behind merge can append one to an otherwise-identical
        # earlier motion text (see the class doc comment above).
        text = re.sub(r'\s*Motion\s+(Passed|Failed|Carried)(\s*\([^)]*\))?\.?\s*$', '', text, flags=re.IGNORECASE)
        text = re.sub(r'\s+', ' ', text).strip()
        if len(text) < WordMeeting.MIN_TEXT_LEN_FOR_DEDUPE:
            return None
        vote_rows = tuple((r["vote"], tuple(r["voters"])) for r in motion.vote.rows)
        return (text, motion.moved_by.string, motion.seconded_by.string, motion.result.string, vote_rows)

    def assert_vote_coverage(self, word_section):
        """Scrape-time guardrail (issue #199 guardrail a): count YEAS:
        occurrences in the raw source text and fail loudly if the parsed
        Yeas-row count disagrees in EITHER direction. A silent undercount
        is what let 34-61% of pre-2018 Council roll calls disappear without
        any signal - see the investigation on issue #199. A silent
        OVERcount is just as dangerous a way to fail the same coverage
        promise: it means some physical roll call was parsed into more
        than one stored vote record (issue #199 d5/verification - e.g.
        2015-05-26 Council parses 48 Yeas rows against 45 raw 'YEAS:'
        occurrences, because item '12' and item '14' both attach the same
        physical vote block). Originally one-sided (`parsed <
        raw_count`), which let that overcount ship silently.
        """
        raw_yeas_count = len(re.findall(r'YEAS?:', word_section.get_text(), re.IGNORECASE))
        parsed_yeas_rows = self._count_yea_rows(self.items)

        if parsed_yeas_rows != raw_yeas_count:
            direction = "fewer" if parsed_yeas_rows < raw_yeas_count else "more"
            raise ValueError(
                f"WordMeeting vote-coverage guardrail failed for {self.url}: "
                f"raw source has {raw_yeas_count} 'YEAS:' occurrence(s) but "
                f"{parsed_yeas_rows} Yeas row(s) ({direction}) were parsed. Refusing to "
                f"silently mis-count roll calls - see issue #199 guardrail (a)."
            )

    @staticmethod
    def _count_yea_rows(items):
        count = 0
        for item in items.values():
            for c in item.content:
                if isinstance(c, Motion) and c.vote.rows:
                    count += sum(1 for r in c.vote.rows if r["vote"].lower().startswith("yea"))
        return count

    def parse_content_block(self, text):
        """Parse a content block that might contain motions, voting, or regular text."""
        content = []

        # Check for motion patterns - handle both formats:
        # 1. "Moved by X and seconded by Y that..."
        # 2. "Motion made by X and seconded by Y to..."
        # `\s+` (not a literal space) between the words of "Moved by" /
        # "Motion made by": Word's line-wrapped export puts a real
        # newline+indent at whatever column the wrap lands on, and it
        # sometimes lands mid-phrase ("Motion\n  made by ..." - see
        # 2011-12-06 Council). A literal-space match would silently miss
        # the motion entirely and fall through to the no-attribution
        # standalone-vote branch below.
        motion_match = re.search(
            r'(?:Moved\s+by|Motion\s+made\s+by)\s+(.+?)(?:\s+and\s+)?(?:seconded\s+by\s+(.+?))?\s+(?:that|to)\s+',
            text, re.IGNORECASE | re.DOTALL
        )

        if motion_match:
            # This block contains a motion
            moved_by = motion_match.group(1).strip()
            seconded_by = motion_match.group(2).strip() if motion_match.group(2) else ""

            # Format moved_by/seconded_by text to match eScribe format
            if moved_by and not moved_by.lower().startswith('moved by'):
                moved_by = f"Moved by {moved_by}"
            if seconded_by and not seconded_by.lower().startswith('seconded by'):
                seconded_by = f"Seconded by {seconded_by}"

            # A single table cell can (rarely) hold more than one motion
            # back to back - e.g. 2011-12-06 Council: "Moved by ... to
            # Amend clause 2 ... Motion Passed YEAS: ... Moved by ... to
            # refer clause 2 ...". Scope this motion's own text/vote/
            # result extraction to stop before any subsequent "Moved by"/
            # "Motion made by" in the same cell, so the second motion's
            # text (and its own vote, found below) isn't silently
            # swallowed into this one's motion_text.
            next_motion_match = re.search(
                r'(?:Moved\s+by|Motion\s+made\s+by)\s+', text[motion_match.end():], re.IGNORECASE
            )
            scope_end = motion_match.end() + next_motion_match.start() if next_motion_match else len(text)
            scoped_text = text[:scope_end]
            remainder_text = text[scope_end:] if next_motion_match else ""

            # Extract motion text (everything after "that" or "to")
            motion_start = motion_match.end()
            motion_text = scoped_text[motion_start:].strip()

            # Look for vote and result in the remaining text
            vote_rows = []
            result = ""

            # Extract YEAS - match across multiple lines until we hit NAYS or Motion result
            yeas_match = re.search(r'YEAS?:\s*(.+?)(?=(?:NAYS?:|Motion\s+(?:Passed|Failed|Carried)|$))',
                                  scoped_text, re.IGNORECASE | re.DOTALL)
            if yeas_match:
                yeas_text = yeas_match.group(1).strip()
                yeas_names = self.parse_names(yeas_text)
                if yeas_names:  # Only add if we got valid names
                    vote_rows.append({"vote": "Yeas:", "voters": yeas_names})
                # Remove YEAS from motion text
                motion_text = scoped_text[motion_start:yeas_match.start()].strip()

            # Extract NAYS - match across multiple lines until we hit Motion result or end
            nays_match = re.search(r'NAYS?:\s*(.+?)(?=(?:Motion\s+(?:Passed|Failed|Carried)|$))',
                                  scoped_text, re.IGNORECASE | re.DOTALL)
            if nays_match:
                nays_text = nays_match.group(1).strip()
                nays_names = self.parse_names(nays_text)
                if nays_names:  # Only add if we got valid names
                    vote_rows.append({"vote": "Nays:", "voters": nays_names})

            # Extract result
            result_match = re.search(r'Motion\s+(Passed|Failed|Carried)(\s+\([^)]+\))?', scoped_text, re.IGNORECASE)
            if result_match:
                result = result_match.group(0)

            # Create real Motion instance
            motion = Motion.from_plain_data(moved_by, seconded_by, motion_text, vote_rows, result)
            content.append(motion)

            if remainder_text.strip():
                content.extend(self.parse_content_block(remainder_text))

        # Check for standalone voting (no "Moved by" or "Motion made by")
        elif re.search(r'YEAS?:', text, re.IGNORECASE):
            vote_rows = []
            result = ""

            # Extract YEAS - match across multiple lines
            yeas_match = re.search(r'YEAS?:\s*(.+?)(?=(?:NAYS?:|Motion\s+(?:Passed|Failed|Carried)|$))',
                                  text, re.IGNORECASE | re.DOTALL)
            if yeas_match:
                yeas_text = yeas_match.group(1).strip()
                yeas_names = self.parse_names(yeas_text)
                if yeas_names:
                    vote_rows.append({"vote": "Yeas:", "voters": yeas_names})

            # Extract NAYS - match across multiple lines
            nays_match = re.search(r'NAYS?:\s*(.+?)(?=(?:Motion\s+(?:Passed|Failed|Carried)|$))',
                                  text, re.IGNORECASE | re.DOTALL)
            if nays_match:
                nays_text = nays_match.group(1).strip()
                nays_names = self.parse_names(nays_text)
                if nays_names:
                    vote_rows.append({"vote": "Nays:", "voters": nays_names})

            # Extract result
            result_match = re.search(r'Motion\s+(Passed|Failed|Carried)(\s+\([^)]+\))?', text, re.IGNORECASE)
            if result_match:
                result = result_match.group(0)

            # Get text before voting as motion text
            motion_text = text[:yeas_match.start() if yeas_match else 0].strip()

            # Only create motion if we have vote data
            if vote_rows:
                motion = Motion.from_plain_data("", "", motion_text, vote_rows, result)
                content.append(motion)
            else:
                # No valid vote data, treat as regular paragraph
                if text and text != "None." and len(text) > 3:
                    content.append(Paragraph(text))

        # Regular paragraph
        else:
            if text and text != "None." and len(text) > 3:
                content.append(Paragraph(text))

        return content

    def format_markdown(self):
        """Format as markdown for output."""
        output = ""
        output += "---\n"
        output += f"title: {self.title or self.meeting_type}\n"
        output += f"date: {self.yyyy_mm_dd()}\n"
        output += "---\n"

        # Date and time
        output += "{d:%B} {d.day}, {d.year}".format(d=self.datetime)
        if self.datetime.hour > 0 or self.datetime.minute > 0:
            output += ", at {d:%l}:{d.minute:02} {d:%p}".format(d=self.datetime)
        output += "\n\n"

        output += f"[Original link]({self.url})\n\n"

        # Attendance
        if self.present:
            output += f"{callout('Present:', ', '.join(self.present))}\n\n"
        if self.absent:
            output += f"{callout('Absent:', ', '.join(self.absent))}\n\n"
        if self.also_present:
            output += f"{callout('Also Present:', ', '.join(self.also_present))}\n\n"

        # Opening content
        if self.content:
            for item in self.content:
                output += f"{item.format_markdown()}\n\n"

        # Agenda items
        for item in self.items.values():
            output += item.format_markdown(1, "")

        # Bills if present
        if self.bills:
            output += f"# Appendix: New Bills\n\n"
            output += self.bills.format_markdown() + "\n\n"

        return output

    def yyyy_mm(self):
        return self.datetime.strftime("%Y-%m")

    def yyyy_mm_dd(self):
        return self.datetime.strftime("%Y-%m-%d")

    def format_title(self):
        return f"{self.yyyy_mm_dd()} {self.title or self.meeting_type}"
