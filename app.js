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

const modalContent = {
  join: {
    title: "Good to have<br /><span>you here.</span>",
    description: "Create your free account to book a class and join the community.",
    submit: "Create my account",
    showName: true,
    showMessage: false
  },
  signin: {
    title: "Good to have<br /><span>you back.</span>",
    description: "Sign in to book your next class and catch up with your community.",
    submit: "Send me a sign-in link",
    showName: false,
    showMessage: false
  },
  trainer: {
    title: "Let's get people<br /><span>moving.</span>",
    description: "Tell us where to reach you and a little about what you teach. Our team will be in touch.",
    submit: "Send my application",
    showName: true,
    showMessage: true
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

modalForm.addEventListener("submit", event => {
  event.preventDefault();
  const messages = {
    join: "You're on your way. Account signup is ready to connect.",
    signin: "Check your inbox for your sign-in link.",
    trainer: "Thanks for applying. Our trainer team will be in touch."
  };
  closeModal();
  showToast(messages[activeModal]);
});

for (const button of document.querySelectorAll("[data-book]")) {
  button.addEventListener("click", () => {
    openModal("join");
    modalDescription.textContent = `Create your free account to book ${button.dataset.book} and save your spot.`;
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
