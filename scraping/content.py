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
    if not e: return Content()

    # sometimes, there are random tables (like lists of communications)
    if e.name == "p" or e.name == "li":
      return Paragraph(e)
    return Content() # empty, will be filtered out

  @staticmethod
  def parse_contents(content_row, meeting):
    if not content_row: return []

    content = []
    for c in content_row.contents:
      if isinstance(c, NavigableString): continue
      if c.has_attr("class") and "AgendaItemMotions" in c["class"]:
        content += Content.parse_motions(c, meeting)
      else:
        for e in [c, *c.find_all(True)]:
          con = Content.parse_content(e)
          if not con.is_empty():
            content.append(con)

    return content

  @staticmethod
  def parse_motions(agenda_item_motions, meeting):
    motions = []
    for agenda_item_motion in agenda_item_motions.contents:
      motion = Motion(agenda_item_motion, meeting)
      motions.append(motion)
    return motions


class Paragraph(Content):
  def __init__(self, e):
    self.string = self.get_text(e).strip()

    # convert lists to markdown
    self.string = self.string.replace("•", "-")
    self.string = self.string.replace("·", "-")

  @staticmethod
  def get_text(e):
    output = ""
    if e.name == "li": output += "- "
    for c in e.contents:
      if isinstance(c, NavigableString):
        output += c
      elif c.name in ["em", "span", "strong", "sup"]:
        # sometimes we have nested spans
        output += Paragraph.get_text(c)
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


BILL_TEXT = "The following Bills are enacted as By-laws of The Corporation of the City of London:"
def bill_text_test(s):
  return BILL_TEXT.lower() in s.lower()

class Motion(Content):
  def __init__(self, agenda_item_motion, meeting):
    self.pre_motion_texts = Content.parse_contents(agenda_item_motion.find(class_="PreMotionText"), meeting)
    self.moved_by = Mover(agenda_item_motion.find(class_="MovedBy"))
    self.seconded_by = Mover(agenda_item_motion.find(class_="SecondedBy"))
    self.motion_texts = Content.parse_contents(agenda_item_motion.find(class_="MotionText"), meeting)
    self.vote = Vote(agenda_item_motion.find(class_="MotionVoters"))
    self.result = MotionResult(agenda_item_motion.find(class_="MotionResult"))
    self.post_motion_texts = Content.parse_contents(agenda_item_motion.find(class_="PostMotionText"), meeting)

    if len(self.post_motion_texts) >= 1 and bill_text_test(self.post_motion_texts[0].string):
      bills_descs = []
      for paragraph in self.post_motion_texts:
        bills_descs += paragraph.string.split("\n")
      meeting.bills = Bills(bills_descs)
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


BILL_PAT = re.compile("(Bill No\\. \\d+)")

# the regex inserts these special strings so we can split on them
BILL_TITLE_START = "<BILL_NUMBER>"
BILL_TITLE_END = "</BILL_NUMBER>"

class Bill(Content):
  def __init__(self, text):
    self.empty_flag = False
    if not text.split():
      self.empty_flag = True
      return

    [title, desc] = text.split(BILL_TITLE_END)
    self.title = title.strip()
    self.desc = desc.strip()

  def is_empty(self):
    return self.empty_flag

  def format_markdown(self):
    return f"**{self.title}**\n\n{self.desc}"

class Bills(Content):
  def __init__(self, bills_descs):
    joined_desc = "\n\n".join([p for p in bills_descs if not bill_text_test(p) and p.strip()])
    marked_desc = BILL_PAT.sub(f"{BILL_TITLE_START}\\1{BILL_TITLE_END}", joined_desc)
    bills = [Bill(p) for p in marked_desc.split(BILL_TITLE_START)]
    self.bills = [b for b in bills if not b.is_empty()]

  def is_empty(self):
    return False

  def format_markdown(self):
    bills_markdown = "\n\n".join([b.format_markdown() for b in self.bills])
    return callout(BILL_TEXT, bills_markdown)

class Vote(Content):
  def __init__(self, motion_voters):
    self.rows = []
    if motion_voters:
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
