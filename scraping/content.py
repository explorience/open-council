import re
from callout import callout
from bs4 import NavigableString

class Content:
  def __init__(self):
    pass

  def format_markdown(self):
    return ""

  def is_empty(self):
    return True

  @staticmethod
  def parse_content(e):
    # order is important - see commentary in Bill class
    if Bill.is_bill(e):
      return Bill(e)
    if e.name == "p":
      return Paragraph(e)
    if not e.has_attr("class"):
      return Content()
    if "MotionVoters" in e["class"]:
      return Vote(e)
    if "MotionResult" in e["class"]:
      return MotionResult(e)
    if "MovedBy" in e["class"] or "SecondedBy" in e["class"]:
      return Mover(e)
    return Content()

  @staticmethod
  def parse_contents(content_row):
    if not content_row: return []

    content = []
    for e in content_row.find_all(True):
      c = Content.parse_content(e)
      if not c.is_empty():
        content.append(c)

    return content


class Paragraph(Content):
  def __init__(self, e):
    self.string = self.get_text(e)

    # convert lists to markdown
    self.string = self.string.replace("•", "-")
    self.string = self.string.replace("·", "-")

  @staticmethod
  def get_text(e):
    output = ""
    for c in e.contents:
      if isinstance(c, NavigableString):
        output += c
      elif c.name in ["em", "span", "strong", "sup"]:
        output += c.contents[0]
      elif c.name == "br":
        output += "\n\n"
    return output

  def format_markdown(self):
    return self.string

  def is_empty(self):
    return self.string == ""


class MotionResult(Paragraph):

  @staticmethod
  def get_text(e):
    if len(e.contents) == 1:
      if len(e.contents[0]) == 0:
        # <div class="MotionResult"><br/></div>
        return ""

      # <div class="MotionResult"><br>Motion Passed (15 to 0)</br></div>
      return e.contents[0].contents[0]

    # <div class="MotionResult"><br/>Motion Passed (15 to 0)</div>
    return e.contents[1]

  def format_markdown(self):
    return f"> **{super().format_markdown()}**"


# moved by, seconded by
class Mover(Paragraph):

  @staticmethod
  def get_text(e):
    """
      <div class="MovedBy">
       <span class="Label">
        Motion made by:
       </span>
       <span class="Value">
        P. Cuddy
       </span>
      </div>
    """
    # remove colon
    return f"{e.find(class_='Label').contents[0][:-1]} {e.find(class_='Value').contents[0]}"

  def format_markdown(self):
    return f"> {super().format_markdown()}"


bill_name_regex = re.compile("^Bill No. \\d+$")
bill_desc_regex = re.compile("^By-law No. ")
class Bill(Content):

  """
  When grouping bill, each one is counted twice because of the HTML layout, once for each <p>.
  Then, we set each description <p> to empty, so that it will be filtered out
  We need to do it this way because parse_content will categorize all <p>s as text, and we
  don't want it to could each <p> in a bill as a Paragraph in addition to the bill being parsed
  """

  @staticmethod
  def is_bill(e):
    if e.name != "p": return False
    if len(e.contents) == 0: return False
    s = e.contents[0]
    if s.name != "strong": return False
    if not bill_name_regex.match(s.contents[0]) and not bill_desc_regex.match(s.contents[0]): return False
    return True

  def __init__(self, p):
    tr = p.parent.parent
    """
    <tr>
     <td width="115">
      <p>
       <strong>Bill No. 250</strong>
      </p>
     </td>
     <td width="557">
      <p>
       <strong>By-law No. A.-8613-194</strong>
       - A by-law to confirm the proceedings of the Council Meeting held on the 24
       <sup>th</sup>
       day of June, 2025 (City Clerk)
      </p>
     </td>
    </tr>
    """

    self.name = p.contents[0].contents[0]

    self.empty = False
    if bill_desc_regex.match(str(self.name)):
      self.empty = True
      return

    tds = tr.find_all("td")
    p_desc = tds[1].find("p")
    self.desc = Paragraph.get_text(p_desc)

  def is_empty(self):
    return self.empty

  def format_markdown(self):
    return callout(self.name, self.desc)

class Vote(Content):
  def __init__(self, motion_voters):
    self.rows = []
    for row in motion_voters.contents:
      self.add_row(row)

  def add_row(self, row):
    """
    <tr>
     <td class="VoterVote" colspan="1" headers="">Yeas:  (15)</td>
     <td class="VotesUsers" colspan="1" headers="">
      Mayor J. Morgan, A. Hopkins, S. Lewis, S. Hillier, E. Peloza, P. Van Meerbergen, S. Lehman, H. McAlister, P. Cuddy, S. Stevenson, J. Pribil, S. Trosow, S. Franke, D. Ferreira,  and C. Rahman
     </td>
    </tr>
    """

    # make sure it's not empty
    if len(row.contents) != 2: return

    # "Yeas:  (15)" -> "Yeas:"
    vote = row.find(class_="VoterVote").contents[0].split(" ")[0]

    voters = row.find(class_="VotesUsers").contents[0].replace(" and ", "").split(", ")

    self.rows.append({
      "vote": vote,
      "voters": voters
    })


  def format_markdown(self):
    table_header = f"|{'|'.join([col['vote'] for col in self.rows])}|"
    header_divider = "|-" * len(self.rows) + "|"

    max_len = max([len(row["voters"]) for row in self.rows])
    table_body = ""
    for i in range(max_len):
      current_row = "|"
      for row in self.rows:
        voters = row["voters"]
        if i < len(voters): current_row += voters[i]
        current_row += "|"
      table_body += current_row + "\n"

    return callout("Vote:", f"{table_header}\n{header_divider}\n{table_body}")

  def is_empty(self):
    return len(self.rows) == 0
