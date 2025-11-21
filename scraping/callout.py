def callout(title, content):
  output = ""
  output += f"> [!abstract]- {title}\n"
  formatted_content = content.strip().replace('\n', '\n> ')
  output += f"> {formatted_content}"
  return output
