import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/feedbackForm.inline"
import style from "./styles/feedbackForm.scss"

const FeedbackForm: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
  if (fileData.frontmatter?.type !== "feedback-form") {
    return null
  }

  return (
    <div class="feedback-form-page">
      <h1>Feedback</h1>
      <p class="feedback-subtitle">
        Found a bug? Have an idea? Want to partner with us? We'd love to hear from you.
      </p>

      <form
        id="feedback-form"
        action="https://formspree.io/f/xdkojqpa"
        method="POST"
      >
        <div class="form-group">
          <label for="fb-email">Email <span class="required">*</span></label>
          <input
            type="email"
            id="fb-email"
            name="email"
            required
            placeholder="your@email.com"
          />
        </div>

        <div class="form-group">
          <label for="fb-name">Name <span class="optional">(optional)</span></label>
          <input
            type="text"
            id="fb-name"
            name="name"
            placeholder="Your name"
          />
        </div>

        <div class="form-group">
          <label for="fb-type">Type <span class="required">*</span></label>
          <select id="fb-type" name="type" required>
            <option value="" disabled selected>Select a category...</option>
            <option value="bug">Bug Report</option>
            <option value="feature">Feature Request</option>
            <option value="partnership">Partnership</option>
            <option value="question">Question</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div class="form-group">
          <label for="fb-message">Message <span class="required">*</span></label>
          <textarea
            id="fb-message"
            name="message"
            required
            rows={6}
            placeholder="Tell us what's on your mind..."
          ></textarea>
        </div>

        <input type="hidden" name="_subject" value="Open Council Feedback" />

        <button type="submit" class="feedback-submit" id="fb-submit">
          Send Feedback
        </button>

        <div id="fb-status" class="feedback-status"></div>
      </form>
    </div>
  )
}

FeedbackForm.css = style
FeedbackForm.afterDOMLoaded = script
FeedbackForm.displayName = "FeedbackForm"

export default (() => FeedbackForm) satisfies QuartzComponentConstructor
