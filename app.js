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
const dashboardNav = document.querySelector("#dashboard-nav");
const dashboardView = document.querySelector("#dashboard-view");
const dashboardDialog = document.querySelector("#dashboard-dialog");
const dashboardDialogContent = document.querySelector("#dashboard-dialog-content");
let activeFilter = "all";
let currentPrivateClass = null;
let currentClassFavorited = false;
let currentForumPostId = null;

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
  currentForumPostId = postId;
  try {
    const response = await fetch(`/api/community/${encodeURIComponent(postId)}`);
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
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
        <p class="forum-comment-body" data-comment-content>${escapeHtml(content)}</p>
        ${isOwner && !comment.deleted ? `<form class="comment-edit-form" data-comment-edit-form hidden>
          <label class="form-field">Edit your comment<textarea name="content" maxlength="2000" required>${escapeHtml(comment.content)}</textarea></label>
          <button class="button button-dark button-small" type="submit">Save changes</button>
          <button class="text-link" type="button" data-cancel-edit>Cancel</button>
        </form>` : ""}
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

async function submitForumComment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const content = form.elements.content.value.trim();
  if (!content || !currentForumPostId) return;
  const isEdit = form.matches("[data-comment-edit-form]");
  const commentId = isEdit ? form.closest("[data-comment-id]")?.dataset.commentId : null;
  const parentCommentId = form.dataset.parentCommentId || "";
  const endpoint = commentId
    ? `/api/community/${encodeURIComponent(currentForumPostId)}/comments/${encodeURIComponent(commentId)}`
    : `/api/community/${encodeURIComponent(currentForumPostId)}/comments`;
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const response = await fetch(endpoint, {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isEdit ? { content } : { content, parentCommentId: parentCommentId || null })
    });
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.assign(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Your comment could not be saved.");
    await loadForumPostPage();
    showToast(result.message);
  } catch (error) {
    showToast(error.message);
    submitButton.disabled = false;
  }
}

forumCommentForm?.addEventListener("submit", submitForumComment);
forumCommentList?.addEventListener("submit", event => {
  if (event.target.matches("[data-comment-form], [data-comment-edit-form]")) {
    submitForumComment(event);
  }
});

forumCommentList?.addEventListener("click", async event => {
  const replyButton = event.target.closest("[data-reply-comment]");
  if (replyButton) {
    const comment = replyButton.closest("[data-comment-id]");
    const form = comment.querySelector("[data-comment-form]");
    form.hidden = !form.hidden;
    if (!form.hidden) form.elements.content.focus();
    return;
  }

  const editButton = event.target.closest("[data-edit-comment]");
  if (editButton) {
    const comment = editButton.closest("[data-comment-id]");
    const editForm = comment.querySelector("[data-comment-edit-form]");
    comment.querySelector("[data-comment-content]").hidden = true;
    editForm.hidden = false;
    editForm.elements.content.focus();
    return;
  }

  const cancelButton = event.target.closest("[data-cancel-edit]");
  if (cancelButton) {
    const comment = cancelButton.closest("[data-comment-id]");
    comment.querySelector("[data-comment-edit-form]").hidden = true;
    comment.querySelector("[data-comment-content]").hidden = false;
    return;
  }

  const deleteButton = event.target.closest("[data-delete-comment]");
  if (!deleteButton || !window.confirm("Delete this comment?")) return;
  const commentId = deleteButton.dataset.deleteComment;
  deleteButton.disabled = true;
  try {
    const response = await fetch(`/api/community/${encodeURIComponent(currentForumPostId)}/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE"
    });
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.assign(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Your comment could not be deleted.");
    await loadForumPostPage();
    showToast(result.message);
  } catch (error) {
    showToast(error.message);
    deleteButton.disabled = false;
  }
});

forumPostInteractions?.addEventListener("click", async event => {
  const button = event.target.closest("[data-vote]");
  if (!button || !currentForumPostId) return;
  const removingVote = button.getAttribute("aria-pressed") === "true";
  button.disabled = true;
  try {
    const response = await fetch(`/api/community/${encodeURIComponent(currentForumPostId)}/votes`, {
      method: removingVote ? "DELETE" : "POST",
      ...(removingVote ? {} : {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: button.dataset.vote })
      })
    });
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.assign(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Your vote could not be saved.");
    document.querySelector("#forum-like-count").textContent = String(result.likes);
    document.querySelector("#forum-dislike-count").textContent = String(result.dislikes);
    for (const voteButton of forumPostInteractions.querySelectorAll("[data-vote]")) {
      const selected = voteButton.dataset.vote === result.userVote;
      voteButton.setAttribute("aria-pressed", String(selected));
      voteButton.classList.toggle("selected", selected);
    }
    showToast(result.message);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

async function loadDashboardPage() {
  try {
    const response = await fetch("/api/dashboard");
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Your dashboard could not be loaded.");
    const role = ["member", "trainer", "admin"].includes(result.user.role) ? result.user.role : "member";
    document.querySelector("#dashboard-member-name").textContent = `${result.user.name || "member"}.`;
    document.querySelector("#dashboard-role").textContent = role === "member" ? "User" : role;
    document.querySelector("#dashboard-title").textContent = `${role[0].toUpperCase()}${role.slice(1)} dashboard`;
    renderDashboardNavigation(role);
    renderDashboardView(role, result, new URLSearchParams(window.location.search).get("view") || "overview");
    dashboardView.hidden = false;
    dashboardState.hidden = true;
  } catch (error) {
    showContentError(dashboardState, error.message);
  }
}

const dashboardNavigation = {
  member: [["overview", "Overview"], ["bookings", "Booked classes"], ["apply", "Apply as trainer"], ["favorites", "Favorite classes"]],
  trainer: [["overview", "Overview"], ["add-class", "Add class"], ["classes", "My classes"], ["add-post", "Add forum post"], ["posts", "My forum posts"]],
  admin: [["overview", "Overview"]]
};

function dashboardStat(label, value) {
  return `<article class="dashboard-stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function dashboardProfile(user) {
  const roleLabel = user.role === "member" ? "User" : user.role;
  const image = safeImageUrl(user.image);
  const avatar = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(user.name)} profile photo" />`
    : `<span class="dashboard-avatar-initial">${escapeHtml(String(user.name || "M").charAt(0).toUpperCase())}</span>`;
  return `<section class="dashboard-profile-card">
    <div class="dashboard-profile-avatar">${avatar}</div>
    <div><span class="dashboard-section-label">PROFILE DETAILS</span><h2>${escapeHtml(user.name || "Kinetra member")}</h2><p>${escapeHtml(user.email || "")}</p><span class="dashboard-role-badge">${escapeHtml(roleLabel)}</span></div>
  </section>`;
}

function dashboardStats(cards) {
  return `<div class="dashboard-stats">${cards.map(([label, value]) => dashboardStat(label, value)).join("")}</div>`;
}

function renderDashboardNavigation(role) {
  const currentView = new URLSearchParams(window.location.search).get("view") || "overview";
  dashboardNav.innerHTML = dashboardNavigation[role].map(([view, label]) =>
    `<a class="dashboard-nav-link${view === currentView ? " active" : ""}" href="/dashboard?view=${encodeURIComponent(view)}"${view === currentView ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`
  ).join("");
}

function renderDashboardView(role, result, view) {
  const availableViews = dashboardNavigation[role].map(([name]) => name);
  const activeView = availableViews.includes(view) ? view : "overview";
  const user = result.user;
  const profile = dashboardProfile(user);
  let content = "";

  if (activeView === "overview" && role === "member") {
    const application = result.application;
    const applicationStatus = application?.status || "not submitted";
    content = `${dashboardStats([["Total Booked Classes", result.stats.bookedClasses], ["Total Favorites", result.stats.favorites]])}
      ${profile}
      <section class="dashboard-application-card"><div><span class="dashboard-section-label">TRAINER APPLICATION</span><h2>${escapeHtml(applicationStatus)}</h2>
      ${application ? `<p>${escapeHtml(application.specialty || "Specialty not specified")} · ${escapeHtml(String(application.experienceYears ?? "0"))} years experience</p>
        ${application.feedback ? `<p class="dashboard-feedback"><strong>Admin feedback:</strong> ${escapeHtml(application.feedback)}</p>` : ""}
      ` : "<p>Apply to teach classes on Kinetra. Your application status and feedback will appear here.</p>"}
      </div>${!application || ["rejected", "withdrawn"].includes(application.status) ? '<a class="button button-lime" href="/dashboard?view=apply">Apply as trainer <span aria-hidden="true">↗</span></a>' : ""}</section>`;
  } else if (activeView === "overview" && role === "trainer") {
    content = `${dashboardStats([["Total Classes Created", result.stats.classesCreated], ["Total Students Enrolled", result.stats.studentsEnrolled]])}${profile}
      <section class="dashboard-application-card"><div><span class="dashboard-section-label">TRAINER TOOLKIT</span><h2>Build your Kinetra space</h2><p>Create classes for admin review and share helpful stories with the community.</p></div><a class="button button-lime" href="/dashboard?view=add-class">Add a class <span aria-hidden="true">↗</span></a></section>`;
  } else if (activeView === "overview" && role === "admin") {
    content = `${dashboardStats([["Total Users", result.stats.totalUsers], ["Total Classes", result.stats.totalClasses], ["Total Booked Classes", result.stats.totalBookedClasses]])}${profile}`;
  } else if (activeView === "bookings") {
    content = `<h2 class="dashboard-view-title">Booked classes</h2>${result.bookings.length
      ? `<div class="dashboard-table-wrap"><table class="dashboard-table"><thead><tr><th>Class Name</th><th>Trainer</th><th>Schedule</th><th></th></tr></thead><tbody>${result.bookings.map(item =>
        `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.trainerName)}</td><td>${escapeHtml(formatSchedule(item.schedule))}</td><td><a class="text-link" href="/classes/${encodeURIComponent(item.id)}">View details ↗</a></td></tr>`
      ).join("")}</tbody></table></div>` : '<p class="dashboard-empty-state">Your paid class bookings will appear here.</p>'}`;
  } else if (activeView === "apply") {
    const application = result.application;
    content = `<h2 class="dashboard-view-title">Apply as a trainer</h2>${application && !["rejected", "withdrawn"].includes(application.status)
      ? `<p class="dashboard-empty-state">Your application is <strong>${escapeHtml(application.status)}</strong>. You can submit another application if it is rejected or withdrawn.</p>`
      : `<form class="dashboard-form" data-dashboard-form="application">
        <label>Experience (years)<input type="number" name="experienceYears" min="0" max="60" required value="${escapeHtml(application?.experienceYears || "")}" /></label>
        <label>Specialty<input name="specialty" maxlength="100" required placeholder="Yoga, weights, cardio…" value="${escapeHtml(application?.specialty || "")}" /></label>
        <button class="button button-lime" type="submit">Submit application <span aria-hidden="true">↗</span></button>
      </form>`}`;
  } else if (activeView === "favorites") {
    content = `<h2 class="dashboard-view-title">Favorite classes</h2>${result.favorites.length
      ? `<div class="class-grid favorites-grid">${result.favorites.map(item => renderDashboardFavorite(item)).join("")}</div>`
      : '<p class="dashboard-empty-state">You haven’t saved any classes yet. Browse classes and tap “Add to Favorites” to keep them here.</p>'}`;
  } else if (activeView === "add-class") {
    content = `<h2 class="dashboard-view-title">Add a class</h2>${renderTrainerClassForm()}`;
  } else if (activeView === "classes") {
    content = `<h2 class="dashboard-view-title">My classes</h2>${result.classes.length
      ? `<div class="dashboard-table-wrap"><table class="dashboard-table"><thead><tr><th>Class</th><th>Category</th><th>Status</th><th>Students</th><th>Actions</th></tr></thead><tbody>${result.classes.map(item =>
        `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.category)}</td><td><span class="dashboard-status">${escapeHtml(item.status)}</span></td><td>${item.bookingCount}</td><td class="dashboard-row-actions"><button class="text-link" type="button" data-edit-class="${escapeHtml(item.id)}">Update</button><button class="text-link" type="button" data-attendees="${escapeHtml(item.id)}">View students</button><button class="text-link comment-delete" type="button" data-delete-class="${escapeHtml(item.id)}">Delete</button></td></tr>`
      ).join("")}</tbody></table></div>` : '<p class="dashboard-empty-state">You haven’t created any classes yet.</p>'}`;
  } else if (activeView === "add-post") {
    content = `<h2 class="dashboard-view-title">Add forum post</h2>${renderTrainerPostForm()}`;
  } else if (activeView === "posts") {
    content = `<h2 class="dashboard-view-title">My forum posts</h2>${result.forumPosts.length
      ? `<div class="dashboard-post-grid">${result.forumPosts.map(post => `<article class="dashboard-post-card">
        ${safeImageUrl(post.imageUrl) ? `<img src="${escapeHtml(safeImageUrl(post.imageUrl))}" alt="" />` : ""}
        <div><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.content.length > 180 ? `${post.content.slice(0, 177)}…` : post.content)}</p>
        <a class="text-link" href="/community/${encodeURIComponent(post.id)}">View post</a>
        <button class="text-link comment-delete" type="button" data-delete-post="${escapeHtml(post.id)}">Delete</button></div></article>`).join("")}</div>`
      : '<p class="dashboard-empty-state">You haven’t shared any community posts yet.</p>'}`;
  }
  dashboardView.innerHTML = content;
  if (activeView !== view) {
    const url = new URL(window.location.href);
    url.searchParams.set("view", activeView);
    window.history.replaceState({}, "", url);
    renderDashboardNavigation(role);
  }
}

function renderDashboardFavorite(item) {
  const imageUrl = safeImageUrl(item.imageUrl);
  return `<article class="class-card" data-favorite-card="${escapeHtml(item.id)}">
    <div class="class-photo">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)} class" loading="lazy" />` : ""}<span class="photo-label">${escapeHtml(item.category)}</span></div>
    <div class="class-card-body"><h3>${escapeHtml(item.name)}</h3><div class="coach-row"><span>${escapeHtml(item.trainerName)}</span><span class="class-price">${escapeHtml(formatClassPrice(item))}</span></div>
    <a class="book-link" href="/classes/${encodeURIComponent(item.id)}">View details <span aria-hidden="true">↗</span></a>
    <button class="book-link favorite-remove-link" type="button" data-remove-favorite="${escapeHtml(item.id)}">Remove Favorite <span aria-hidden="true">×</span></button></div>
  </article>`;
}

function renderTrainerClassForm(item = {}) {
  const schedule = Array.isArray(item.schedule)
    ? item.schedule.map(entry => `${entry.day}, ${entry.time}`).join("\n")
    : "";
  const price = item.priceInMinorUnits == null ? "" : (item.priceInMinorUnits / 100).toFixed(2);
  return `<form class="dashboard-form" data-dashboard-form="${item.id ? "class-update" : "class"}" ${item.id ? `data-class-id="${escapeHtml(item.id)}"` : ""}>
    <label>Class name<input name="name" maxlength="120" required value="${escapeHtml(item.name || "")}" /></label>
    <label>Class image<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-image-file ${item.imageUrl ? "" : "required"} /><input type="hidden" name="imageUrl" value="${escapeHtml(item.imageUrl || "")}" /><small data-upload-state>Choose an image to upload securely to ImgBB (5 MB max).</small></label>
    <label>Category<input name="category" maxlength="80" required placeholder="Yoga, weights, cardio…" value="${escapeHtml(item.category || "")}" /></label>
    <label>Difficulty level<select name="difficulty" required><option value="">Choose level</option>${["Beginner", "Intermediate", "Advanced", "All levels"].map(level => `<option${item.difficulty === level ? " selected" : ""}>${level}</option>`).join("")}</select></label>
    <label>Duration (minutes)<input name="duration" type="number" min="1" max="600" required value="${escapeHtml(item.duration || "")}" /></label>
    <label>Class schedule (day, time per line)<textarea name="schedule" required placeholder="Monday, 6:00 PM&#10;Wednesday, 7:00 PM">${escapeHtml(schedule)}</textarea></label>
    <label>Price<input name="price" type="number" min="0.01" step="0.01" required value="${escapeHtml(price)}" /></label>
    <label>Description<textarea name="description" maxlength="5000" required>${escapeHtml(item.description || "")}</textarea></label>
    <button class="button button-lime" type="submit">${item.id ? "Save changes" : "Submit for approval"} <span aria-hidden="true">↗</span></button>
  </form>`;
}

function renderTrainerPostForm() {
  return `<form class="dashboard-form" data-dashboard-form="forum-post">
    <label>Title<input name="title" maxlength="200" required /></label>
    <label>Image (ImgBB upload)<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-image-file required /><input type="hidden" name="imageUrl" /><small data-upload-state>Choose an image to upload securely to ImgBB (5 MB max).</small></label>
    <label>Description<textarea name="content" maxlength="10000" required></textarea></label>
    <button class="button button-lime" type="submit">Publish forum post <span aria-hidden="true">↗</span></button>
  </form>`;
}

async function uploadDashboardImage(input) {
  const file = input.files[0];
  if (!file) return;
  const form = input.closest("form");
  const state = form.querySelector("[data-upload-state]");
  const imageUrl = form.elements.imageUrl;
  if (file.size > 5 * 1024 * 1024) {
    showToast("Images must be 5 MB or smaller.");
    input.value = "";
    return;
  }
  state.textContent = "Uploading image…";
  input.disabled = true;
  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("The image could not be read."));
      reader.readAsDataURL(file);
    });
    const response = await fetch("/api/trainer/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl })
    });
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.assign(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Image upload failed.");
    imageUrl.value = result.imageUrl;
    state.textContent = "Image uploaded successfully.";
  } catch (error) {
    state.textContent = error.message;
    input.value = "";
  } finally {
    input.disabled = false;
    if (submitButton) submitButton.disabled = false;
  }
}

function dashboardFormPayload(form) {
  const formData = new FormData(form);
  const schedule = String(formData.get("schedule") || "").split(/\r?\n/).map(line => {
    const [day, ...time] = line.split(",");
    return { day: day.trim(), time: time.join(",").trim() };
  }).filter(item => item.day && item.time);
  return {
    name: formData.get("name"),
    category: formData.get("category"),
    difficulty: formData.get("difficulty"),
    duration: Number(formData.get("duration")),
    schedule,
    price: Number(formData.get("price")),
    description: formData.get("description"),
    imageUrl: formData.get("imageUrl")
  };
}

async function submitDashboardForm(form) {
  const type = form.dataset.dashboardForm;
  const payload = type === "application"
    ? { experienceYears: Number(form.elements.experienceYears.value), specialty: form.elements.specialty.value }
    : type === "forum-post"
      ? { title: form.elements.title.value, content: form.elements.content.value, imageUrl: form.elements.imageUrl.value }
      : dashboardFormPayload(form);
  if (type === "forum-post" && !payload.imageUrl) {
    showToast("Upload a post image before publishing.");
    return;
  }
  const endpoint = type === "application"
    ? "/api/trainer-applications"
    : type === "forum-post"
      ? "/api/trainer/forum-posts"
      : type === "class-update"
        ? `/api/trainer/classes/${encodeURIComponent(form.dataset.classId)}`
        : "/api/trainer/classes";
  const method = type === "class-update" ? "PATCH" : "POST";
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await readJsonResponse(response);
    if (response.status === 401) {
      window.location.assign(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (!response.ok) throw new Error(result.error || "Your request could not be completed.");
    showToast(result.message);
    if (dashboardDialog.open) dashboardDialog.close();
    window.location.reload();
  } catch (error) {
    showToast(error.message);
    submitButton.disabled = false;
  }
}

dashboardView?.addEventListener("change", event => {
  if (event.target.matches("[data-image-file]")) uploadDashboardImage(event.target);
});
dashboardDialog?.addEventListener("change", event => {
  if (event.target.matches("[data-image-file]")) uploadDashboardImage(event.target);
});

dashboardView?.addEventListener("submit", event => {
  if (event.target.matches("[data-dashboard-form]")) {
    event.preventDefault();
    submitDashboardForm(event.target);
  }
});

dashboardView?.addEventListener("click", async event => {
  const favoriteButton = event.target.closest("[data-remove-favorite]");
  if (favoriteButton) {
    favoriteButton.disabled = true;
    try {
      const response = await fetch(`/api/favorites?classId=${encodeURIComponent(favoriteButton.dataset.removeFavorite)}`, { method: "DELETE" });
      const result = await readJsonResponse(response);
      if (!response.ok) throw new Error(result.error || "The favorite could not be removed.");
      favoriteButton.closest("[data-favorite-card]").remove();
      if (!dashboardView.querySelector("[data-favorite-card]")) {
        dashboardView.innerHTML = '<h2 class="dashboard-view-title">Favorite classes</h2><p class="dashboard-empty-state">You haven’t saved any classes yet.</p>';
      }
      showToast(result.message);
    } catch (error) {
      showToast(error.message);
      favoriteButton.disabled = false;
    }
    return;
  }

  const editButton = event.target.closest("[data-edit-class]");
  if (editButton) {
    editButton.disabled = true;
    try {
      const response = await fetch("/api/dashboard");
      const result = await readJsonResponse(response);
      if (response.status === 401) {
        window.location.assign(`/?auth=login&returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (!response.ok) throw new Error(result.error || "Class details could not be loaded.");
      const classItem = result.classes.find(item => item.id === editButton.dataset.editClass);
      if (!classItem) throw new Error("Your class could not be found.");
      dashboardDialogContent.innerHTML = `<h2>Update class</h2>${renderTrainerClassForm(classItem)}`;
      dashboardDialog.showModal();
    } catch (error) {
      showToast(error.message);
    } finally {
      editButton.disabled = false;
    }
    return;
  }

  const attendeesButton = event.target.closest("[data-attendees]");
  if (attendeesButton) {
    attendeesButton.disabled = true;
    try {
      const response = await fetch(`/api/trainer/classes/${encodeURIComponent(attendeesButton.dataset.attendees)}/attendees`);
      const result = await readJsonResponse(response);
      if (!response.ok) throw new Error(result.error || "Students could not be loaded.");
      dashboardDialogContent.innerHTML = `<h2>Enrolled students</h2>${result.students.length
        ? `<ul class="dashboard-student-list">${result.students.map(student => `<li><strong>${escapeHtml(student.name)}</strong><span>${escapeHtml(student.email)}</span></li>`).join("")}</ul>`
        : "<p>No paid students yet.</p>"}`;
      dashboardDialog.showModal();
    } catch (error) {
      showToast(error.message);
    } finally {
      attendeesButton.disabled = false;
    }
    return;
  }

  const deleteClassButton = event.target.closest("[data-delete-class]");
  const deletePostButton = event.target.closest("[data-delete-post]");
  const deleteButton = deleteClassButton || deletePostButton;
  if (!deleteButton || !window.confirm(deleteClassButton ? "Delete this class?" : "Delete this forum post?")) return;
  deleteButton.disabled = true;
  try {
    const endpoint = deleteClassButton
      ? `/api/trainer/classes/${encodeURIComponent(deleteButton.dataset.deleteClass)}`
      : `/api/trainer/forum-posts/${encodeURIComponent(deleteButton.dataset.deletePost)}`;
    const response = await fetch(endpoint, { method: "DELETE" });
    const result = await readJsonResponse(response);
    if (!response.ok) throw new Error(result.error || "The item could not be deleted.");
    showToast(result.message);
    window.location.reload();
  } catch (error) {
    showToast(error.message);
    deleteButton.disabled = false;
  }
});

dashboardDialog?.addEventListener("submit", event => {
  if (event.target.matches("[data-dashboard-form]")) {
    event.preventDefault();
    submitDashboardForm(event.target);
  }
});

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
  button.addEventListener("click", () => {
    if (button.dataset.openModal === "trainer") {
      window.location.assign("/dashboard?view=apply");
      return;
    }
    openModal(button.dataset.openModal);
  });
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
  const credentials = {
    email: String(formData.get("email")),
    password: String(formData.get("password"))
  };

  submitButton.disabled = true;
  try {
    if (submittedModal === "join" || submittedModal === "signin") {
      const result = submittedModal === "join"
        ? await authClient.signUp.email({
          ...credentials,
          name: String(formData.get("name"))
        })
        : await authClient.signIn.email(credentials);
      if (result.error) throw new Error(result.error.message || "Authentication could not be completed.");
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      if (returnTo?.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\")) {
        window.location.assign(returnTo);
        return;
      }
      window.location.assign("/dashboard");
      return;
    }

    const response = await fetch("/api/trainer-applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        email: credentials.email,
        experience: formData.get("message")
      })
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
