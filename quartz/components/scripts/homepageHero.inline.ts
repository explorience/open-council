// Homepage hero chat input - sends question to chatbot

document.addEventListener("nav", () => {
  const hero = document.querySelector(".homepage-hero") as HTMLElement
  if (!hero) return

  const input = hero.querySelector(".hero-chat-input") as HTMLInputElement
  const sendBtn = hero.querySelector(".hero-chat-send") as HTMLButtonElement
  const apiUrl = hero.dataset.apiUrl || "https://open-council-production.up.railway.app"

  function sendToChatbot(message: string) {
    if (!message.trim()) return

    // Open the chatbot
    const chatbot = document.querySelector(".chatbot") as HTMLElement
    const chatContainer = chatbot?.querySelector(".chatbot-container") as HTMLElement
    const chatInput = chatbot?.querySelector(".chatbot-input") as HTMLTextAreaElement

    if (chatContainer && chatInput) {
      // Show the chatbot
      chatContainer.style.display = "flex"

      // Set the message in the chatbot input
      chatInput.value = message

      // Trigger the send by dispatching a custom event that the chatbot listens to
      // Or simulate clicking send button
      const chatSendBtn = chatbot.querySelector(".chatbot-send") as HTMLButtonElement
      if (chatSendBtn) {
        chatSendBtn.click()
      }

      // Clear the hero input
      input.value = ""
    }
  }

  // Send on button click
  sendBtn?.addEventListener("click", () => {
    sendToChatbot(input.value)
  })

  // Send on Enter
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      sendToChatbot(input.value)
    }
  })
})
