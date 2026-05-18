const API_URL =
  "https://script.google.com/macros/s/AKfycbx4DKPQ9ykHaTb6AWI92A8IeV1HBp6RtxzNkjnsl3hFhonWBhAa20coEKIWRI_5vi_F/exec";

const OWNER_FILTER = "Darwin";
const SET_FILTER = "Black Bolt";

const VARIANT_ORDER = [
  "Normal",
  "Holo",
  "Rev Holo",
  "Poke BP",
  "Master BP",
  "DR - Holo",
  "IR",
  "UR",
  "SIR",
  "BWR"
];

let allRows = [];
let visibleRows = [];
let groupedCards = [];
let pendingUpdates = new Map();

const app = {
  searchInput: null,
  ownerFilter: null,
  setFilter: null,
  missingFilter: null,
  sortSelect: null,
  statusMessage: null,
  results: null,
  saveButton: null
};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  loadData();
});

function cacheElements() {
  app.searchInput = document.getElementById("searchInput");
  app.ownerFilter = document.getElementById("ownerFilter");
  app.setFilter = document.getElementById("setFilter");
  app.missingFilter = document.getElementById("missingFilter");
  app.sortSelect = document.getElementById("sortSelect");
  app.statusMessage = document.getElementById("statusMessage");
  app.results = document.getElementById("results");

  createSaveButton();
}

function createSaveButton() {
  app.saveButton = document.createElement("button");
  app.saveButton.id = "saveButton";
  app.saveButton.textContent = "Save Changes";
  app.saveButton.disabled = true;
  app.saveButton.addEventListener("click", savePendingUpdates);

  const header = document.querySelector(".topbar");
  if (header) {
    header.appendChild(app.saveButton);
  }
}

function bindEvents() {
  app.searchInput?.addEventListener("input", renderCards);
  app.ownerFilter?.addEventListener("change", renderCards);
  app.setFilter?.addEventListener("change", renderCards);
  app.missingFilter?.addEventListener("change", renderCards);
  app.sortSelect?.addEventListener("change", renderCards);
}

async function loadData() {
  setStatus("Loading cards...");

  try {
    const response = await fetch(`${API_URL}?cacheBust=${Date.now()}`);
    const payload = await response.json();

    if (!payload.success) {
      throw new Error(payload.message || "Apps Script returned an error.");
    }

    allRows = Array.isArray(payload.data) ? payload.data : [];

    visibleRows = allRows.filter(row => {
      return (
        normalizeText(row.Owner) === normalizeText(OWNER_FILTER) &&
        normalizeText(row.Set) === normalizeText(SET_FILTER)
      );
    });

    pendingUpdates.clear();
    groupedCards = buildGroupedCards(visibleRows);

    hydrateFilters();
    renderCards();
  } catch (error) {
    console.error(error);
    setStatus(`Error loading cards: ${error.message}`);
    app.results.innerHTML = `
      <div class="empty-state">
        Could not load cards. Check the Apps Script Web App URL.
      </div>
    `;
  }

  updateSaveButton();
}

function hydrateFilters() {
  if (app.ownerFilter) {
    app.ownerFilter.innerHTML = `
      <option value="${OWNER_FILTER}">${OWNER_FILTER}</option>
    `;
    app.ownerFilter.value = OWNER_FILTER;
    app.ownerFilter.disabled = true;
  }

  if (app.setFilter) {
    app.setFilter.innerHTML = `
      <option value="${SET_FILTER}">${SET_FILTER}</option>
    `;
    app.setFilter.value = SET_FILTER;
    app.setFilter.disabled = true;
  }

  if (app.missingFilter) {
    app.missingFilter.innerHTML = `
      <option value="All">All Cards</option>
      ${VARIANT_ORDER.map(
        variant =>
          `<option value="${escapeHtml(variant)}">Missing ${escapeHtml(variant)}</option>`
      ).join("")}
    `;
  }

  if (app.sortSelect) {
    app.sortSelect.innerHTML = `
      <option value="numberAsc">Card Number ↑</option>
      <option value="numberDesc">Card Number ↓</option>
      <option value="alpha">A → Z</option>
    `;
  }
}

function buildGroupedCards(rows) {
  const map = new Map();

  rows.forEach(row => {
    const cardNumber = String(row.CardNumber || "").trim();
    const pokemon = String(row.Pokemon || "").trim();
    const variant = String(row.Variant || "").trim();

    if (!cardNumber || !pokemon || !variant) return;

    const key = `${normalizeCard(cardNumber)}::${normalizeText(pokemon)}`;

    if (!map.has(key)) {
      map.set(key, {
        owner: row.Owner,
        set: row.Set,
        cardNumber,
        pokemon,
        variants: {}
      });
    }

    map.get(key).variants[variant] = {
      variant,
      owned: toBoolean(row.Owned),
      exists: toBoolean(row.Exists)
    };
  });

  return Array.from(map.values());
}

function renderCards() {
  if (!app.results) return;

  const query = normalizeText(app.searchInput?.value || "");
  const missingVariantFilter = app.missingFilter?.value || "All";
  const sortMode = app.sortSelect?.value || "numberAsc";

  let cards = groupedCards.slice();

  if (query) {
    cards = cards.filter(card => {
      return (
        normalizeText(card.pokemon).includes(query) ||
        normalizeText(card.cardNumber).includes(query) ||
        normalizeText(card.set).includes(query)
      );
    });
  }

  cards = cards.filter(card => {
    if (missingVariantFilter === "All") {
      return true;
    }

    const variantData = card.variants[missingVariantFilter];

    if (!variantData || !variantData.exists) {
      return false;
    }

    const owned = getCurrentOwnedValue(
      card.cardNumber,
      missingVariantFilter,
      variantData.owned
    );

    return owned === false;
  });

  cards.sort((a, b) => {
    if (sortMode === "alpha") {
      return a.pokemon.localeCompare(b.pokemon);
    }

    if (sortMode === "numberDesc") {
      return getCardNumberSortValue(b.cardNumber) - getCardNumberSortValue(a.cardNumber);
    }

    return getCardNumberSortValue(a.cardNumber) - getCardNumberSortValue(b.cardNumber);
  });

  const totalVariants = visibleRows.filter(row => toBoolean(row.Exists)).length;

  const ownedVariants = visibleRows.filter(row => {
    if (!toBoolean(row.Exists)) return false;

    const key = makeUpdateKey(row.CardNumber, row.Variant);

    if (pendingUpdates.has(key)) {
      return pendingUpdates.get(key).owned === true;
    }

    return toBoolean(row.Owned);
  }).length;

  const statusPrefix =
    missingVariantFilter === "All"
      ? `${cards.length} cards`
      : `${cards.length} cards missing ${missingVariantFilter}`;

  setStatus(`${statusPrefix} (${ownedVariants} of ${totalVariants} variants owned)`);

  if (cards.length === 0) {
    app.results.innerHTML = `
      <div class="empty-state">
        No cards match your filters.
      </div>
    `;
    return;
  }

  app.results.innerHTML = cards.map(renderCard).join("");

  app.results.querySelectorAll("button.variant-pill").forEach(button => {
    button.addEventListener("click", handleVariantClick);
  });
}

function renderCard(card) {
  const stats = getCardStats(card);
  const percent =
    stats.totalCount === 0
      ? 0
      : Math.round((stats.ownedCount / stats.totalCount) * 100);

  return `
    <article class="card-item">
      <div class="card-main">
        <div class="card-title-row">
          <h2>${escapeHtml(card.pokemon)}</h2>
          <span class="card-progress">${stats.ownedCount}/${stats.totalCount}</span>
        </div>

        <p class="card-meta">
          #${escapeHtml(card.cardNumber)} • ${escapeHtml(card.set)} • ${escapeHtml(card.owner)}
        </p>

        <div class="variant-list">
          ${VARIANT_ORDER.map(variant => renderVariantPill(card, variant)).join("")}
        </div>
      </div>

      <div class="mini-progress" aria-label="${percent}% complete">
        <div class="mini-progress-fill" style="width: ${percent}%"></div>
      </div>
    </article>
  `;
}

function renderVariantPill(card, variant) {
  const data = card.variants[variant];

  if (!data || !data.exists) {
    return "";
  }

  const currentOwned = getCurrentOwnedValue(card.cardNumber, variant, data.owned);
  const key = makeUpdateKey(card.cardNumber, variant);
  const changed = pendingUpdates.has(key);

  const classes = [
    "variant-pill",
    currentOwned ? "owned" : "missing",
    changed ? "changed" : "",
    getVariantClass(variant)
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <button
      type="button"
      class="${classes}"
      data-card-number="${escapeHtml(card.cardNumber)}"
      data-pokemon="${escapeHtml(card.pokemon)}"
      data-variant="${escapeHtml(variant)}"
      data-owned="${currentOwned ? "true" : "false"}"
    >
      ${escapeHtml(variant)}
    </button>
  `;
}

function handleVariantClick(event) {
  const button = event.currentTarget;

  const cardNumber = button.dataset.cardNumber;
  const pokemon = button.dataset.pokemon;
  const variant = button.dataset.variant;
  const currentOwned = button.dataset.owned === "true";
  const nextOwned = !currentOwned;

  const originalRow = visibleRows.find(row => {
    return (
      normalizeCard(row.CardNumber) === normalizeCard(cardNumber) &&
      normalizeText(row.Variant) === normalizeText(variant)
    );
  });

  if (!originalRow) return;

  const originalOwned = toBoolean(originalRow.Owned);
  const key = makeUpdateKey(cardNumber, variant);

  if (nextOwned === originalOwned) {
    pendingUpdates.delete(key);
  } else {
    pendingUpdates.set(key, {
      owner: OWNER_FILTER,
      setName: SET_FILTER,
      cardNumber,
      pokemon,
      variant,
      owned: nextOwned
    });
  }

  updateSaveButton();
  renderCards();
}

async function savePendingUpdates() {
  if (pendingUpdates.size === 0) return;

  const updates = Array.from(pendingUpdates.values());

  app.saveButton.disabled = true;
  app.saveButton.textContent = "Saving...";
  setStatus(`Saving ${updates.length} change(s)...`);

  try {
    const encodedUpdates = encodeURIComponent(JSON.stringify(updates));

    const response = await fetch(
      `${API_URL}?mode=batchupdate&updates=${encodedUpdates}&cacheBust=${Date.now()}`
    );

    const payload = await response.json();

    if (!payload.success) {
      throw new Error(payload.message || "Save failed.");
    }

    pendingUpdates.clear();
    setStatus(payload.message || "Changes saved.");

    await loadData();
  } catch (error) {
    console.error(error);
    setStatus(`Save failed: ${error.message}`);
  }

  app.saveButton.textContent = "Save Changes";
  updateSaveButton();
}

function getCardStats(card) {
  let totalCount = 0;
  let ownedCount = 0;

  VARIANT_ORDER.forEach(variant => {
    const data = card.variants[variant];

    if (!data || !data.exists) return;

    totalCount++;

    const owned = getCurrentOwnedValue(card.cardNumber, variant, data.owned);
    if (owned) ownedCount++;
  });

  return {
    totalCount,
    ownedCount,
    missingCount: totalCount - ownedCount
  };
}

function getCurrentOwnedValue(cardNumber, variant, fallbackOwned) {
  const key = makeUpdateKey(cardNumber, variant);

  if (pendingUpdates.has(key)) {
    return pendingUpdates.get(key).owned === true;
  }

  return fallbackOwned === true;
}

function updateSaveButton() {
  if (!app.saveButton) return;

  const count = pendingUpdates.size;

  app.saveButton.disabled = count === 0;
  app.saveButton.textContent =
    count === 0 ? "Save Changes" : `Save ${count} Change${count === 1 ? "" : "s"}`;
}

function setStatus(message) {
  if (app.statusMessage) {
    app.statusMessage.textContent = message;
  }
}

function makeUpdateKey(cardNumber, variant) {
  return `${normalizeCard(cardNumber)}::${normalizeText(variant)}`;
}

function normalizeCard(value) {
  const str = String(value || "").trim();
  const parts = str.split("/");

  if (parts.length === 2) {
    const left = parseInt(parts[0], 10);
    const right = parseInt(parts[1], 10);

    if (!Number.isNaN(left) && !Number.isNaN(right)) {
      return `${left}/${right}`;
    }
  }

  return str;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

function toBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;

  const str = String(value || "").toLowerCase().trim();

  return str === "true" || str === "yes" || str === "1" || str === "checked";
}

function getCardNumberSortValue(cardNumber) {
  const firstPart = String(cardNumber || "").split("/")[0];
  const number = parseInt(firstPart, 10);

  return Number.isNaN(number) ? 999999 : number;
}

function getVariantClass(variant) {
  const normalized = normalizeText(variant);

  if (normalized.includes("master")) return "master";
  if (normalized.includes("poke")) return "poke";
  if (normalized.includes("rev")) return "reverse";
  if (normalized.includes("holo")) return "holo";
  if (normalized === "ir") return "rare";
  if (normalized === "ur") return "rare";
  if (normalized === "sir") return "rare";
  if (normalized === "bwr") return "rare";

  return "normal";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
