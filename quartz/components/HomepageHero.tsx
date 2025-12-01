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
        <h1 class="hero-title">{opts.title}</h1>
        <p class="hero-tagline">{opts.tagline}</p>

        <div class="hero-chat-container">
          <div class="hero-chat-input-wrapper">
            <svg class="hero-chat-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <input
              type="text"
              class="hero-chat-input"
              placeholder={opts.chatPlaceholder}
              aria-label="Ask a question about council meetings"
            />
            <button class="hero-chat-send" aria-label="Send question">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    )
  }

  HomepageHero.css = style
  HomepageHero.afterDOMLoaded = script

  return HomepageHero
}) satisfies QuartzComponentConstructor
