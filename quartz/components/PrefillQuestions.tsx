import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/prefillQuestions.scss"
// @ts-ignore
import script from "./scripts/prefillQuestions.inline"

export interface PrefillQuestionsOptions {
  title: string
  questions: string[]
}

const defaultOptions: PrefillQuestionsOptions = {
  title: "Try asking:",
  questions: [
    "What major decisions did council make this year?",
    "How has the budget changed over time?",
    "What's the most debated topic in recent years?",
    "What zoning changes were approved recently?",
    "How did council vote on transit issues?",
  ],
}

export default ((userOpts?: Partial<PrefillQuestionsOptions>) => {
  const PrefillQuestions: QuartzComponent = ({ displayClass, fileData }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    // Check if there are contextual questions from frontmatter
    const contextualQuestions = fileData.frontmatter?.prefillQuestions as string[] | undefined
    const questions = contextualQuestions || opts.questions

    return (
      <div class="prefill-questions">
        <p class="prefill-title">{opts.title}</p>
        <div class="prefill-chips">
          {questions.map((question) => (
            <button class="prefill-chip" data-question={question}>
              {question}
            </button>
          ))}
        </div>
      </div>
    )
  }

  PrefillQuestions.css = style
  PrefillQuestions.afterDOMLoaded = script

  return PrefillQuestions
}) satisfies QuartzComponentConstructor
