"""
Parser for 2011-2017 meeting minutes in Microsoft Word HTML export format.

These older meetings use a completely different HTML structure than the modern
eScribe format (2018+). They are Word HTML exports with MsoNormal paragraphs
and simple tables instead of structured div classes.

This parser creates the SAME class instances (MeetingItem, Motion, Mover, Vote, etc.)
as the eScribe parser, ensuring the JSON output is indistinguishable across all years.
"""

import re
from datetime import datetime
from bs4 import BeautifulSoup, NavigableString
from callout import callout
from content import Content, Paragraph, Motion, Vote, MotionResult, Mover, Bills, BILL_TEXT


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
        self.items = self.parse_agenda_structure()

        # Remove BeautifulSoup objects to avoid circular references in JSON serialization
        del self.paragraphs
        del self.tables

    def extract_title(self):
        """Extract meeting title from first few paragraphs."""
        # Usually in format: "Council", "MINUTES", "3RD MEETING" or similar
        title_parts = []
        for i, p in enumerate(self.paragraphs[:10]):
            text = p.get_text().strip()
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

    def parse_agenda_structure(self):
        """Parse the full agenda structure from tables and paragraphs."""
        items = {}
        current_section = None
        section_pattern = re.compile(r'^([IVX]+|[0-9]+\.?)\s*$')  # Roman numerals or numbers

        # Process tables to find section headers and content
        for table in self.tables:
            rows = table.find_all('tr')

            for row in rows:
                cells = row.find_all('td')

                # Two-column table: might be section header or numbered item
                if len(cells) == 2:
                    first_cell_text = cells[0].get_text().strip()
                    second_cell_text = cells[1].get_text().strip()

                    # Check if first cell is a section marker (Roman numeral or number)
                    match = section_pattern.match(first_cell_text)
                    if match and len(first_cell_text) <= 10:
                        section_num = match.group(1).rstrip('.')

                        # This is a new section - create real MeetingItem
                        current_section = MeetingItem.from_plain_data(section_num, second_cell_text)
                        items[section_num] = current_section

                # Single-column table: might be content for current section
                elif len(cells) == 1 and current_section:
                    cell_text = cells[0].get_text().strip()

                    if cell_text:
                        # Check if it's a motion or voting record
                        content_items = self.parse_content_block(cell_text)
                        current_section.content.extend(content_items)

        return items

    def parse_content_block(self, text):
        """Parse a content block that might contain motions, voting, or regular text."""
        content = []

        # Check for motion patterns - handle both formats:
        # 1. "Moved by X and seconded by Y that..."
        # 2. "Motion made by X and seconded by Y to..."
        motion_match = re.search(
            r'(?:Moved by|Motion made by)\s+(.+?)(?:\s+and\s+)?(?:seconded by\s+(.+?))?\s+(?:that|to)\s+',
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

            # Extract motion text (everything after "that" or "to")
            motion_start = motion_match.end()
            motion_text = text[motion_start:].strip()

            # Look for vote and result in the remaining text
            vote_rows = []
            result = ""

            # Extract YEAS - match across multiple lines until we hit NAYS or Motion result
            yeas_match = re.search(r'YEAS?:\s*(.+?)(?=(?:NAYS?:|Motion\s+(?:Passed|Failed|Carried)|$))',
                                  text, re.IGNORECASE | re.DOTALL)
            if yeas_match:
                yeas_text = yeas_match.group(1).strip()
                yeas_names = self.parse_names(yeas_text)
                if yeas_names:  # Only add if we got valid names
                    vote_rows.append({"vote": "Yeas:", "voters": yeas_names})
                # Remove YEAS from motion text
                motion_text = text[motion_start:yeas_match.start()].strip()

            # Extract NAYS - match across multiple lines until we hit Motion result or end
            nays_match = re.search(r'NAYS?:\s*(.+?)(?=(?:Motion\s+(?:Passed|Failed|Carried)|$))',
                                  text, re.IGNORECASE | re.DOTALL)
            if nays_match:
                nays_text = nays_match.group(1).strip()
                nays_names = self.parse_names(nays_text)
                if nays_names:  # Only add if we got valid names
                    vote_rows.append({"vote": "Nays:", "voters": nays_names})

            # Extract result
            result_match = re.search(r'Motion\s+(Passed|Failed|Carried)(\s+\([^)]+\))?', text, re.IGNORECASE)
            if result_match:
                result = result_match.group(0)

            # Create real Motion instance
            motion = Motion.from_plain_data(moved_by, seconded_by, motion_text, vote_rows, result)
            content.append(motion)

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
