const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatThread = document.querySelector("#chat-thread");
const submitButton = chatForm.querySelector("button[type='submit']");
const sampleButtons = document.querySelectorAll(".samples button");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const conversationId = crypto.randomUUID();
let lastJobDescription = "";
let contactMode = false;
let pendingContactPrompt = false;
let contactDraft = {
  name: "",
  email: "",
  company: "",
  message: "",
};

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

function scrollChatToBottom() {
  chatThread.scrollTop = chatThread.scrollHeight;
}

function assistantAvatarHtml() {
  return '<img src="/assets/kawaii-agent.svg" alt="" width="44" height="44" aria-hidden="true" />';
}

function appendMessage(role, content, options = {}) {
  const article = document.createElement("article");
  article.className = `chat-message chat-message--${role}`;
  article.setAttribute(
    "aria-label",
    role === "user" ? "You said" : "Career agent response",
  );
  if (options.thinking) article.classList.add("is-thinking");

  const avatar = document.createElement("div");
  avatar.className = "chat-message__avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.innerHTML = role === "user" ? "You" : assistantAvatarHtml();

  const bubble = document.createElement("div");
  bubble.className = "chat-message__bubble";
  bubble.innerHTML = options.html
    ? content
    : `<p>${escapeHtml(content).replace(/\n/g, "<br>")}</p>`;

  article.append(avatar, bubble);
  chatThread.append(article);
  scrollChatToBottom();
  return article;
}

function appendThinking() {
  return appendMessage(
    "assistant",
    '<p class="thinking" role="status">Thinking</p>',
    { html: true, thinking: true },
  );
}

function fitClass(score) {
  if (score >= 75) return "fit-good";
  if (score >= 45) return "fit-ok";
  return "fit-low";
}

function fitFace(tone) {
  const mouth =
    tone === "low"
      ? "fit-face__mouth fit-face__mouth--flat"
      : "fit-face__mouth";
  return `
    <div class="fit-face" aria-hidden="true">
      <span class="fit-face__eye fit-face__eye--left"></span>
      <span class="fit-face__eye fit-face__eye--right"></span>
      <span class="${mouth}"></span>
    </div>
  `;
}

function renderFitCard(fit) {
  return `
    <div class="chat-fit ${fitClass(fit.score)}">
      <div class="fit-result" role="img" aria-label="${escapeHtml(fit.label)}">
        ${fitFace(fit.tone)}
        <div class="fit-result__label">${escapeHtml(fit.label)}</div>
      </div>
      <p>${escapeHtml(fit.reason)}</p>
    </div>
  `;
}

function actionButtons(includeResume) {
  return `
    <div class="chat-actions">
      ${includeResume ? '<button class="button button--primary" data-action="resume" type="button">Generate customized resume</button>' : ""}
      <button class="button button--ghost-dark" data-action="contact" type="button">Talk to Brian</button>
    </div>
  `;
}

function renderAssistantResponse(payload, thinkingMessage) {
  if (payload.fit) {
    lastJobDescription = payload.fit.jobDescription;
  }

  const contactAsk = payload.suggestContact
    ? '<p class="chat-followup">Want me to send Brian a note about this?</p>'
    : "";
  const html = [
    `<p>${escapeHtml(payload.text).replace(/\n/g, "<br>")}</p>`,
    payload.fit ? renderFitCard(payload.fit) : "",
    contactAsk,
    payload.fit || payload.suggestContact
      ? actionButtons(Boolean(payload.fit))
      : "",
  ].join("");

  thinkingMessage.classList.remove("is-thinking");
  thinkingMessage.querySelector(".chat-message__bubble").innerHTML = html;
  pendingContactPrompt = Boolean(payload.suggestContact);
  scrollChatToBottom();

  if (payload.fit?.score >= 75) {
    confetti();
  }
}

function looksLikeContactIntent(message) {
  return /\b(contact|reach|connect|talk to brian|speak with brian|schedule|interview|email brian|hire brian|get in touch|follow up|next step)\b/i.test(
    message,
  );
}

function hasAffirmativeContactIntent(message) {
  return /^(yes|yep|sure|please|ok|okay|talk|connect|interview|schedule|send|do it)\b/i.test(
    message.trim(),
  );
}

async function sendChatMessage(message) {
  appendMessage("user", message);

  if (
    contactMode ||
    (pendingContactPrompt && hasAffirmativeContactIntent(message)) ||
    looksLikeContactIntent(message)
  ) {
    await handleContactMessage(message);
    return;
  }

  const thinkingMessage = appendThinking();
  setBusy(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      thinkingMessage.classList.remove("is-thinking");
      thinkingMessage.querySelector(".chat-message__bubble").textContent =
        error.error ?? "That did not work. Try again in a moment.";
      return;
    }

    renderAssistantResponse(await response.json(), thinkingMessage);
  } catch {
    thinkingMessage.classList.remove("is-thinking");
    thinkingMessage.querySelector(".chat-message__bubble").textContent =
      "That did not work. Try again in a moment.";
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  chatThread.setAttribute("aria-busy", String(isBusy));
  submitButton.disabled = isBusy;
  sampleButtons.forEach((button) => {
    button.disabled = isBusy;
  });
}

function startContactFlow() {
  contactMode = true;
  pendingContactPrompt = false;
  appendMessage(
    "assistant",
    "Absolutely. What name, email, and company should I send to Brian?",
  );
}

function parseContactMessage(message) {
  const lines = message
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const labeled = Object.fromEntries(
    lines
      .map((line) => line.match(/^([^:]+):\s*(.+)$/))
      .filter(Boolean)
      .map((match) => [match[1].toLowerCase(), match[2].trim()]),
  );
  const email =
    labeled.email ??
    message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ??
    "";
  const name = labeled.name ?? "";
  const company = labeled.company ?? labeled.organization ?? "";
  const messageText =
    labeled.message ??
    labeled.note ??
    lines
      .filter(
        (line) =>
          !line.includes(email) &&
          line !== name &&
          line !== company &&
          !/^name:|email:|company:/i.test(line),
      )
      .join(" ");

  return { name, email, company, message: messageText };
}

function mergeContactDraft(message) {
  const parsed = parseContactMessage(message);
  contactDraft = {
    name: parsed.name || contactDraft.name,
    email: parsed.email || contactDraft.email,
    company: parsed.company || contactDraft.company,
    message: parsed.message || contactDraft.message,
  };

  if (!contactDraft.name && contactDraft.email) {
    const beforeEmail = message
      .slice(0, message.indexOf(contactDraft.email))
      .trim();
    const candidate = beforeEmail
      .replace(/^(my name is|i am|i'm|this is)\s+/i, "")
      .trim();
    if (candidate && candidate.length < 80 && !candidate.includes("@")) {
      contactDraft.name = candidate;
    }
  }
}

async function handleContactMessage(message) {
  contactMode = true;
  pendingContactPrompt = false;
  mergeContactDraft(message);

  if (!contactDraft.email) {
    appendMessage(
      "assistant",
      "Yes. I can send Brian a note right here. What name, email, and company should I pass along?",
    );
    return;
  }

  setBusy(true);
  const thinkingMessage = appendThinking();

  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        name: contactDraft.name || "Website visitor",
        email: contactDraft.email,
        company: contactDraft.company,
        message: contactDraft.message || "A visitor asked to talk with Brian.",
        jobDescription: lastJobDescription,
      }),
    });

    thinkingMessage.classList.remove("is-thinking");

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      thinkingMessage.querySelector(".chat-message__bubble").textContent =
        error.error ?? "I could not send that to Brian.";
      return;
    }

    contactMode = false;
    contactDraft = { name: "", email: "", company: "", message: "" };
    thinkingMessage.querySelector(".chat-message__bubble").innerHTML =
      "<p>Perfect. I'll send this to Brian's Slack now, and he'll get back to you as soon as possible.</p>";
  } finally {
    setBusy(false);
  }
}

async function generateResume() {
  if (!lastJobDescription) {
    appendMessage(
      "assistant",
      "Paste a job description or job link first, then I can generate a customized resume.",
    );
    return;
  }

  const thinkingMessage = appendThinking();
  setBusy(true);

  try {
    const response = await fetch("/api/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobDescription: lastJobDescription }),
    });

    thinkingMessage.classList.remove("is-thinking");

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      thinkingMessage.querySelector(".chat-message__bubble").textContent =
        error.error ?? "Could not generate the resume PDF.";
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Brian_Dear_Customized_Resume.pdf";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    thinkingMessage.querySelector(".chat-message__bubble").innerHTML =
      "<p>Generated Brian_Dear_Customized_Resume.pdf.</p>";
  } finally {
    setBusy(false);
  }
}

function confetti() {
  if (reducedMotion.matches) return;

  const colors = [
    "#a9d9e7",
    "#f4d784",
    "#b8c9a9",
    "#c7b7dd",
    "#d9aa92",
    "#fbfaf7",
  ];
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);

  for (let i = 0; i < 82; i += 1) {
    const piece = document.createElement("i");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    piece.style.animationDelay = `${Math.random() * 180}ms`;
    piece.style.setProperty("--fall-x", `${Math.random() * 240 - 120}px`);
    piece.style.setProperty(
      "--fall-y",
      `${window.innerHeight * 0.75 + Math.random() * 220}px`,
    );
    layer.append(piece);
  }

  setTimeout(() => layer.remove(), 1800);
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = "";
  void sendChatMessage(message);
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

sampleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    void sendChatMessage(button.textContent.trim());
  });
});

chatThread.addEventListener("click", (event) => {
  const action =
    event.target instanceof HTMLElement
      ? event.target.closest("[data-action]")
      : null;
  if (!action) return;

  if (action.dataset.action === "resume") {
    void generateResume();
  }
  if (action.dataset.action === "contact") {
    startContactFlow();
  }
});
