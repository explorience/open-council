import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { JSX } from "preact"
import style from "./styles/topicsView.scss"

interface TopicCard {
  name: string
  slug: string
  description: string
  icon: string
}

const topics: TopicCard[] = [
  {
    name: "Transportation",
    slug: "transportation",
    description: "Transit, cycling, parking, traffic",
    icon: "bus",
  },
  {
    name: "Housing",
    slug: "housing",
    description: "Affordable housing, homelessness, shelters",
    icon: "home",
  },
  {
    name: "Public Safety",
    slug: "public-safety",
    description: "Police, fire, EMS, bylaw enforcement",
    icon: "shield",
  },
  {
    name: "Climate & Environment",
    slug: "climate-environment",
    description: "Climate action, trees, conservation",
    icon: "leaf",
  },
  {
    name: "Planning & Development",
    slug: "planning-development",
    description: "Zoning, development, heritage",
    icon: "building",
  },
  {
    name: "Budget & Taxes",
    slug: "budget-taxes",
    description: "City budget, property taxes, spending",
    icon: "dollar-sign",
  },
  {
    name: "Infrastructure",
    slug: "infrastructure",
    description: "Roads, water, sewer, waste",
    icon: "tool",
  },
  {
    name: "Parks & Recreation",
    slug: "parks-recreation",
    description: "Parks, trails, community centers",
    icon: "tree",
  },
  {
    name: "Social Services",
    slug: "social-services",
    description: "Mental health, seniors, accessibility",
    icon: "heart",
  },
  {
    name: "Economic Development",
    slug: "economic-development",
    description: "Downtown, jobs, business, tourism",
    icon: "briefcase",
  },
]

// Simple SVG icons
const icons: Record<string, JSX.Element> = {
  bus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M8 6v6m8-6v6M3 11h18M5 19V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13M7 19v2h2v-2m6 0v2h2v-2" />
      <circle cx="7.5" cy="15.5" r="1.5" />
      <circle cx="16.5" cy="15.5" r="1.5" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  leaf: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M11 20A7 7 0 0 1 4 13c0-4 4-8 8-8s8 4 8 8a7 7 0 0 1-7 7z" />
      <path d="M12 12l-3 3M12 12l3 3M12 12V5" />
    </svg>
  ),
  building: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="8" y2="6" />
      <line x1="12" y1="6" x2="12" y2="6" />
      <line x1="16" y1="6" x2="16" y2="6" />
      <line x1="8" y1="10" x2="8" y2="10" />
      <line x1="12" y1="10" x2="12" y2="10" />
      <line x1="16" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="8" y2="14" />
      <line x1="12" y1="14" x2="12" y2="14" />
      <line x1="16" y1="14" x2="16" y2="14" />
      <path d="M10 22v-4h4v4" />
    </svg>
  ),
  "dollar-sign": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  tool: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  tree: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 22v-7" />
      <path d="M9 15H6l6-8 6 8h-3" />
      <path d="M8 11H5l7-9 7 9h-3" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  briefcase: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
}

export default (() => {
  const TopicsView: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
    return (
      <div class={`topics-view ${displayClass ?? ""}`}>
        <div class="topics-intro">
          <p>
            Explore what London City Council has discussed and decided on key policy areas. Click a
            topic to learn more and ask questions.
          </p>
        </div>

        <div class="topics-grid">
          {topics.map((topic) => (
            <a href={`/topics/${topic.slug}`} class="topic-card">
              <div class="topic-icon">{icons[topic.icon]}</div>
              <div class="topic-content">
                <h3 class="topic-name">{topic.name}</h3>
                <p class="topic-description">{topic.description}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    )
  }

  TopicsView.css = style

  return TopicsView
}) satisfies QuartzComponentConstructor
