import { animate, inView } from "motion";
import { createAuthClient } from "better-auth/client";

const authClient = createAuthClient();

const filterContainer = document.querySelector("#class-filters") || document.querySelector(".filter-list");
let filterButtons = [];
const classList = document.querySelector("#class-list");
const searchInput = document.querySelector("#class-search");
const emptyState = document.querySelector("#empty-state");
const classesState = document.querySelector("#classes-state");
const postsState = document.querySelector("#posts-state");
const communityPosts = document.querySelector("#community-posts");
const communityPageState = document.querySelector("#community-page-state");
const communityPagePosts = document.querySelector("#community-page-posts");
const forumPostState = document.querySelector("#forum-post-state");
const forumPostContent = document.querySelector("#forum-post-content");
const forumPostInteractions = document.querySelector("#forum-post-interactions");
const forumCommentList = document.querySelector("#forum-comment-list");
const forumCommentForm = document.querySelector("#forum-comment-form");
const dashboardState = document.querySelector("#dashboard-state");
const dashboardFavorites = document.querySelector("#dashboard-favorites");
const dashboardEmpty = document.querySelector("#dashboard-empty");
let activeFilter = "all";
let currentPrivateClass = null;
let currentClassFavorited = false;

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

function formatClassPrice(item) {
  if (item.priceInMinorUnits != null) {
    return `${(Number(item.priceInMinorUnits) / 100).toFixed(2)} ${String(item.currency || "").toUpperCase()}`;
  }
  if (typeof item.price === "object" && item.price !== null) {
    return [item.price.amount, item.price.currency].filter(Boolean).join(" ");
  }
  return String(item.price ?? "Ask trainer");
}

function formatSchedule(value) {
  if (!value) return "Schedule to be announced";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(entry => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        return [entry.day || entry.date, entry.time || entry.startTime, entry.endTime ? `– ${entry.endTime}` : ""]
          .filter(Boolean)
          .join(" ");
      }
      return "";
    }).filter(Boolean).join(" · ") || "Schedule to be announced";
  }
  if (typeof value === "object") {
    return Object.entries(value).map(([day, time]) => `${day}: ${typeof time === "string" ? time : JSON.stringify(time)}`).join(" · ");
  }
  return "Schedule to be announced";
}

async function readJsonResponse(response) {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("The server returned an invalid response. Please try again.");
  }
  return response.json();
}

function renderClasses(classes) {
  if (document.body.dataset.page === "classes") renderCategoryFilters(classes);
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
        <a class="book-link" href="/classes/${encodeURIComponent(String(item.id))}">View details <span aria-hidden="true">↗</span></a>
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

function renderForumPostCards(posts, container) {
  container.innerHTML = posts.map(post => {
    const date = post.createdAt ? new Date(post.createdAt) : null;
    const dateLabel = date && !Number.isNaN(date.valueOf())
      ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)
      : "Latest";
    const content = String(post.content || "");
    const excerpt = content.length > 180 ? `${content.slice(0, 177).trimEnd()}…` : content;
    const imageUrl = safeImageUrl(post.imageUrl);
    const postUrl = `/community/${encodeURIComponent(String(post.id))}`;
    const image = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" />`
      : `<div class="forum-card-image-placeholder" role="img" aria-label="Kinetra community post"><span aria-hidden="true">✳</span></div>`;
    return `<article class="community-card community-featured forum-post-card motion-reveal">
      <a class="forum-card-image" href="${postUrl}" tabindex="-1" aria-hidden="true">${image}</a>
      <div class="forum-card-copy">
        <div class="community-meta"><span class="topic-tag">${escapeHtml(post.category || "COMMUNITY")}</span><span>${escapeHtml(dateLabel)}</span></div>
        <h3><a href="${postUrl}">${escapeHtml(post.title || "Community post")}</a></h3>
        <p>${escapeHtml(excerpt || "A new story from the Kinetra community.")}</p>
        <div class="post-author"><span class="author-initial" aria-hidden="true">${escapeHtml(String(post.authorName || "K").trim().charAt(0).toUpperCase())}</span><span><strong>${escapeHtml(post.authorName || "Kinetra member")}</strong><small>${escapeHtml(post.authorRole || "COMMUNITY")}</small></span></div>
        <a class="book-link forum-read-more" href="${postUrl}">Read More <span aria-hidden="true">↗</span></a>
      </div>
    </article>`;
  }).join("");
  observeMotion(container.querySelectorAll(".motion-reveal"));
}

function renderLatestPosts(posts) {
  renderForumPostCards(posts, communityPosts);
  postsState.hidden = true;
}

async function loadCommunityPage() {
  try {
    const response = await fetch("/api/community");
    const result = await readJsonResponse(response);
    if (!response.ok) throw new Error(result.error || "Community posts could not be loaded.");
    renderForumPostCards(result.posts || [], communityPagePosts);
    if (result.posts?.length) communityPageState.hidden = true;
    else showContentError(communityPageState, "No community posts have been published yet.");
  } catch (error) {
    showContentError(communityPageState, error.message);
  }
}

async function loadForumPostPage() {
  const postId = window.location.pathname.split("/").pop();
  try {
    const response = await fetch(`/api/community/${encodeURIComponent(postId)}`);
    const result = await readJsonResponse(response);
    if (!response.ok) throw new Error(result.error || "Community post could not be loaded.");
    const post = result.post;
    document.title = `${post.title} — Kinetra Community`;
    document.querySelector("#forum-post-title").textContent = post.title;
    document.querySelector("#forum-post-category").textContent = post.category || "COMMUNITY";
    document.querySelector("#forum-post-author").textContent = `By ${post.authorName} · ${post.authorRole}`;
    document.querySelector("#forum-post-body").textContent = post.content;
    document.querySelector("#forum-like-count").textContent = String(result.likes);
    document.querySelector("#forum-dislike-count").textContent = String(result.dislikes);
    for (const button of forumPostInteractions.querySelectorAll("[data-vote]")) {
      const selected = button.dataset.vote === result.userVote;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("selected", selected);
    }
    renderForumComments(result.comments || [], result.currentUserId);
    const imageContainer = document.querySelector("#forum-post-image");
    const imageUrl = safeImageUrl(post.imageUrl);
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = post.title;
      imageContainer.replaceChildren(image);
    } else {
      imageContainer.classList.add("forum-card-image-placeholder");
      imageContainer.setAttribute("role", "img");
      imageContainer.setAttribute("aria-label", "Kinetra community post");
      imageContainer.textContent = "✳";
    }
    forumPostState.hidden = true;
    forumPostContent.hidden = false;
  } catch (error) {
    showContentError(forumPostState, error.message);
  }
}

function renderForumComments(comments, currentUserId) {
  const commentsByParent = new Map();
  for (const comment of comments) {
    const parentId = comment.parentCommentId || "";
    const siblings = commentsByParent.get(parentId) || [];
    siblings.push(comment);
    commentsByParent.set(parentId, siblings);
  }

  function renderBranch(parentId, depth) {
    return (commentsByParent.get(parentId) || []).map(comment => {
      const isOwner = comment.authorId === currentUserId;
      const avatarUrl = safeImageUrl(comment.authorImage);
      const avatar = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="" />`
        : `<span class="author-initial" aria-hidden="true">${escapeHtml(String(comment.authorName || "M").trim().charAt(0).toUpperCase())}</span>`;
      const content = comment.deleted ? "This comment was deleted." : comment.content;
      const controls = comment.deleted ? "" : `<div class="comment-actions">
        <button class="text-link" type="button" data-reply-comment="${escapeHtml(comment.id)}">Reply</button>
        ${isOwner ? `<button class="text-link" type="button" data-edit-comment="${escapeHtml(comment.id)}">Edit</button><button class="text-link comment-delete" type="button" data-delete-comment="${escapeHtml(comment.id)}">Delete</button>` : ""}
      </div>`;
      return `<article class="forum-comment${comment.deleted ? " deleted" : ""}" style="--comment-depth:${Math.min(depth, 5)}" data-comment-id="${escapeHtml(comment.id)}">
        <div class="comment-heading">${avatar}<span><strong>${escapeHtml(comment.authorName || "Member")}</strong><small>${escapeHtml(new Date(comment.createdAt).toLocaleString())}${comment.updatedAt ? " · edited" : ""}</small></span></div>
        <p class="forum-comment-body">${escapeHtml(content)}</p>
        ${controls}
        <form class="comment-reply-form" data-comment-form data-parent-comment-id="${escapeHtml(comment.id)}" hidden>
          <label class="form-field">Your reply<textarea name="content" maxlength="2000" required placeholder="Write a thoughtful reply…"></textarea></label>
          <button class="button button-dark button-small" type="submit">Post reply</button>
        </form>
        <div class="forum-comment-replies">${renderBranch(comment.id, depth + 1)}</div>
      </article>`;
    }).join("");
  }

  forumCommentList.innerHTML = renderBranch("", 0);
  document.querySelector("#forum-comment-count").textContent = String(comments.length);
}

function renderDashboardFavorites(classes) {
  dashboardFavorites.innerHTML = classes.map(item => {
    const imageUrl = safeImageUrl(item.imageUrl);
    const photo = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)} class" loading="lazy" />`
      : "";
    return `<article class="class-card motion-reveal" data-favorite-card="${escapeHtml(item.id)}">
      <div class="class-photo">${photo}<span class="photo-label">${escapeHtml(item.category || "Fitness")}</span></div>
      <div class="class-card-body">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="coach-row"><span>${escapeHtml(item.trainerName)}</span><span class="class-price">${escapeHtml(formatClassPrice(item))}</span></div>
        <a class="book-link" href="/classes/${encodeURIComponent(item.id)}">View details <span aria-hidden="true">↗</span></a>
        <button class="book-link favorite-remove-link" type="button" data-remove-favorite="${escapeHtml(item.id)}">Remove Favorite <span aria-hidden="true">×</span></button>
      </div>
    </article>`;
  }).join("");
  dashboardEmpty.hidden = classes.length !== 0;
  observeMotion(dashboardFavorites.querySelectorAll(".motion-reveal"));
}

async function loadDashboardPage() {
  try {
    const response = await fetch("/api/dashboard");
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Your dashboard could not be loaded.");
    document.querySelector("#dashboard-member-name").textContent = `${result.user.name || "member"}.`;
    renderDashboardFavorites(result.favorites || []);
    dashboardState.hidden = true;
  } catch (error) {
    showContentError(dashboardState, error.message);
  }
}

function showContentError(element, content) {
  if (!element) return;
  element.textContent = content;
  element.hidden = false;
}

async function loadClassDetailsPage() {
  const classId = window.location.pathname.split("/").pop();
  const state = document.querySelector("#class-detail-state");
  const content = document.querySelector("#class-detail-content");
  try {
    const response = await fetch(`/api/classes/${encodeURIComponent(classId)}`);
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Class details could not be loaded.");
    const item = result.class;
    if (!item) throw new Error("Approved class not found.");
    currentPrivateClass = item;
    document.title = `${item.name} — Kinetra`;
    document.querySelector("#class-detail-name").textContent = item.name;
    document.querySelector("#class-detail-category").textContent = item.category;
    document.querySelector("#class-detail-description").textContent = item.description || "A welcoming class led by a Kinetra trainer.";
    document.querySelector("#class-detail-trainer").textContent = item.trainerName;
    document.querySelector("#class-detail-schedule").textContent = formatSchedule(item.schedule);
    document.querySelector("#class-detail-duration").textContent = formatDuration(item.duration);
    document.querySelector("#class-detail-price").textContent = formatClassPrice(item);
    document.querySelector("#class-detail-bookings").textContent = String(item.bookingCount || 0);
    const imageUrl = safeImageUrl(item.imageUrl);
    const imageContainer = document.querySelector("#class-detail-image");
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = `${item.name} class`;
      imageContainer.replaceChildren(image);
    }
    setAlreadyBooked(result.alreadyBooked);
    setClassFavoriteState(result.favorited);
    state.hidden = true;
    content.hidden = false;
  } catch (error) {
    showContentError(state, error.message);
  }
}

function setAlreadyBooked(alreadyBooked) {
  const button = document.querySelector("#class-detail-book");
  if (!button) return;
  button.textContent = alreadyBooked ? "Already Booked" : "Book now ↗";
  button.setAttribute("aria-disabled", String(alreadyBooked));
  button.classList.toggle("already-booked", alreadyBooked);
}

function setClassFavoriteState(favorited) {
  currentClassFavorited = Boolean(favorited);
  const button = document.querySelector("#class-detail-favorite");
  if (!button) return;
  button.textContent = currentClassFavorited ? "Remove Favorite" : "Add to Favorites";
  button.setAttribute("aria-pressed", String(currentClassFavorited));
}

async function loadPaymentPage() {
  const params = new URLSearchParams(window.location.search);
  const classId = params.get("classId");
  const state = document.querySelector("#payment-state");
  const checkoutButton = document.querySelector("#checkout-button");
  const summary = document.querySelector("#payment-class-summary");
  if (!classId) {
    showContentError(state, "A class must be selected before checkout.");
    return;
  }
  document.querySelector("#payment-back-link").href = `/classes/${encodeURIComponent(classId)}`;

  try {
    const response = await fetch(`/api/classes/${encodeURIComponent(classId)}`);
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Class details could not be loaded.");
    const item = result.class;
    document.querySelector("#payment-class-name").textContent = item.name;
    document.querySelector("#payment-class-meta").textContent = `${item.trainerName} · ${item.category} · ${formatDuration(item.duration)}`;
    document.querySelector("#payment-class-schedule").textContent = formatSchedule(item.schedule);
    document.querySelector("#payment-class-price").textContent = formatClassPrice(item);
    summary.hidden = false;

    const sessionId = params.get("session_id");
    if (sessionId) {
      const verifyResponse = await fetch(`/api/checkout/verify?session_id=${encodeURIComponent(sessionId)}`);
      const verification = await readJsonResponse(verifyResponse);
      if (!verifyResponse.ok) throw new Error(verification.error || "Payment could not be verified.");
      if (verification.paid) {
        document.querySelector("#payment-heading").textContent = "You're all set.";
        showContentError(state, "Payment succeeded and your class booking is confirmed.");
        checkoutButton.hidden = true;
        document.querySelector("#payment-dashboard-link").hidden = false;
        return;
      }
      showContentError(state, "Payment has not completed yet. Finish checkout to confirm your booking.");
    } else if (params.get("result") === "cancelled") {
      showContentError(state, "Checkout was cancelled. Your class is not booked yet.");
    } else {
      state.hidden = true;
    }
    checkoutButton.disabled = false;
    checkoutButton.addEventListener("click", async () => {
      checkoutButton.disabled = true;
      try {
        const checkoutResponse = await fetch("/api/checkout/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classId })
        });
        const checkoutResult = await readJsonResponse(checkoutResponse);
        if (checkoutResponse.status === 409 && checkoutResult.alreadyBooked) {
          showToast("You have already booked this class.");
          checkoutButton.textContent = "Already Booked";
          return;
        }
        if (!checkoutResponse.ok) throw new Error(checkoutResult.error || "Checkout could not be started.");
        window.location.assign(checkoutResult.url);
      } catch (error) {
        showContentError(state, error.message);
        checkoutButton.disabled = false;
      }
    });
  } catch (error) {
    showContentError(state, error.message);
  }
}

async function loadHomeContent() {
  if (document.body.dataset.page === "community") {
    await loadCommunityPage();
    return;
  }
  if (document.body.dataset.page === "forum-post") {
    await loadForumPostPage();
    return;
  }
  if (document.body.dataset.page === "dashboard") {
    await loadDashboardPage();
    return;
  }
  if (document.body.dataset.page === "class-details") {
    await loadClassDetailsPage();
    return;
  }
  if (document.body.dataset.page === "payment") {
    await loadPaymentPage();
    return;
  }
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
  if (!filterContainer) return;
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

searchInput?.addEventListener("input", filterClasses);

document.querySelector("#class-detail-book")?.addEventListener("click", async () => {
  if (!currentPrivateClass) return;
  const button = document.querySelector("#class-detail-book");
  if (button.getAttribute("aria-disabled") === "true") {
    showToast("You have already booked this class.");
    return;
  }
  try {
    const response = await fetch(`/api/bookings/check?classId=${encodeURIComponent(currentPrivateClass.id)}`);
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.assign(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Booking status could not be checked.");
    if (result.alreadyBooked) {
      setAlreadyBooked(true);
      showToast("You have already booked this class.");
      return;
    }
    window.location.assign(`/payment?classId=${encodeURIComponent(currentPrivateClass.id)}`);
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#class-detail-favorite")?.addEventListener("click", async event => {
  if (!currentPrivateClass) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch(currentClassFavorited
      ? `/api/favorites?classId=${encodeURIComponent(currentPrivateClass.id)}`
      : "/api/favorites", {
      method: currentClassFavorited ? "DELETE" : "POST",
      headers: currentClassFavorited ? {} : { "Content-Type": "application/json" },
      body: currentClassFavorited ? undefined : JSON.stringify({ classId: currentPrivateClass.id })
    });
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.assign(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (response.status === 409 && result.alreadyFavorite) {
      setClassFavoriteState(true);
      showToast("This class is already in your favorites.");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Your favorites could not be updated.");
    setClassFavoriteState(result.favorited);
    showToast(result.message);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

dashboardFavorites?.addEventListener("click", async event => {
  const button = event.target.closest("[data-remove-favorite]");
  if (!button) return;
  button.disabled = true;
  const classId = button.dataset.removeFavorite;
  try {
    const response = await fetch(`/api/favorites?classId=${encodeURIComponent(classId)}`, { method: "DELETE" });
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.assign(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "The favorite could not be removed.");
    dashboardFavorites.querySelector(`[data-favorite-card="${CSS.escape(classId)}"]`)?.remove();
    dashboardEmpty.hidden = dashboardFavorites.children.length !== 0;
    showToast(result.message);
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});

const backdrop = document.querySelector("#modal-backdrop");
const modalTitle = document.querySelector("#modal-title");
const modalDescription = document.querySelector("#modal-description");
const nameField = document.querySelector("#name-field");
const emailField = document.querySelector("#email-field");
const passwordField = document.querySelector("#password-field");
const messageField = document.querySelector("#message-field");
const modalForm = document.querySelector("#modal-form");
const toast = document.querySelector("#toast");
let toastTimer;
let activeModal = "join";
let lastFocusedElement;

const modalContent = {
  join: {
    title: "Good to have<br /><span>you here.</span>",
    description: "Create your Kinetra account to view class details and book your next session.",
    submit: "Create my account",
    showName: true,
    showPassword: true,
    showMessage: false,
    submitDisabled: false
  },
  signin: {
    title: "Good to have<br /><span>you back.</span>",
    description: "Log in to access private class details and manage your bookings.",
    submit: "Log in",
    showName: false,
    showPassword: true,
    showMessage: false,
    submitDisabled: false
  },
  trainer: {
    title: "Let's get people<br /><span>moving.</span>",
    description: "Tell us where to reach you and a little about what you teach. Our team will be in touch.",
    submit: "Send my application",
    showName: true,
    showPassword: false,
    showMessage: true,
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
  passwordField.hidden = !content.showPassword;
  messageField.hidden = !content.showMessage;
  nameField.querySelector("input").required = content.showName;
  passwordField.querySelector("input").required = content.showPassword;
  passwordField.querySelector("input").autocomplete = type === "signin" ? "current-password" : "new-password";
  messageField.querySelector("input").required = content.showMessage;
  modalForm.querySelector("button[type='submit']").disabled = content.submitDisabled;
  emailField.querySelector("input").value = "";
  nameField.querySelector("input").value = "";
  passwordField.querySelector("input").value = "";
  messageField.querySelector("input").value = "";
  modalForm.querySelector("button[type='submit']").innerHTML = `${content.submit} <span aria-hidden="true">↗</span>`;
  backdrop.hidden = false;
  document.body.classList.add("modal-open");
  (content.showName ? nameField.querySelector("input") : content.showPassword ? passwordField.querySelector("input") : emailField.querySelector("input")).focus();
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
  if (event.key === "/" && backdrop.hidden && searchInput && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
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
    email: formData.get("email"),
    password: formData.get("password")
  };

  if (submittedModal === "trainer") payload.experience = formData.get("message");
  const endpoints = {
    join: "/api/auth/register",
    signin: "/api/auth/login",
    trainer: "/api/trainer-applications"
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
    if (submittedModal === "join" || submittedModal === "signin") {
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      if (returnTo?.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\")) {
        window.location.assign(returnTo);
        return;
      }
    }
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
if (new URLSearchParams(window.location.search).get("auth") === "login" && modalContent.signin) {
  openModal("signin");
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
