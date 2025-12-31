import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/chatbot.scss"
// @ts-ignore
import script from "./scripts/chatbot.inline"
import { classNames } from "../util/lang"

export interface ChatBotOptions {
  title: string
  placeholder: string
  apiUrl: string
}

const defaultOptions: ChatBotOptions = {
  title: "Ask About Council Meetings",
  placeholder: "Ask a question about city council meetings...",
  apiUrl: "http://localhost:3001",
}

export default ((userOpts?: Partial<ChatBotOptions>) => {
  const ChatBot: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    return (
      <div class={classNames(displayClass, "chatbot")}>
        <button class="chatbot-toggle" aria-label="Open chatbot">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span class="chatbot-badge" style="display: none;">1</span>
        </button>

        <div class="chatbot-container" style="display: none;">
          <div class="chatbot-header">
            <h3>{opts.title}</h3>
            <div class="chatbot-header-buttons">
              <button class="chatbot-maximize" aria-label="Maximize chatbot">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="maximize-icon">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="minimize-icon" style="display: none;">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                </svg>
              </button>
              <button class="chatbot-close" aria-label="Close chatbot">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="chatbot-messages">
            <div class="chatbot-message assistant">
              <div class="message-content">
                <p>Hi! I'm here to help you explore London City Council meetings. Ask me anything about votes, decisions, councillors, or meeting records.</p>
              </div>
            </div>
          </div>

          <div class="chatbot-input-container">
            <textarea
              class="chatbot-input"
              placeholder={opts.placeholder}
              rows={1}
              aria-label="Chat input"
            ></textarea>
            <button class="chatbot-send" aria-label="Send message">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>

          <div class="chatbot-footer">
            <small>Powered by AI • May make mistakes</small>
          </div>
        </div>

        <script data-api-url={opts.apiUrl}></script>
      </div>
    )
  }

  ChatBot.afterDOMLoaded = script
  ChatBot.css = style

  return ChatBot
}) satisfies QuartzComponentConstructor
