def callout(title, content):
  output = ""
  output += f"> [!abstract]- {title}\n"
  newline_replacement = '\n> '
  output += f"> {content.strip().replace(chr(10), newline_replacement)}"
  return output
