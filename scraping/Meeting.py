from callout import callout
from content import Content
from datetime import datetime
from MeetingItem import MeetingItem


class Meeting:
  def __init__(self, soup, url):
    self.title = soup.find(class_="AgendaMeetingNumberText").contents[0]
    self.datetime = self.get_time(soup.find("time"))
    self.url = url

    self.present = []
    self.also_present = []
    self.remote_attendance = []
    self.content = []
    self.add_attendance(soup.find(class_="AgendaHeaderAttendanceTable"))

    self.items = {}
    agenda = soup.find(class_="AgendaItems")
    for container in agenda:
      item = MeetingItem(container)
      self.items[item.number] = item

  def get_time(self, elt):
    """
    <time datetime="2025-06-24 13:00">
      ...
    </time>
    """
    return datetime.strptime(elt["datetime"], "%Y-%m-%d %H:%M")

  def add_attendance(self, agenda_header_attendance_table):
    [present, extra] = agenda_header_attendance_table.contents
    self.add_present(present.find("ul"))
    [also_present, remote_attendance, content] = extra.find("li").find_all("p")
    self.add_also_present(also_present)
    self.add_remote_attendance(remote_attendance)
    self.add_content(content)

  def add_present(self, ul):
    for li in ul.contents:
      # <li>Mayor J. Morgan,&nbsp;</li>
      # <li> and S. Hillier&nbsp;</li>
      self.present.append(li.contents[0].replace(",", "").replace("and", "").strip())

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
    """
    self.content = Content.parse_content(content)

  def format_markdown(self):
    output = ""
    output += "---\n"
    output += f"title: {self.title}\n\n"
    output += "---\n"

    output += f"# {self.title}\n\n"
    output += "{d:%B} {d.day}, {d.year}, at {d:%l}:{d.minute:02} {d:%p}\n\n".format(d=self.datetime)
    output += f"[Original link]({self.url})\n\n"

    output += f"{callout('Present:', ', '.join(self.present))}\n\n"
    output += f"{callout('Also Present:', ', '.join(self.also_present))}\n\n"
    output += f"{callout('Remote Attendance:', ', '.join(self.remote_attendance))}\n\n"

    output += f"{self.content.format_markdown()}\n\n"

    for item in self.items.values():
      output += item.format_markdown(2, "")
    return output

  def yyyy_mm(self):
    return "{d.year}-{d.month:02}".format(d=self.datetime)

  def format_title(self):
    return "{d.year}-{d.month:02}-{d.day:02}".format(d=self.datetime) + " " + self.title
