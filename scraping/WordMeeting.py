"""
Parser for 2011-2017 meeting minutes in Microsoft Word HTML export format.

These older meetings use a completely different HTML structure than the modern
eScribe format (2018+). They are Word HTML exports with MsoNormal paragraphs
and simple tables instead of structured div classes.
"""

import re
from datetime import datetime
from bs4 import BeautifulSoup, NavigableString
from callout import callout
from content import Content, Paragraph


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

        # Get all paragraphs
        paragraphs = word_section.find_all('p') if word_section else []
        self.paragraphs = [p for p in paragraphs if p.get_text().strip()]

        # Parse meeting info
        self.title = self.extract_title()
        self.datetime = self.extract_datetime(fallback_date)
        self.extract_attendance()

        # Parse content and items
        self.content = self.extract_opening_content()
        self.items = {}  # Will be populated by parsing sections

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
        """Extract date and time from meeting text."""
        # Look for date pattern: "December 18, 2014"
        date_pattern = r'(\w+)\s+(\d{1,2}),\s+(\d{4})'

        for p in self.paragraphs[:15]:
            text = p.get_text().strip()
            match = re.search(date_pattern, text)
            if match:
                try:
                    date_str = match.group(0)
                    parsed_date = datetime.strptime(date_str, "%B %d, %Y")

                    # Try to extract time from same or next paragraph
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

                    # No time found, return date at midnight
                    return parsed_date
                except:
                    pass

        # Fallback to provided date
        if fallback_date:
            return fallback_date.replace(hour=0, minute=0, second=0, microsecond=0)

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
                # Create a simple content object with just the text
                class SimpleContent:
                    def __init__(self, text):
                        self.text = text
                    def format_markdown(self):
                        return self.text

                return [SimpleContent(text)]

        return []

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

        # Note about limited parsing
        output += "> [!note]\n"
        output += "> This meeting uses the older Word HTML format (2011-2017).\n"
        output += "> Detailed item parsing is not yet implemented for this format.\n"
        output += "> Please refer to the original link above for full meeting details.\n\n"

        return output

    def yyyy_mm(self):
        return self.datetime.strftime("%Y-%m")

    def yyyy_mm_dd(self):
        return self.datetime.strftime("%Y-%m-%d")

    def format_title(self):
        return f"{self.yyyy_mm_dd()} {self.title or self.meeting_type}"
