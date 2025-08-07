const hide = e => {
  e.classList.add("hidden")
  e.classList.remove("shown")
}
const show = e => {
  e.classList.add("shown")
  e.classList.remove("hidden")
}

const handleThemeChange = () => {
  const githubDark = document.querySelector(".github-dark")
  const githubLight = document.querySelector(".github-light")
  const theme = localStorage.getItem("theme")
  if (theme === "dark") {
    show(githubDark)
    hide(githubLight)
  } else if (theme === "light") {
    show(githubLight)
    hide(githubDark)
  }
}

document.addEventListener("nav", handleThemeChange)
document.addEventListener("themechange", handleThemeChange)