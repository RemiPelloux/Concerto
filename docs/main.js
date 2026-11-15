// Concerto docs: the score calculator, the copy button and section entrances.
(() => {
  const FIBONACCI = [1, 2, 3, 5, 8, 13];
  const OPUS_FROM = 55;

  // Same formula as scoreStory and blastRadius in src/orchestrator/plan.ts.
  const BLAST_SATURATION = 64;

  function score({ points, complexity, risk, reach }) {
    const parts = [(complexity - 1) / 4, (risk - 1) / 4, FIBONACCI.indexOf(points) / (FIBONACCI.length - 1)];
    if (reach === 0) return Math.round((0.5 * parts[0] + 0.3 * parts[1] + 0.2 * parts[2]) * 100);
    const blast = Math.min(1, Math.log2(1 + reach) / Math.log2(1 + BLAST_SATURATION));
    return Math.round((0.4 * parts[0] + 0.25 * parts[1] + 0.15 * parts[2] + 0.2 * blast) * 100);
  }

  function route(value, ui) {
    const opus = ui || value >= OPUS_FROM;
    return {
      builder: opus ? ["soloist", "Claude Opus 5.5, through Claude Code"] : ["soloist", "GPT-6.1 Sol, through Codex CLI"],
      reviewer: ui ? ["astra", "GPT-6 Astra"] : ["critic", "the critic, Claude Sonnet 5.5"],
    };
  }

  function paint(cell, [kind, text]) {
    cell.innerHTML = "";
    const dot = document.createElement("span");
    dot.className = `dot dot-${kind}`;
    cell.append(dot, text);
  }

  function setUpCalc(form) {
    const update = () => {
      const data = new FormData(form);
      const pick = (name) => Number(data.get(name));
      const value = score({ points: pick("points"), complexity: pick("complexity"), risk: pick("risk"), reach: pick("reach") });
      const result = route(value, data.has("ui"));
      form.elements.score.value = String(value);
      form.elements.score.classList.toggle("is-high", value >= OPUS_FROM);
      paint(form.querySelector('[data-out="builder"]'), result.builder);
      paint(form.querySelector('[data-out="reviewer"]'), result.reviewer);
    };
    form.addEventListener("change", update);
    update();
  }

  function setUpCopy(button) {
    button.addEventListener("click", async () => {
      const text = document.getElementById(button.dataset.copy).textContent.replace(/\n/g, " && ");
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select and copy";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 1800);
    });
  }

  function setUpReveal() {
    const items = [...document.querySelectorAll(".reveal")];
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-in"));
      return;
    }
    document.querySelectorAll("section, footer").forEach((group) => {
      group.querySelectorAll(".reveal").forEach((el, i) => el.style.setProperty("--d", `${Math.min(i, 6) * 75}ms`));
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    items.forEach((el) => io.observe(el));
  }

  const form = document.querySelector("form.calc");
  if (form) setUpCalc(form);
  document.querySelectorAll("[data-copy]").forEach(setUpCopy);
  setUpReveal();
})();
