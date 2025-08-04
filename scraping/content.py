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
    if Bill.is_bill(e):
      return Bill(e)
    if Bill.within_bill(e):
      return Content()
    if e.name == "p":
      return Paragraph(e)
    return Content() # empty, will be filtered out

  @staticmethod
  def parse_contents(content_row):
    if not content_row: return []

    content = []
    for c in content_row.contents:
      if isinstance(c, NavigableString): continue
      if c.has_attr("class") and "AgendaItemMotions" in c["class"]:
        content += Content.parse_motions(c)
      else:
        for e in [c, *c.find_all(True)]:
          con = Content.parse_content(e)
          if not con.is_empty():
            content.append(con)

    return content

  @staticmethod
  def parse_motions(agenda_item_motions):
    motions = []
    for agenda_item_motion in agenda_item_motions.contents:
      motion = Motion(agenda_item_motion)
      motions.append(motion)
      if motion.higher_content:
        motions += motion.higher_content
    return motions


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
    if e == None: return ""

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


class Motion(Content):
  def __init__(self, agenda_item_motion):
    self.pre_motion_texts = Content.parse_contents(agenda_item_motion.find(class_="PreMotionText"))
    self.moved_by = Mover(agenda_item_motion.find(class_="MovedBy"))
    self.seconded_by = Mover(agenda_item_motion.find(class_="SecondedBy"))
    self.motion_texts = Content.parse_contents(agenda_item_motion.find(class_="MotionText"))
    self.vote = Vote(agenda_item_motion.find(class_="MotionVoters"))
    self.result = MotionResult(agenda_item_motion.find(class_="MotionResult"))
    self.post_motion_texts = Content.parse_contents(agenda_item_motion.find(class_="PostMotionText"))

    # self.higher_content, if present, shouldn't be in the Motion, but instead raised to the next level after it.
    self.higher_content = None

    # raise new bills
    if len(self.post_motion_texts) >= 2 and isinstance(self.post_motion_texts[1], Bill):
      self.higher_content = self.post_motion_texts
      self.post_motion_texts = []

  def is_empty(self):
    return False

  def format_markdown(self):
    output = ""
    parts = [*self.pre_motion_texts, self.moved_by, self.seconded_by, *self.motion_texts]
    parts += [self.vote, self.result, *self.post_motion_texts]
    for item in parts:
      if not item.is_empty():
        output += f"{item.format_markdown()}\n\n"
    # horizontal line after the motion to help visually group
    return output + "****"


# moved by, seconded by
class Mover(Paragraph):

  @staticmethod
  def get_text(e):
    if not e: return ""

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
  def within_bill(e):
    if e.name != "p": return False
    if len(e.contents) == 0: return False
    s = e.contents[0]
    if s.name != "strong": return False
    if not bill_name_regex.match(s.contents[0]) and not bill_desc_regex.match(s.contents[0]): return False
    return True

  @staticmethod
  def is_bill(e):
    return Bill.within_bill(e) and bill_name_regex.match(e.contents[0].contents[0])

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

    tds = tr.find_all("td")
    p_desc = tds[1].find("p")
    self.desc = Paragraph.get_text(p_desc)

  def is_empty(self):
    return False

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
