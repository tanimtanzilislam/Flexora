import { animate, inView } from "motion";

const filterContainer = document.querySelector("#class-filters") || document.querySelector(".filter-list");
let filterButtons = [];
const classList = document.querySelector("#class-list");
const searchInput = document.querySelector("#class-search");
const emptyState = document.querySelector("#empty-state");
const classesState = document.querySelector("#classes-state");
const postsState = document.querySelector("#posts-state");
const communityPosts = document.querySelector("#community-posts");
const classDetailsBackdrop = document.querySelector("#class-details-backdrop");
const classDetailsTitle = document.querySelector("#class-details-title");
const classDetailsDescription = document.querySelector("#class-details-description");
const classDetailsTrainer = document.querySelector("#class-details-trainer");
const classDetailsCategory = document.querySelector("#class-details-category");
const classDetailsPrice = document.querySelector("#class-details-price");
const classDetailsDuration = document.querySelector("#class-details-duration");
const classDetailsBookings = document.querySelector("#class-details-bookings");
const classDetailsBook = document.querySelector("#class-details-book");
const classDetails = new Map();
let activeFilter = "all";
let classDetailsReturnFocus = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function safeImageUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function categoryFilterValue(category) {
  const value = category.toLowerCase();
  if (value.includes("strength")) return "strength";
  if (value.includes("mindful") || value.includes("yoga") || value.includes("pilates")) return "mindful";
  if (value.includes("cardio") || value.includes("cycling") || value.includes("ride")) return "cardio";
  return value;
}

function categorySlug(category) {
  return category.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatDuration(value) {
  if (typeof value === "number" && Number.isFinite(value)) return `${value} min`;
  const text = String(value || "");
  return /^\d+$/.test(text) ? `${text} min` : text || "Varies";
}

async function readJsonResponse(response) {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("The server returned an invalid response. Please try again.");
  }
  return response.json();
}

function renderClasses(classes) {
  if (document.body.dataset.page === "classes") renderCategoryFilters(classes);
  classDetails.clear();
  classList.innerHTML = classes.map(item => {
    const category = String(item.category || "Fitness");
    const imageUrl = safeImageUrl(item.imageUrl);
    const details = {
      ...item,
      name: String(item.name || "Fitness class"),
      trainerName: String(item.trainerName || "Kinetra trainer"),
      category,
      price: item.price == null || item.price === ""
        ? "Ask trainer"
        : typeof item.price === "object" && item.price !== null
          ? [item.price.amount, item.price.currency].filter(Boolean).join(" ")
          : String(item.price),
      duration: formatDuration(item.duration),
      description: String(item.description || "A welcoming class led by a Kinetra trainer."),
      bookingCount: Number.isFinite(Number(item.bookingCount)) ? Number(item.bookingCount) : 0
    };
    classDetails.set(String(item.id), details);
    const searchText = `${details.name} ${details.trainerName} ${category}`.toLowerCase();
    const cardCategory = document.body.dataset.page === "classes"
      ? categorySlug(category)
      : categoryFilterValue(category);
    const searchableText = document.body.dataset.page === "classes"
      ? details.name.toLowerCase()
      : searchText;
    const photo = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(details.name)} class" loading="lazy" />`
      : "";
    return `<article class="class-card motion-reveal" data-class-id="${escapeHtml(item.id)}" data-category="${escapeHtml(cardCategory)}" data-search="${escapeHtml(searchableText)}">
      <div class="class-photo">${photo}<span class="photo-label">${escapeHtml(category)}</span><span class="class-duration">${escapeHtml(details.duration)}</span></div>
      <div class="class-card-body">
        <div class="class-time"><span>${document.body.dataset.page === "classes" ? "APPROVED CLASS" : "FEATURED CLASS"}</span><span class="spots">${details.bookingCount} ${details.bookingCount === 1 ? "booking" : "bookings"}</span></div>
        <h3>${escapeHtml(details.name)}</h3>
        <div class="coach-row"><span>${escapeHtml(details.trainerName)}</span><span class="class-price">${escapeHtml(details.price)}</span></div>
        <button class="book-link" type="button" data-class-details="${escapeHtml(item.id)}">View class details <span aria-hidden="true">↗</span></button>
      </div>
    </article>`;
  }).join("");
  classesState.hidden = true;
  filterClasses();
  observeMotion(classList.querySelectorAll(".motion-reveal"));
}

function renderCategoryFilters(classes) {
  const categories = [...new Set(classes.map(item => String(item.category || "Fitness").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  filterContainer.innerHTML = `<button class="filter-button selected" type="button" data-filter="all" aria-pressed="true">All classes</button>
    ${categories.map(category => `<button class="filter-button" type="button" data-filter="${escapeHtml(categorySlug(category))}" aria-pressed="false">${escapeHtml(category)}</button>`).join("")}`;
  bindFilterButtons();
}

function renderLatestPosts(posts) {
  communityPosts.innerHTML = posts.map(post => {
    const date = post.createdAt ? new Date(post.createdAt) : null;
    const dateLabel = date && !Number.isNaN(date.valueOf())
      ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)
      : "Latest";
    const content = String(post.content || "");
    const excerpt = content.length > 180 ? `${content.slice(0, 177).trimEnd()}…` : content;
    return `<article class="community-card community-featured motion-reveal">
      <div class="community-meta"><span class="topic-tag">${escapeHtml(post.category || "COMMUNITY")}</span><span>${escapeHtml(dateLabel)}</span></div>
      <h3>${escapeHtml(post.title || "Community post")}</h3>
      <p>${escapeHtml(excerpt || "A new story from the Kinetra community.")}</p>
      <div class="post-author"><span class="author-initial" aria-hidden="true">${escapeHtml(String(post.authorName || "K").trim().charAt(0).toUpperCase())}</span><span><strong>${escapeHtml(post.authorName || "Kinetra member")}</strong><small>Community member</small></span></div>
    </article>`;
  }).join("");
  postsState.hidden = true;
  observeMotion(communityPosts.querySelectorAll(".motion-reveal"));
}

function showContentError(element, content) {
  element.textContent = content;
  element.hidden = false;
}

async function loadHomeContent() {
  try {
    const isClassesPage = document.body.dataset.page === "classes";
    const response = await fetch(isClassesPage ? "/api/classes" : "/api/home");
    const result = await readJsonResponse(response);
    if (!response.ok) throw new Error(result.error || "Homepage content could not be loaded.");
    const classes = isClassesPage ? result.classes || [] : result.featuredClasses || [];
    renderClasses(classes);
    if (!isClassesPage) {
      renderLatestPosts(result.latestPosts || []);
      if (!result.latestPosts?.length) showContentError(postsState, "No community posts have been published yet.");
    }
    if (!classes.length) {
      showContentError(classesState, isClassesPage
        ? "No approved classes are available right now."
        : "No approved classes have been published yet.");
    }
  } catch (error) {
    showContentError(classesState, error.message);
    if (postsState) showContentError(postsState, error.message);
  }
}

function filterClasses() {
  const query = searchInput.value.trim().toLowerCase();
  const classCards = [...classList.querySelectorAll(".class-card")];
  let visibleCount = 0;

  for (const card of classCards) {
    const matchesCategory = activeFilter === "all" || card.dataset.category.includes(activeFilter);
    const matchesSearch = card.dataset.search.includes(query);
    const isVisible = matchesCategory && matchesSearch;
    card.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  }

  emptyState.hidden = visibleCount !== 0;
}

function bindFilterButtons() {
  filterButtons = [...filterContainer.querySelectorAll(".filter-button")];
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
}
bindFilterButtons();

searchInput.addEventListener("input", filterClasses);

classList.addEventListener("click", event => {
  const detailsButton = event.target.closest("[data-class-details]");
  if (!detailsButton) return;
  const item = classDetails.get(detailsButton.dataset.classDetails);
  if (!item) return;

  classDetailsReturnFocus = detailsButton;
  classDetailsTitle.textContent = item.name;
  classDetailsDescription.textContent = item.description;
  classDetailsTrainer.textContent = item.trainerName;
  classDetailsCategory.textContent = item.category;
  classDetailsPrice.textContent = item.price;
  classDetailsDuration.textContent = item.duration;
  classDetailsBookings.textContent = String(item.bookingCount);
  classDetailsBackdrop.hidden = false;
  document.body.classList.add("modal-open");
  document.querySelector("#class-details-close").focus();
});

function closeClassDetails() {
  classDetailsBackdrop.hidden = true;
  document.body.classList.remove("modal-open");
  if (classDetailsReturnFocus instanceof HTMLElement) classDetailsReturnFocus.focus();
}

document.querySelector("#class-details-close").addEventListener("click", closeClassDetails);
classDetailsBackdrop.addEventListener("click", event => {
  if (event.target === classDetailsBackdrop) closeClassDetails();
});
classDetailsBook.addEventListener("click", () => {
  const item = classDetails.get(classDetailsReturnFocus?.dataset.classDetails);
  if (!item) return;
  selectedClass = item.name;
  classDetailsBackdrop.hidden = true;
  openModal("booking", classDetailsReturnFocus);
  modalDescription.textContent = `Enter your details to request a place in ${selectedClass}.`;
});

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

function openModal(type, returnFocusTo = document.activeElement) {
  activeModal = type;
  lastFocusedElement = returnFocusTo;
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
  if (event.key === "Escape" && !classDetailsBackdrop.hidden) closeClassDetails();
  if (event.key === "/" && backdrop.hidden && classDetailsBackdrop.hidden && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
});

modalForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submittedModal = activeModal;
  const submitButton = modalForm.querySelector("button[type='submit']");
  const formData = new FormData(modalForm);
  const payload = {
    name: formData.get("name"),
    email: formData.get("email")
  };

  if (submittedModal === "signin") return;
  if (submittedModal === "trainer") payload.experience = formData.get("message");
  if (submittedModal === "booking") payload.className = selectedClass;

  const endpoints = {
    join: "/api/members",
    trainer: "/api/trainer-applications",
    booking: "/api/bookings"
  };

  submitButton.disabled = true;
  try {
    const response = await fetch(endpoints[submittedModal], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await readJsonResponse(response);
    if (!response.ok) throw new Error(result.error || "The request could not be completed.");
    if (activeModal === submittedModal && !backdrop.hidden) {
      closeModal();
      showToast(result.message);
    }
  } catch (error) {
    if (activeModal === submittedModal && !backdrop.hidden) modalDescription.textContent = error.message;
  } finally {
    if (activeModal === submittedModal) submitButton.disabled = modalContent[submittedModal].submitDisabled;
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

const observedElements = new WeakSet();
function observeMotion(elements) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const element of elements) {
    if (observedElements.has(element)) continue;
    observedElements.add(element);
    inView(element, () => {
      animate(element, { opacity: [0, 1], y: [18, 0] }, { duration: 0.55, ease: "easeOut" });
    }, { amount: 0.15 });
  }
}

observeMotion(document.querySelectorAll(".motion-reveal"));
loadHomeContent();

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
