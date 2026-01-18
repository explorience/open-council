// Homepage Hero - Unified Chat Experience
// Handles both hero state and full-viewport chat mode

import { Marked } from "marked"
import DOMPurify from "dompurify"

interface Message {
  role: "user" | "assistant"
  content: string
}

interface ChatSource {
  title: string
  date: string
  url: string
  type: string
}

// Chat history persists across state changes
const chatHistory: Message[] = []

// Configure marked for chat-friendly rendering
const marked = new Marked({
  breaks: true,
  gfm: true,
})

// Custom renderer to add target="_blank" to links
const renderer = {
  link({ href, title, text }: { href: string; title?: string | null | undefined; text: string }) {
    const titleAttr = title ? ` title="${title}"` : ""
    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener">${text}</a>`
  },
}
marked.use({ renderer })

function renderMarkdown(content: string): string {
  // Sanitize HTML output to prevent XSS attacks
  return DOMPurify.sanitize(marked.parse(content) as string)
}

function createMessageElement(role: "user" | "assistant", content: string): HTMLElement {
  const messageDiv = document.createElement("div")
  messageDiv.className = `chat-message ${role}`

  const contentDiv = document.createElement("div")
  contentDiv.className = "message-content"
  contentDiv.innerHTML = renderMarkdown(content)
  messageDiv.appendChild(contentDiv)

  return messageDiv
}

function createLoadingElement(): HTMLElement {
  const messageDiv = document.createElement("div")
  messageDiv.className = "chat-message assistant"

  const contentDiv = document.createElement("div")
  contentDiv.className = "message-content"

  const loadingDiv = document.createElement("div")
  loadingDiv.className = "message-loading"
  loadingDiv.setAttribute("role", "status")
  loadingDiv.setAttribute("aria-label", "Loading response")
  loadingDiv.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>'

  contentDiv.appendChild(loadingDiv)
  messageDiv.appendChild(contentDiv)

  return messageDiv
}

function scrollToBottom(container: HTMLElement) {
  container.scrollTop = container.scrollHeight
}

function createSourcesSection(sources: ChatSource[]): HTMLElement {
  const sourcesDiv = document.createElement("div")
  sourcesDiv.className = "response-sources"

  if (sources.length === 0) {
    return sourcesDiv
  }

  // Limit to top 5 sources to keep it concise
  const displaySources = sources.slice(0, 5)

  const header = document.createElement("button")
  header.className = "sources-header"
  header.setAttribute("aria-expanded", "false")
  header.innerHTML = `
    <span class="sources-label">Sources (${sources.length})</span>
    <svg class="sources-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  `

  const list = document.createElement("div")
  list.className = "sources-list"
  list.setAttribute("aria-hidden", "true")

  displaySources.forEach(source => {
    const link = document.createElement("a")
    link.href = source.url
    link.className = "source-link"
    link.innerHTML = `
      <span class="source-date">${formatDate(source.date)}</span>
      <span class="source-title">${source.title}</span>
    `
    list.appendChild(link)
  })

  // Toggle functionality
  header.addEventListener("click", () => {
    const expanded = header.getAttribute("aria-expanded") === "true"
    header.setAttribute("aria-expanded", String(!expanded))
    list.setAttribute("aria-hidden", String(expanded))
    sourcesDiv.classList.toggle("expanded", !expanded)
  })

  sourcesDiv.appendChild(header)
  sourcesDiv.appendChild(list)

  return sourcesDiv
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return dateStr
  }
}

function autoResize(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto"
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px"
}

// Copy functionality
function copyToClipboard(text: string, button: HTMLButtonElement) {
  navigator.clipboard.writeText(text).then(() => {
    button.classList.add("copied")

    // Announce to screen readers
    const announcement = document.createElement("div")
    announcement.setAttribute("role", "status")
    announcement.setAttribute("aria-live", "polite")
    announcement.className = "sr-only"
    announcement.textContent = "Copied to clipboard"
    document.body.appendChild(announcement)

    setTimeout(() => {
      button.classList.remove("copied")
      announcement.remove()
    }, 2000)
  }).catch(err => {
    console.error("Failed to copy:", err)
  })
}

function getLastExchange(): string {
  if (chatHistory.length < 2) return ""

  const lastUserMsg = [...chatHistory].reverse().find(m => m.role === "user")
  const lastAssistantMsg = [...chatHistory].reverse().find(m => m.role === "assistant")

  if (!lastUserMsg || !lastAssistantMsg) return ""

  return `Q: ${lastUserMsg.content}\n\nA: ${lastAssistantMsg.content}`
}

function getAllMessages(): string {
  return chatHistory.map(m => {
    const prefix = m.role === "user" ? "Q:" : "A:"
    return `${prefix} ${m.content}`
  }).join("\n\n")
}

document.addEventListener("nav", () => {
  const hero = document.querySelector(".homepage-hero") as HTMLElement
  if (!hero) return

  const apiUrl = hero.dataset.apiUrl || "https://open-council-production.up.railway.app"

  // Elements
  const input = hero.querySelector(".chat-input") as HTMLTextAreaElement
  const sendBtn = hero.querySelector(".chat-send-btn") as HTMLButtonElement
  const backBtn = hero.querySelector(".chat-back-btn") as HTMLButtonElement
  const messagesContainer = hero.querySelector(".chat-messages") as HTMLElement
  const copyLastBtn = hero.querySelector(".chat-copy-last") as HTMLButtonElement
  const copyAllBtn = hero.querySelector(".chat-copy-all") as HTMLButtonElement

  let isStreaming = false


  // Activate chat mode
  function enterChatMode() {
    hero.classList.add("chat-active")
    document.body.style.overflow = "hidden" // Prevent background scroll

    // Focus the input after transition
    setTimeout(() => {
      input?.focus()
      scrollToBottom(messagesContainer)
    }, 100)

    // Announce mode change to screen readers
    const announcement = document.createElement("div")
    announcement.setAttribute("role", "status")
    announcement.setAttribute("aria-live", "polite")
    announcement.className = "sr-only"
    announcement.textContent = "Chat mode activated. Type your question."
    document.body.appendChild(announcement)
    setTimeout(() => announcement.remove(), 1000)
  }

  // Return to hero mode
  function exitChatMode() {
    hero.classList.remove("chat-active")
    document.body.style.overflow = "" // Restore scroll

    // Focus the input in hero mode
    setTimeout(() => input?.focus(), 100)
  }

  // Send message
  async function sendMessage(message: string) {
    if (!message.trim() || isStreaming) return

    // Enter chat mode on first message
    if (!hero.classList.contains("chat-active")) {
      enterChatMode()
    }

    // Remove the welcome message on first user message
    const welcomeMessage = messagesContainer.querySelector(".chat-message.assistant")
    if (welcomeMessage && chatHistory.length === 0) {
      welcomeMessage.remove()
    }

    // Add user message
    const userMessage = createMessageElement("user", message)
    messagesContainer.appendChild(userMessage)
    scrollToBottom(messagesContainer)
    chatHistory.push({ role: "user", content: message })

    // Clear and disable input
    input.value = ""
    input.style.height = "auto"
    input.disabled = true
    sendBtn.disabled = true
    isStreaming = true

    // Show loading
    const loadingElement = createLoadingElement()
    messagesContainer.appendChild(loadingElement)
    scrollToBottom(messagesContainer)

    try {
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: chatHistory.slice(0, -1),
        }),
      })

      loadingElement.remove()

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // Create assistant message element
      const assistantMessage = createMessageElement("assistant", "")
      messagesContainer.appendChild(assistantMessage)
      const contentDiv = assistantMessage.querySelector(".message-content") as HTMLElement

      // Stream the response
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullResponse = ""

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split("\n")

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6))

                if (data.error) {
                  contentDiv.innerHTML = `<p style="color: var(--tertiary);">Error: ${data.error}</p>`
                  break
                }

                if (data.content) {
                  fullResponse += data.content
                  contentDiv.innerHTML = renderMarkdown(fullResponse)
                  scrollToBottom(messagesContainer)
                }

                if (data.done) {
                  chatHistory.push({ role: "assistant", content: fullResponse })

                  // Add sources section if available
                  if (data.sources && data.sources.length > 0) {
                    const sourcesSection = createSourcesSection(data.sources as ChatSource[])
                    contentDiv.appendChild(sourcesSection)
                    scrollToBottom(messagesContainer)
                  }

                  break
                }
              } catch (e) {
                console.error("Error parsing SSE data:", e)
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error sending message:", error)

      if (loadingElement.parentElement) {
        loadingElement.remove()
      }

      const errorMessage = createMessageElement(
        "assistant",
        "Sorry, I encountered an error connecting to the server. Please try again.",
      )
      messagesContainer.appendChild(errorMessage)
    } finally {
      input.disabled = false
      sendBtn.disabled = false
      isStreaming = false
      input.focus()
      scrollToBottom(messagesContainer)
    }
  }

  // Event listeners
  sendBtn?.addEventListener("click", () => {
    sendMessage(input.value)
  })

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input.value)
    }
  })

  input?.addEventListener("input", () => {
    autoResize(input)
  })

  backBtn?.addEventListener("click", () => {
    exitChatMode()
  })

  // Escape key to exit chat mode
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && hero.classList.contains("chat-active") && !isStreaming) {
      exitChatMode()
    }
  })

  // Copy buttons
  copyLastBtn?.addEventListener("click", () => {
    const text = getLastExchange()
    if (text) {
      copyToClipboard(text, copyLastBtn)
    }
  })

  copyAllBtn?.addEventListener("click", () => {
    const text = getAllMessages()
    if (text) {
      copyToClipboard(text, copyAllBtn)
    }
  })

  // Handle prefill questions clicking (from PrefillQuestions component)
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    const prefillBtn = target.closest(".prefill-question") as HTMLButtonElement

    if (prefillBtn) {
      const question = prefillBtn.dataset.question || prefillBtn.textContent
      if (question) {
        sendMessage(question)
      }
    }
  })
})

// Add screen reader only class if not present
const style = document.createElement("style")
style.textContent = `
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`
document.head.appendChild(style)
