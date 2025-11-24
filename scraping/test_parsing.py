#!/usr/bin/env python3
"""Test script to verify both old and new format parsing works."""

from bs4 import BeautifulSoup
from datetime import datetime
import sys

# Import detection function from process_meeting
def is_word_format(soup):
    """Detect if this is a Word HTML export (2011-2017) vs eScribe format (2018+)."""
    has_mso = soup.find(class_='MsoNormal') is not None
    has_word_section = soup.find('div', class_=lambda x: x and 'WordSection' in str(x)) is not None
    has_escribe = soup.find(class_='AgendaItems') is not None
    return (has_mso or has_word_section) and not has_escribe

def test_file(filename, expected_format):
    """Test parsing a single file."""
    print(f'\n=== Testing {filename} ===')
    print(f'Expected format: {expected_format}')

    try:
        with open(f'test_samples/{filename}', 'r') as f:
            html = f.read()

        soup = BeautifulSoup(html, 'html.parser')
        is_word = is_word_format(soup)
        detected_format = "Word (2011-2017)" if is_word else "eScribe (2018+)"

        print(f'Detected format: {detected_format}')

        if detected_format != expected_format:
            print(f'❌ FAILED: Expected {expected_format} but detected {detected_format}')
            return False

        # Now test that we can parse it
        if is_word:
            from WordMeeting import WordMeeting
            date_str = filename.split(' - ')[1].replace('.html', '')
            date = datetime.strptime(date_str, '%B %d, %Y')
            meeting = WordMeeting(soup, "test_url", "Council", fallback_date=date)
        else:
            from Meeting import Meeting
            date_str = filename.split(' - ')[1].replace('.html', '')
            date = datetime.strptime(date_str, '%B %d, %Y')
            meeting = Meeting(soup, "test_url", "Council", fallback_date=date)

        print(f'✅ SUCCESS: Parsed successfully')
        print(f'   Title: {meeting.title}')
        print(f'   Date: {meeting.datetime}')
        print(f'   Present: {len(meeting.present)} people')
        print(f'   Items: {len(meeting.items)} agenda items')
        return True

    except Exception as e:
        print(f'❌ ERROR: {e}')
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    print('Testing Meeting Parsers')
    print('='*60)

    tests = [
        ('Council - December 18, 2018.html', 'eScribe (2018+)'),
        ('Council - December 12, 2017.html', 'Word (2011-2017)'),  # 2017 has Word format embedded in eScribe
        ('Council - December 19, 2016.html', 'Word (2011-2017)'),
        ('Council - December 08, 2015.html', 'Word (2011-2017)'),
        ('Council - December 18, 2014.html', 'Word (2011-2017)'),
        ('Council - November 19, 2013.html', 'Word (2011-2017)'),
        ('Planning and Environment Committee - September 24, 2012.html', 'Word (2011-2017)'),
        ('Council - December 06, 2011.html', 'Word (2011-2017)'),
    ]

    results = []
    for filename, expected_format in tests:
        results.append(test_file(filename, expected_format))

    print('\n' + '='*60)
    print(f'SUMMARY: {sum(results)}/{len(results)} tests passed')

    if all(results):
        print('✅ All tests passed!')
        sys.exit(0)
    else:
        print('❌ Some tests failed')
        sys.exit(1)
