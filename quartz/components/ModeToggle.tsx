import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/modeToggle.scss"
// @ts-ignore
import script from "./scripts/modeToggle.inline"

export interface ModeToggleOptions {
  simpleLabel: string
  advancedLabel: string
}

const defaultOptions: ModeToggleOptions = {
  simpleLabel: "Simple",
  advancedLabel: "Advanced",
}

export default ((userOpts?: Partial<ModeToggleOptions>) => {
  const ModeToggle: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
    const opts = { ...defaultOptions, ...userOpts }

    return (
      <div class="mode-toggle">
        <button class="mode-toggle-btn" aria-pressed="false" title="Switch to advanced view">
          <span class="mode-label simple-label">{opts.simpleLabel}</span>
          <span class="mode-switch">
            <span class="mode-switch-thumb"></span>
          </span>
          <span class="mode-label advanced-label">{opts.advancedLabel}</span>
        </button>
      </div>
    )
  }

  ModeToggle.css = style
  ModeToggle.afterDOMLoaded = script

  return ModeToggle
}) satisfies QuartzComponentConstructor
