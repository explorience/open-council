from callout import callout
from content import Content
from datetime import datetime
from MeetingItem import MeetingItem
from bs4 import BeautifulSoup, NavigableString


class Meeting:
  def __init__(self, soup, url, meeting_type):
    self.title = soup.find(class_="AgendaMeetingNumberText").contents[0].strip()
    self.datetime = self.get_time(soup.find("time"))
    self.url = url
    self.meeting_type = meeting_type

    self.present = []
    self.also_present = []
    self.remote_attendance = []
    self.content = []
    self.add_attendance(soup.find(class_="AgendaHeaderAttendanceTable"))

    self.items = {}
    agenda = soup.find(class_="AgendaItems")
    for container in agenda:
      item = MeetingItem(container, self.datetime)
      self.items[item.number] = item

  def get_time(self, elt):
    """
    <time datetime="2025-06-24 13:00">
      ...
    </time>
    """
    return datetime.strptime(elt["datetime"], "%Y-%m-%d %H:%M")

  def add_attendance(self, agenda_header_attendance_table):
    present = extra = absent = None
    also_present = remote_attendance = content = None

    if len(agenda_header_attendance_table.contents) == 1:
      # bruh i hate this format, why are these so inconsistent
      stuff = agenda_header_attendance_table.contents[0].contents[1].contents[0].contents[0].contents
      [present, also_present, content] = [elem for elem in stuff if not isinstance(elem, NavigableString)]
    elif len(agenda_header_attendance_table.contents) == 2:
      [present, extra] = agenda_header_attendance_table.contents
    else:
      [present, absent, extra] = agenda_header_attendance_table.contents

    present_list = present.find("ul")
    self.add_present(present_list or present)

    self.absent = []
    if absent: self.add_absent(absent.find("ul"))

    if not content:
      extra_info = extra.find("li").find_all("p")
      if len(extra_info) == 3:
        [also_present, remote_attendance, content] = extra_info
      elif len(extra_info) == 2:
        [also_present, remote_attendance] = extra_info
      else:
        # bare text
        [also_present, remote_attendance, content] = [text for text in extra_info[0].contents if text.name != "br" and text.strip()]
        # we need to wrap them in <p> for the adding functions
        soup = BeautifulSoup("<html></html>", 'html.parser')
        also_present = soup.new_tag("p", string=also_present)
        remote_attendance = soup.new_tag("p", string=remote_attendance)
        content = soup.new_tag("p", string=content)

    if also_present: self.add_also_present(also_present)
    if remote_attendance: self.add_remote_attendance(remote_attendance)
    self.add_content(content)

  def add_present(self, e):
    if e.name == "p":
      # <p>Present: Mayor J. Morgan, Warden B. Ropp, Deputy Warden A. DeViet, Councillors H. McAlister, J. Pribil, and C. Grantham</p>
      self.present = e.contents[0][len("Present: "):].replace("and", "").split(", ")
    else: # <ul>
      for li in e.contents:
        # <li>Mayor J. Morgan,&nbsp;</li>
        # <li> and S. Hillier&nbsp;</li>
        self.present.append(li.contents[0].replace(",", "").replace("and", "").strip())

  def add_absent(self, ul):
    for li in ul.contents:
      self.absent.append(li.contents[0].replace(",", "").replace("and", "").strip())

  def add_also_present(self, also_present):
    """
    <p>
     S. Datars Bere, A. Abraham, A. Barbon, M. Barnes, C. Cooper, S. Corman, K. Dickins, D. Ennett, C. Goodall, A. Hagan, A. Hovius, S. Mathers, H. McNeely, J. Paradis, T. Pollitt, K. Scherr, M. Schulthess, E. Skalski, C. Smith
    </p>
    """
    self.also_present = also_present.contents[0].strip().split(", ")

  def add_remote_attendance(self, remote_attendance):
    """
    <p>
     Remote Attendance: V. Arora, I. Collins, M. Daley, S. Glover, E. Hunt, K. Murray, A. Roseburgh, J. Senese, K. Pawelec, B. Warner, R. Wilcox
    </p>
    """
    self.remote_attendance = remote_attendance.contents[0].strip().replace("Remote Attendance: ", "").split(", ")

  def add_content(self, content):
    """
    <p>
     The meeting is called to order at 1:04 PM; it being noted that Councillor S. Hillier was in remote attendance.
    </p>
    or sometimes nothing, because why not be inconsistent?
    """
    self.content = Content.parse_content(content)

  def format_markdown(self):
    output = ""
    output += "---\n"
    output += f"title: {self.title}\n"
    output += f"date: {self.yyyy_mm_dd()}\n"
    output += "---\n"

    # We don't need to add a title, it's covered by Quartz (ArticleTitle)
    output += "{d:%B} {d.day}, {d.year}, at {d:%l}:{d.minute:02} {d:%p}\n\n".format(d=self.datetime)
    output += f"[Original link]({self.url})\n\n"

    output += f"{callout('Present:', ', '.join(self.present))}\n\n"
    if self.absent != []: output += f"{callout('Absent:', ', '.join(self.absent))}\n\n"
    if self.also_present != []: output += f"{callout('Also Present:', ', '.join(self.also_present))}\n\n"
    if self.remote_attendance != []: output += f"{callout('Remote Attendance:', ', '.join(self.remote_attendance))}\n\n"

    output += f"{self.content.format_markdown()}\n\n"

    for item in self.items.values():
      output += item.format_markdown(1, "")
    return output

  def yyyy_mm(self):
    return self.datetime.strftime("%Y-%m")

  def yyyy_mm_dd(self):
    return self.datetime.strftime("%Y-%m-%d")

  def format_title(self):
    return f"{self.yyyy_mm_dd()} {self.title}"
