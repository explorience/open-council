import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/homepageHero.scss"
// @ts-ignore
import script from "./scripts/homepageHero.inline"

export interface HomepageHeroOptions {
  title: string
  tagline: string
  chatPlaceholder: string
  apiUrl: string
}

const defaultOptions: HomepageHeroOptions = {
  title: "Open Council",
  tagline: "London's council meetings, on the record and searchable",
  chatPlaceholder: "Ask anything about council meetings...",
  apiUrl: "https://open-council-production.up.railway.app",
}

export default ((userOpts?: Partial<HomepageHeroOptions>) => {
  const HomepageHero: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    return (
      <div class="homepage-hero" data-api-url={opts.apiUrl}>
        {/* Hero state - shown initially */}
        <div class="hero-welcome">
          <h1 class="hero-title">{opts.title} <span class="beta-tag">BETA</span></h1>
          <p class="hero-tagline">{opts.tagline}</p>
        </div>

        {/* Chat header - shown in chat mode */}
        <header class="chat-header" aria-label="Chat navigation">
          <button class="chat-back-btn" aria-label="Back to home">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            <span>Back</span>
          </button>
          <span class="chat-header-title">{opts.title}</span>
          <div class="chat-header-actions">
            <button class="chat-copy-last" aria-label="Copy last exchange" title="Copy last Q&A">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <button class="chat-copy-all" aria-label="Copy entire conversation" title="Copy all">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/>
                <line x1="9" y1="12" x2="15" y2="12"/>
                <line x1="9" y1="16" x2="15" y2="16"/>
              </svg>
            </button>
            <a href="/about" class="chat-about-link" aria-label="About Open Council" title="About">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
            </a>
          </div>
        </header>

        {/* Chat messages area - grows to fill viewport */}
        <div class="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
          <div class="chat-message assistant">
            <div class="message-content">
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

        {/* Input area - always visible, pinned to bottom in chat mode */}
        <div class="chat-input-area">
          <div class="chat-input-wrapper">
            <svg class="chat-input-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <textarea
              class="chat-input"
              placeholder={opts.chatPlaceholder}
              rows={1}
              aria-label="Type your question"
            ></textarea>
            <button class="chat-send-btn" aria-label="Send message">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
          <p class="chat-disclaimer">AI-generated · may be inaccurate</p>
        </div>
      </div>
    )
  }

  HomepageHero.css = style
  HomepageHero.afterDOMLoaded = script

  return HomepageHero
}) satisfies QuartzComponentConstructor
