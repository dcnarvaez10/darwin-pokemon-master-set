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
let pendingUpdates = new Map();

document.addEventListener("DOMContentLoaded", () => {
  buildAppShell();
  loadCards();
});

function buildAppShell() {
  document.body.innerHTML = `
    <header class="site-header">
      <div>
        <h1>Darwin Pokémon Master Set</h1>
        <p>Black Bolt master set tracker</p>
      </div>
    </header>

    <main class="page-shell">
      <section class="summary-panel">
        <div>
          <h2>${SET_FILTER}</h2>
          <p id="status-text">Loading cards...</p>
        </div>

        <div class="summary-actions">
          <button id="refresh-button" type="button">Refresh</button>
          <button id="save-button" type="button" disabled>Save Changes</button>
        </div>
      </section>

      <section class="progress-panel">
        <div class="progress-label">
          <span id="owned-count">0 owned</span>
          <span id="progress-percent">0%</span>
        </div>
        <div class="progress-bar">
          <div id="progress-fill"></div>
        </div>
      </section>

      <section class="filter-panel">
        <label for="search-input">Search</label>
        <input
          id="search-input"
          type="search"
          placeholder="Search card number or Pokémon..."
        />

        <label for="variant-filter">Variant</label>
        <select id="variant-filter">
          <option value="all">All variants</option>
          ${VARIANT_ORDER.map(
            variant => `<option value="${escapeHtml(variant)}">${escapeHtml(variant)}</option>`
          ).join("")}
        </select>

        <label for="owned-filter">Ownership</label>
        <select id="owned-filter">
          <option value="all">All cards</option>
          <option value="owned">Owned only</option>
          <option value="missing">Missing only</option>
        </select>
      </section>

      <section class="table-panel">
        <div class="table-scroll">
          <table id="cards-table">
            <thead>
              <tr>
                <th>Card #</th>
                <th>Pokémon</th>
                ${VARIANT_ORDER.map(
                  variant => `<th>${escapeHtml(variant)}</th>`
                ).join("")}
              </tr>
            </thead>
            <tbody id="cards-body">
              <tr>
                <td colspan="${VARIANT_ORDER.length + 2}">Loading...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  `;

  document
    .getElementById("refresh-button")
    .addEventListener("click", loadCards);

  document
    .getElementById("save-button")
    .addEventListener("click", savePendingUpdates);

  document
    .getElementById("search-input")
    .addEventListener("input", renderCards);

  document
    .getElementById("variant-filter")
    .addEventListener("change", renderCards);

  document
    .getElementById("owned-filter")
    .addEventListener("change", renderCards);
}

async function loadCards() {
  setStatus("Loading cards...");
  setSaveButtonState();

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

    renderCards();
    setStatus(`${visibleRows.length} variant rows loaded.`);
  } catch (error) {
    console.error(error);
    setStatus(`Error loading cards: ${error.message}`);

    const cardsBody = document.getElementById("cards-body");
    cardsBody.innerHTML = `
      <tr>
        <td colspan="${VARIANT_ORDER.length + 2}">
          Could not load card data. Check the Apps Script deployment URL.
        </td>
      </tr>
    `;
  }

  setSaveButtonState();
}

function renderCards() {
  const cardsBody = document.getElementById("cards-body");

  const searchValue = normalizeText(
    document.getElementById("search-input").value
  );

  const variantFilter = document.getElementById("variant-filter").value;
  const ownedFilter = document.getElementById("owned-filter").value;

  const groupedCards = groupRowsByCard(visibleRows);

  let cards = Object.values(groupedCards);

  if (searchValue) {
    cards = cards.filter(card => {
      return (
        normalizeText(card.cardNumber).includes(searchValue) ||
        normalizeText(card.pokemon).includes(searchValue)
      );
    });
  }

  cards = cards.filter(card => {
    if (variantFilter === "all" && ownedFilter === "all") return true;

    return VARIANT_ORDER.some(variant => {
      const variantData = card.variants[variant];

      if (!variantData || !toBoolean(variantData.Exists)) {
        return false;
      }

      if (variantFilter !== "all" && variant !== variantFilter) {
        return false;
      }

      const owned = getCurrentOwnedValue(card.cardNumber, variant, variantData);

      if (ownedFilter === "owned") {
        return owned === true;
      }

      if (ownedFilter === "missing") {
        return owned === false;
      }

      return true;
    });
  });

  if (cards.length === 0) {
    cardsBody.innerHTML = `
      <tr>
        <td colspan="${VARIANT_ORDER.length + 2}">
          No matching cards found.
        </td>
      </tr>
    `;
    updateProgress();
    return;
  }

  cardsBody.innerHTML = cards
    .map(card => {
      return `
        <tr>
          <td class="card-number">${escapeHtml(card.cardNumber)}</td>
          <td class="pokemon-name">${escapeHtml(card.pokemon)}</td>
          ${VARIANT_ORDER.map(variant => renderVariantCell(card, variant)).join("")}
        </tr>
      `;
    })
    .join("");

  cardsBody.querySelectorAll("input[type='checkbox']").forEach(checkbox => {
    checkbox.addEventListener("change", handleCheckboxChange);
  });

  updateProgress();
}

function renderVariantCell(card, variant) {
  const variantData = card.variants[variant];

  if (!variantData || !toBoolean(variantData.Exists)) {
    return `<td class="variant-cell unavailable"></td>`;
  }

  const checked = getCurrentOwnedValue(card.cardNumber, variant, variantData);
  const updateKey = makeUpdateKey(card.cardNumber, variant);
  const changedClass = pendingUpdates.has(updateKey) ? "changed" : "";

  return `
    <td class="variant-cell available ${changedClass}">
      <input
        type="checkbox"
        data-card-number="${escapeHtml(card.cardNumber)}"
        data-pokemon="${escapeHtml(card.pokemon)}"
        data-variant="${escapeHtml(variant)}"
        ${checked ? "checked" : ""}
        aria-label="${escapeHtml(card.pokemon)} ${escapeHtml(variant)}"
      />
    </td>
  `;
}

function handleCheckboxChange(event) {
  const checkbox = event.target;

  const cardNumber = checkbox.dataset.cardNumber;
  const pokemon = checkbox.dataset.pokemon;
  const variant = checkbox.dataset.variant;
  const owned = checkbox.checked;

  const originalRow = visibleRows.find(row => {
    return (
      normalizeCard(row.CardNumber) === normalizeCard(cardNumber) &&
      normalizeText(row.Variant) === normalizeText(variant)
    );
  });

  if (!originalRow) return;

  const originalOwned = toBoolean(originalRow.Owned);
  const updateKey = makeUpdateKey(cardNumber, variant);

  if (owned === originalOwned) {
    pendingUpdates.delete(updateKey);
  } else {
    pendingUpdates.set(updateKey, {
      owner: OWNER_FILTER,
      setName: SET_FILTER,
      cardNumber,
      pokemon,
      variant,
      owned
    });
  }

  setSaveButtonState();
  renderCards();
}

async function savePendingUpdates() {
  if (pendingUpdates.size === 0) return;

  const saveButton = document.getElementById("save-button");
  const updates = Array.from(pendingUpdates.values());

  saveButton.disabled = true;
  saveButton.textContent = "Saving...";
  setStatus(`Saving ${updates.length} change(s)...`);

  try {
    const encodedUpdates = encodeURIComponent(JSON.stringify(updates));

    const response = await fetch(
      `${API_URL}?mode=batchupdate&updates=${encodedUpdates}&cacheBust=${Date.now()}`
    );

    const payload = await response.json();

    if (!payload.success) {
      throw new Error(payload.message || "Some updates failed.");
    }

    pendingUpdates.clear();

    setStatus(payload.message || "Changes saved.");
    await loadCards();
  } catch (error) {
    console.error(error);
    setStatus(`Save failed: ${error.message}`);
  }

  saveButton.textContent = "Save Changes";
  setSaveButtonState();
}

function groupRowsByCard(rows) {
  const grouped = {};

  rows.forEach(row => {
    const cardNumber = String(row.CardNumber || "").trim();
    const pokemon = String(row.Pokemon || "").trim();
    const variant = String(row.Variant || "").trim();

    if (!cardNumber || !pokemon || !variant) return;

    const key = normalizeCard(cardNumber);

    if (!grouped[key]) {
      grouped[key] = {
        cardNumber,
        pokemon,
        variants: {}
      };
    }

    grouped[key].variants[variant] = row;
  });

  return grouped;
}

function updateProgress() {
  const ownedCountEl = document.getElementById("owned-count");
  const progressPercentEl = document.getElementById("progress-percent");
  const progressFillEl = document.getElementById("progress-fill");

  let ownedCount = 0;
  let possibleCount = 0;

  visibleRows.forEach(row => {
    if (!toBoolean(row.Exists)) return;

    possibleCount++;

    const currentOwned = getCurrentOwnedValue(
      row.CardNumber,
      row.Variant,
      row
    );

    if (currentOwned) {
      ownedCount++;
    }
  });

  const percent =
    possibleCount === 0 ? 0 : Math.round((ownedCount / possibleCount) * 100);

  ownedCountEl.textContent = `${ownedCount} of ${possibleCount} owned`;
  progressPercentEl.textContent = `${percent}%`;
  progressFillEl.style.width = `${percent}%`;
}

function getCurrentOwnedValue(cardNumber, variant, row) {
  const updateKey = makeUpdateKey(cardNumber, variant);

  if (pendingUpdates.has(updateKey)) {
    return pendingUpdates.get(updateKey).owned === true;
  }

  return toBoolean(row.Owned);
}

function setSaveButtonState() {
  const saveButton = document.getElementById("save-button");

  if (!saveButton) return;

  const count = pendingUpdates.size;

  saveButton.disabled = count === 0;
  saveButton.textContent =
    count === 0 ? "Save Changes" : `Save ${count} Change${count === 1 ? "" : "s"}`;
}

function setStatus(message) {
  const statusText = document.getElementById("status-text");

  if (statusText) {
    statusText.textContent = message;
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
