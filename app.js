const filterButtons = [...document.querySelectorAll(".filter-button")];
const classCards = [...document.querySelectorAll(".class-card")];
const searchInput = document.querySelector("#class-search");
const emptyState = document.querySelector("#empty-state");
let activeFilter = "all";

function filterClasses() {
  const query = searchInput.value.trim().toLowerCase();
  let visibleCount = 0;

  for (const card of classCards) {
    const matchesCategory = activeFilter === "all" || card.dataset.category === activeFilter;
    const matchesSearch = card.dataset.search.includes(query);
    const isVisible = matchesCategory && matchesSearch;
    card.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  }

  emptyState.hidden = visibleCount !== 0;
}

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    for (const filterButton of filterButtons) {
      const selected = filterButton === button;
      filterButton.classList.toggle("selected", selected);
      filterButton.setAttribute("aria-pressed", String(selected));
    }
    filterClasses();
  });
  button.setAttribute("aria-pressed", String(button.classList.contains("selected")));
}

searchInput.addEventListener("input", filterClasses);

for (const button of document.querySelectorAll(".save-button")) {
  button.addEventListener("click", () => {
    const isSaved = button.classList.toggle("saved");
    button.textContent = isSaved ? "♥" : "♡";
    button.setAttribute("aria-pressed", String(isSaved));
  });
  button.setAttribute("aria-pressed", "false");
}

const backdrop = document.querySelector("#modal-backdrop");
const modalTitle = document.querySelector("#modal-title");
const modalDescription = document.querySelector("#modal-description");
const nameField = document.querySelector("#name-field");
const emailField = document.querySelector("#email-field");
const messageField = document.querySelector("#message-field");
const modalForm = document.querySelector("#modal-form");
const toast = document.querySelector("#toast");
let toastTimer;
let activeModal = "join";
let lastFocusedElement;
let selectedClass = "";

const modalContent = {
  join: {
    title: "Good to have<br /><span>you here.</span>",
    description: "Create your free account to book a class and join the community.",
    submit: "Create my account",
    showName: true,
    showMessage: false,
    submitDisabled: false
  },
  signin: {
    title: "Good to have<br /><span>you back.</span>",
    description: "Account authentication isn't connected yet. You can register for classes while sign-in is being set up.",
    submit: "Sign-in unavailable",
    showName: false,
    showMessage: false,
    submitDisabled: true
  },
  trainer: {
    title: "Let's get people<br /><span>moving.</span>",
    description: "Tell us where to reach you and a little about what you teach. Our team will be in touch.",
    submit: "Send my application",
    showName: true,
    showMessage: true,
    submitDisabled: false
  },
  booking: {
    title: "Save your<br /><span>spot.</span>",
    description: "Enter your details to request a place in this class.",
    submit: "Request my spot",
    showName: true,
    showMessage: false,
    submitDisabled: false
  }
};

function openModal(type) {
  activeModal = type;
  lastFocusedElement = document.activeElement;
  const content = modalContent[type];
  modalTitle.innerHTML = content.title;
  modalDescription.textContent = content.description;
  nameField.hidden = !content.showName;
  messageField.hidden = !content.showMessage;
  nameField.querySelector("input").required = content.showName;
  messageField.querySelector("input").required = content.showMessage;
  modalForm.querySelector("button[type='submit']").disabled = content.submitDisabled;
  emailField.querySelector("input").value = "";
  nameField.querySelector("input").value = "";
  messageField.querySelector("input").value = "";
  modalForm.querySelector("button[type='submit']").innerHTML = `${content.submit} <span aria-hidden="true">↗</span>`;
  backdrop.hidden = false;
  document.body.classList.add("modal-open");
  (content.showName ? nameField.querySelector("input") : emailField.querySelector("input")).focus();
}

function closeModal() {
  backdrop.hidden = true;
  document.body.classList.remove("modal-open");
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

for (const button of document.querySelectorAll("[data-open-modal]")) {
  button.addEventListener("click", () => openModal(button.dataset.openModal));
}

document.querySelector(".modal-close").addEventListener("click", closeModal);
backdrop.addEventListener("click", event => {
  if (event.target === backdrop) closeModal();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !backdrop.hidden) closeModal();
  if (event.key === "/" && backdrop.hidden && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
});

modalForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submitButton = modalForm.querySelector("button[type='submit']");
  const formData = new FormData(modalForm);
  const payload = {
    name: formData.get("name"),
    email: formData.get("email")
  };

  if (activeModal === "signin") return;
  if (activeModal === "trainer") payload.experience = formData.get("message");
  if (activeModal === "booking") payload.className = selectedClass;

  const endpoints = {
    join: "/api/members",
    trainer: "/api/trainer-applications",
    booking: "/api/bookings"
  };

  submitButton.disabled = true;
  try {
    const response = await fetch(endpoints[activeModal], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The request could not be completed.");
    closeModal();
    showToast(result.message);
  } catch (error) {
    modalDescription.textContent = error.message;
  } finally {
    submitButton.disabled = modalContent[activeModal].submitDisabled;
  }
});

for (const button of document.querySelectorAll("[data-book]")) {
  button.addEventListener("click", () => {
    selectedClass = button.dataset.book;
    openModal("booking");
    modalDescription.textContent = `Enter your details to request a place in ${selectedClass}.`;
  });
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3600);
}

const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
menuToggle.addEventListener("click", () => {
  const isOpen = mainNav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
});
for (const link of mainNav.querySelectorAll("a")) {
  link.addEventListener("click", () => {
    mainNav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
  });
}
