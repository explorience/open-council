import fs from "fs"
import path from "path"
import yaml from "js-yaml"
import { globby } from "globby"

const CONTENT_DIR = path.join(process.cwd(), "content")

interface ValidationError {
  file: string
  line?: number
  message: string
}

async function validateFrontmatter(): Promise<void> {
  const errors: ValidationError[] = []

  // Find all markdown files
  const files = await globby("**/*.md", { cwd: CONTENT_DIR })

  for (const file of files) {
    const filePath = path.join(CONTENT_DIR, file)
    const content = fs.readFileSync(filePath, "utf-8")

    // Check if file has frontmatter
    if (!content.startsWith("---")) {
      continue
    }

    // Extract frontmatter
    const endIndex = content.indexOf("---", 3)
    if (endIndex === -1) {
      errors.push({
        file,
        message: "Unclosed frontmatter block (missing closing ---)",
      })
      continue
    }

    const frontmatter = content.slice(3, endIndex).trim()

    // Try to parse YAML
    try {
      yaml.load(frontmatter)
    } catch (e: any) {
      const yamlError = e as yaml.YAMLException
      errors.push({
        file,
        line: yamlError.mark?.line ? yamlError.mark.line + 1 : undefined,
        message: yamlError.reason || yamlError.message || "Invalid YAML syntax",
      })
    }
  }

  // Report results
  if (errors.length > 0) {
    console.error("\n❌ Frontmatter validation failed!\n")
    for (const error of errors) {
      const location = error.line ? `:${error.line}` : ""
      console.error(`  ${error.file}${location}`)
      console.error(`    → ${error.message}\n`)
    }
    console.error(`Found ${errors.length} error(s) in frontmatter.\n`)
    process.exit(1)
  }

  console.log(`✓ Validated frontmatter in ${files.length} files`)
}

validateFrontmatter().catch((e) => {
  console.error("Validation script error:", e)
  process.exit(1)
})
