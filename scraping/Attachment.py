class Attachment:
  def __init__(self, agenda_item_attachment):
    attrs = agenda_item_attachment.find("a").attrs
    self.document_id = int(attrs["href"].split("=")[-1])
    self.title = attrs["data-original-title"]

  def format_markdown(self):
    return f"[{self.title}](https://pub-london.escribemeetings.com/filestream.ashx?DocumentId={self.document_id})\n\n"
