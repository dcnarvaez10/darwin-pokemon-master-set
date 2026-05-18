const setsContainer = document.getElementById("sets-container");

const darwinSets = [];

function renderSets() {
  if (!setsContainer) return;

  if (darwinSets.length === 0) {
    setsContainer.innerHTML = `
      <h2>Sets</h2>
      <p>No Darwin sets have been added yet.</p>
    `;
    return;
  }

  setsContainer.innerHTML = `
    <h2>Sets</h2>
    <div class="sets-grid">
      ${darwinSets
        .map(
          (set) => `
            <article class="set-card">
              <h3>${set.name}</h3>
              <p>${set.totalCards} cards</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

renderSets();
