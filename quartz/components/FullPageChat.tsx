import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/fullPageChat.scss"
// @ts-ignore
import script from "./scripts/fullPageChat.inline"

export interface FullPageChatOptions {
  title: string
  placeholder: string
  apiUrl: string
}

const defaultOptions: FullPageChatOptions = {
  title: "Open Council",
  placeholder: "Ask anything about council meetings...",
  apiUrl: "https://open-council-production.up.railway.app",
}

export default ((userOpts?: Partial<FullPageChatOptions>) => {
  const FullPageChat: QuartzComponent = (_props: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    return (
      <div class="full-page-chat" role="dialog" aria-modal="true" aria-label="Full page chat with AI assistant" data-api-url={opts.apiUrl} style="display: none;">
        {/* Chat header */}
        <header class="fpc-header" aria-label="Chat navigation">
          <button class="fpc-back-btn" aria-label="Close chat and return to page">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            <span>Back</span>
          </button>
          <span class="fpc-header-title">{opts.title}</span>
          <div class="fpc-header-actions">
            <button class="fpc-copy-last" aria-label="Copy last exchange" title="Copy last Q&A">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <button class="fpc-copy-all" aria-label="Copy entire conversation" title="Copy all">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Chat messages area */}
        <div class="fpc-messages" role="log" aria-live="polite" aria-label="Chat messages">
          <div class="fpc-message assistant">
            <div class="fpc-message-content">
              <p>Hi! I'm here to help you explore London City Council meetings. You can ask me questions like:</p>
              <ul>
                <li>"What did council decide about zoning on January 21st?"</li>
                <li>"Show me all votes where councillors voted unanimously"</li>
                <li>"What bills were passed about housing?"</li>
                <li>"Who attended the Planning and Environment Committee meeting?"</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Input area */}
        <div class="fpc-input-area">
          <div class="fpc-input-wrapper">
            <label for="fpc-input" class="sr-only">Type your question</label>
            <textarea
              id="fpc-input"
              class="fpc-input"
              placeholder={opts.placeholder}
              rows={1}
            ></textarea>
            <button class="fpc-send-btn" aria-label="Send message">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
          <p class="fpc-disclaimer">AI-generated · may be inaccurate</p>
        </div>
      </div>
    )
  }

  FullPageChat.css = style
  FullPageChat.afterDOMLoaded = script

  return FullPageChat
}) satisfies QuartzComponentConstructor
