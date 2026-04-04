import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/footer.scss"

interface Options {
  links: Record<string, string>
}

export default ((opts?: Options) => {
  const Footer: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
    const links = opts?.links ?? []
    return (
      <footer class={`${displayClass ?? ""}`}>
        <p>
          A project of the{" "}
          <a href="https://communitysustainability.ca">Institute for Community Sustainability</a>
          {" "}and{" "}
          <a href="https://www.opencivics.co/">Open Civics</a>
        </p>
        <nav class="footer-links">
          <div class="footer-col">
            <strong>Explore</strong>
            <a href="/councillors">Councillors</a>
            <a href="/votes">Votes</a>
            <a href="/topics">Topics</a>
            <a href="/councillors/alignment">Voting Alignment</a>
            <a href="/committees">Committees</a>
          </div>
          <div class="footer-col">
            <strong>Tools</strong>
            <a href="/watchlist">Watchlist</a>
            <a href="/alerts">Alerts</a>
            <a href="/guide">User Guide</a>
            <a href="/feedback">Feedback</a>
          </div>
          <div class="footer-col">
            <strong>About</strong>
            <a href="/about">About Open Council</a>
            <a href="https://github.com/explorience/open-council">GitHub</a>
            <a href="mailto:info@opencouncil.xyz">Contact</a>
          </div>
        </nav>
        <ul>
          {Object.entries(links).map(([text, link]) => (
            <li>
              <a href={link}>{text}</a>
            </li>
          ))}
        </ul>
      </footer>
    )
  }

  Footer.css = style
  return Footer
}) satisfies QuartzComponentConstructor
