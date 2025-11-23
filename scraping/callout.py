def callout(title, content):
  output = ""
  output += f"> [!abstract]- {title}\n"
  output += f"> {content.strip().replace('\n', '\n> ')}"
  return output
