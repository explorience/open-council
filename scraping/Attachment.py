class Attachment:
  def __init__(self, agenda_item_attachment):
    link = agenda_item_attachment.find("a")
    self.document_id = int(link.attrs["href"].split("=")[-1])
