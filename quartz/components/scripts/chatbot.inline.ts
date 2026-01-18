// Client-side chatbot functionality
import { Marked } from "marked"
import DOMPurify from "dompurify"

interface Message {
  role: "user" | "assistant"
  content: string
}

const chatHistory: Message[] = []

// Configure marked for chat-friendly rendering
const marked = new Marked({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
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
  messageDiv.className = `chatbot-message ${role}`

  const contentDiv = document.createElement("div")
  contentDiv.className = "message-content"

  contentDiv.innerHTML = renderMarkdown(content)
  messageDiv.appendChild(contentDiv)

  return messageDiv
}

function createLoadingElement(): HTMLElement {
  const messageDiv = document.createElement("div")
  messageDiv.className = "chatbot-message assistant"

  const contentDiv = document.createElement("div")
  contentDiv.className = "message-content"

  const loadingDiv = document.createElement("div")
  loadingDiv.className = "message-loading"
  loadingDiv.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>'

  contentDiv.appendChild(loadingDiv)
  messageDiv.appendChild(contentDiv)

  return messageDiv
}

function scrollToBottom(container: HTMLElement) {
  container.scrollTop = container.scrollHeight
}

async function sendMessage(message: string, apiUrl: string) {
  const messagesContainer = document.querySelector(".chatbot-messages") as HTMLElement
  const input = document.querySelector(".chatbot-input") as HTMLTextAreaElement
  const sendButton = document.querySelector(".chatbot-send") as HTMLButtonElement

  if (!messagesContainer || !message.trim()) return

  // Add user message to UI and history
  const userMessage = createMessageElement("user", message)
  messagesContainer.appendChild(userMessage)
  scrollToBottom(messagesContainer)

  chatHistory.push({ role: "user", content: message })

  // Clear input and disable
  input.value = ""
  input.disabled = true
  sendButton.disabled = true

  // Show loading indicator
  const loadingElement = createLoadingElement()
  messagesContainer.appendChild(loadingElement)
  scrollToBottom(messagesContainer)

  try {
    // Send request to API
    const response = await fetch(`${apiUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        history: chatHistory.slice(0, -1), // Don't include the message we just added
      }),
    })

    // Remove loading indicator
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

                // Update content with markdown rendering
                contentDiv.innerHTML = renderMarkdown(fullResponse)
                scrollToBottom(messagesContainer)
              }

              if (data.done) {
                // Add to history
                chatHistory.push({ role: "assistant", content: fullResponse })
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

    // Remove loading if still there
    if (loadingElement.parentElement) {
      loadingElement.remove()
    }

    // Show error message
    const errorMessage = createMessageElement(
      "assistant",
      "Sorry, I encountered an error. Please make sure the chat server is running (npm run chat:server) and try again.",
    )
    messagesContainer.appendChild(errorMessage)
  } finally {
    // Re-enable input
    input.disabled = false
    sendButton.disabled = false
    input.focus()
    scrollToBottom(messagesContainer)
  }
}

function autoResize(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto"
  textarea.style.height = textarea.scrollHeight + "px"
}

document.addEventListener("nav", () => {
  const chatbot = document.querySelector(".chatbot") as HTMLElement
  if (!chatbot) return

  const toggle = chatbot.querySelector(".chatbot-toggle") as HTMLButtonElement
  const container = chatbot.querySelector(".chatbot-container") as HTMLElement
  const closeBtn = chatbot.querySelector(".chatbot-close") as HTMLButtonElement
  const maximizeBtn = chatbot.querySelector(".chatbot-maximize") as HTMLButtonElement
  const input = chatbot.querySelector(".chatbot-input") as HTMLTextAreaElement
  const sendBtn = chatbot.querySelector(".chatbot-send") as HTMLButtonElement

  // Get API URL from script tag
  const scriptTag = chatbot.querySelector("script[data-api-url]") as HTMLScriptElement
  const apiUrl = scriptTag?.dataset.apiUrl || "http://localhost:3001"

  // Load saved maximized state
  const isMaximized = localStorage.getItem("chatbot-maximized") === "true"
  if (isMaximized) {
    container.classList.add("maximized")
    updateMaximizeButton(true)
  }

  // Toggle chatbot
  toggle?.addEventListener("click", () => {
    const isHidden = container.style.display === "none"
    container.style.display = isHidden ? "flex" : "none"
    if (isHidden) {
      input?.focus()
    }
  })

  // Close chatbot
  closeBtn?.addEventListener("click", () => {
    container.style.display = "none"
  })

  // Maximize/minimize chatbot
  maximizeBtn?.addEventListener("click", () => {
    const isCurrentlyMaximized = container.classList.contains("maximized")
    if (isCurrentlyMaximized) {
      container.classList.remove("maximized")
      localStorage.setItem("chatbot-maximized", "false")
      updateMaximizeButton(false)
    } else {
      container.classList.add("maximized")
      localStorage.setItem("chatbot-maximized", "true")
      updateMaximizeButton(true)
    }
  })

  function updateMaximizeButton(isMaximized: boolean) {
    const maximizeIcon = maximizeBtn?.querySelector(".maximize-icon") as SVGElement
    const minimizeIcon = maximizeBtn?.querySelector(".minimize-icon") as SVGElement
    if (maximizeIcon && minimizeIcon) {
      if (isMaximized) {
        maximizeIcon.style.display = "none"
        minimizeIcon.style.display = "block"
        maximizeBtn.setAttribute("aria-label", "Minimize chatbot")
      } else {
        maximizeIcon.style.display = "block"
        minimizeIcon.style.display = "none"
        maximizeBtn.setAttribute("aria-label", "Maximize chatbot")
      }
    }
  }

  // Auto-resize textarea
  input?.addEventListener("input", () => {
    autoResize(input)
  })

  // Send message on button click
  sendBtn?.addEventListener("click", () => {
    sendMessage(input.value, apiUrl)
  })

  // Send message on Enter (Shift+Enter for new line)
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input.value, apiUrl)
    }
  })

  // Close on Escape, or minimize if maximized
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && container.style.display === "flex") {
      const isCurrentlyMaximized = container.classList.contains("maximized")
      if (isCurrentlyMaximized) {
        container.classList.remove("maximized")
        localStorage.setItem("chatbot-maximized", "false")
        updateMaximizeButton(false)
      } else {
        container.style.display = "none"
      }
    }
  })
})
