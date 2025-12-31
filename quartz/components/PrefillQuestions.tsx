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
    "What decisions have been made about housing?",
    "What are the biggest budget items this year?",
    "What has council discussed about homelessness?",
    "What happened at the last council meeting?",
    "What has council said about bike lanes?",
  ],
}

export default ((userOpts?: Partial<PrefillQuestionsOptions>) => {
  const PrefillQuestions: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
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
