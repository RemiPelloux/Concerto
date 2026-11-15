// Concerto docs: the score calculator, the copy button and section entrances.
(() => {
  const FIBONACCI = [1, 2, 3, 5, 8, 13];
  const OPUS_FROM = 55;

  // Same formula as scoreStory in src/orchestrator/scoring.ts. Uncertainty uses the scorer's default, 2.
  const WEIGHTS = { complexity: 0.22, risk: 0.16, effort: 0.1, uncertainty: 0.08, reach: 0.14, size: 0.08, coverage: 0.1, tests: 0.04, churn: 0.04, spread: 0.04 };
  const SAT = { reach: 48, lines: 3000, tests: 32, churn: 40, areas: 5 };
  const SENSITIVE_RISK = 0.75;
  const DEFAULT_UNCERTAINTY = 2;
  const PRESETS = {
    quiet: { files: 1, direct: 0, indirect: 0, tests: 2, lines: 80, churn: 1, areas: 1, untested: 0, sources: 1 },
    typical: { files: 3, direct: 4, indirect: 8, tests: 6, lines: 600, churn: 6, areas: 2, untested: 1, sources: 3 },
    wide: { files: 8, direct: 20, indirect: 40, tests: 20, lines: 2500, churn: 25, areas: 4, untested: 3, sources: 8 },
  };
  const scale = (n) => (n - 1) / 4;
  const logScale = (n, sat) => Math.min(1, Math.log2(1 + n) / Math.log2(1 + sat));

  function measured(p) {
    return {
      reach: logScale(p.files + p.direct + p.indirect / 2, SAT.reach),
      size: logScale(p.lines, SAT.lines),
      coverage: p.untested / p.sources,
      tests: logScale(p.tests, SAT.tests),
      churn: logScale(p.churn, SAT.churn),
      spread: Math.min(1, (p.areas - 1) / (SAT.areas - 1)),
    };
  }

  function score({ points, complexity, risk, reach, sensitive }) {
    const values = {
      complexity: scale(complexity),
      risk: sensitive ? Math.max(scale(risk), SENSITIVE_RISK) : scale(risk),
      effort: FIBONACCI.indexOf(points) / (FIBONACCI.length - 1),
      uncertainty: scale(DEFAULT_UNCERTAINTY),
      ...(PRESETS[reach] ? measured(PRESETS[reach]) : {}),
    };
    const keys = Object.keys(values);
    const total = keys.reduce((sum, k) => sum + WEIGHTS[k], 0);
    return Math.round((keys.reduce((sum, k) => sum + WEIGHTS[k] * values[k], 0) / total) * 100);
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
      const story = { points: pick("points"), complexity: pick("complexity"), risk: pick("risk") };
      const value = score({ ...story, reach: data.get("reach"), sensitive: data.has("sensitive") });
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
