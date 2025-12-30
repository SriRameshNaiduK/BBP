let PLAYBOOK = null;

const el = (id) => document.getElementById(id);

const state = {
  domain: "",
  url: "",
  taskId: "",
  mode: "",
  completedFiles: new Set(),
};

function safeTrim(s) {
  return (s || "").trim();
}

function setStatus(msg, kind = "ok") {
  const statusEl = el("status");
  if (statusEl) statusEl.textContent = msg || "";
  const dot = el("dot");
  if (dot) {
    dot.classList.remove("ok", "bad");
    dot.classList.add(kind === "bad" ? "bad" : "ok");
  }
}

function setPill(msg) {
  const p = el("pill");
  if (p) p.textContent = msg;
}

function setHint(msg) {
  const h = el("hint");
  if (h) h.textContent = msg || "";
}

function storageKey(domain) {
  const d = (domain || "default").toLowerCase();
  return `bbp_completed_files_v1:${d}`;
}

function loadCompletedFiles(domain) {
  try {
    const raw = localStorage.getItem(storageKey(domain));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveCompletedFiles(domain, filesSet) {
  try {
    localStorage.setItem(storageKey(domain), JSON.stringify(Array.from(filesSet)));
  } catch {
    // ignore
  }
}

function resetCompletedFiles(domain) {
  try {
    localStorage.removeItem(storageKey(domain));
  } catch {
    // ignore
  }
  state.completedFiles = new Set();
  refreshReadinessUI();
}

function substitutePlaceholders(text, placeholders) {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    if (placeholders[key] === undefined || placeholders[key] === null) return `{${key}}`;
    return String(placeholders[key]);
  });
}

function guessOutdir(domain) {
  const d = (domain || "").replace(/[^a-zA-Z0-9.-]/g, "_");
  return `./out/${d || "target"}`;
}

async function copyText(txt) {
  await navigator.clipboard.writeText(txt);
}

function getTaskById(id) {
  return (PLAYBOOK?.tasks || []).find((t) => t.id === id);
}

function taskModes(task) {
  return task?.modes ? Object.keys(task.modes) : [];
}

function getResolvedPlaceholders() {
  const domain = safeTrim(el("domain")?.value);
  const url = safeTrim(el("url")?.value);

  const placeholders = {
    ...(PLAYBOOK?.placeholders || {}),
    domain: domain || PLAYBOOK?.placeholders?.domain,
    url: url || PLAYBOOK?.placeholders?.url,
  };

  placeholders.outdir = guessOutdir(placeholders.domain);

  return placeholders;
}

function resolveFiles(list, placeholders) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => substitutePlaceholders(String(x), placeholders));
}

function computeMissingRequires(task, placeholders) {
  const requires = resolveFiles(task?.requires_files, placeholders);
  const missing = requires.filter((f) => !state.completedFiles.has(f));
  return { requires, missing };
}

function populateTasks() {
  const taskSel = el("task");
  if (!taskSel) return;
  taskSel.innerHTML = "";

  for (const t of PLAYBOOK.tasks || []) {
    const opt = document.createElement("option");
    opt.value = t.id;
    const phase = t.phase ? `[${t.phase}] ` : "";
    opt.textContent = `${phase}${t.name}`;
    taskSel.appendChild(opt);
  }

  state.taskId = taskSel.value;
  populateModes();
}

function populateModes() {
  const modeSel = el("mode");
  if (!modeSel) return;
  modeSel.innerHTML = "";

  const task = getTaskById(state.taskId);
  const modes = taskModes(task);
  for (const m of modes) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m[0].toUpperCase() + m.slice(1);
    modeSel.appendChild(opt);
  }

  state.mode = modeSel.value;
}

function renderNotes(task) {
  const notesDiv = el("notes");
  if (!notesDiv) return;
  notesDiv.innerHTML = "";

  const notes = task?.notes || [];
  if (!notes.length) return;

  for (const n of notes) {
    const div = document.createElement("div");
    div.className = "noteItem";
    div.textContent = n;
    notesDiv.appendChild(div);
  }
}

function renderCommands(commands) {
  const out = el("output");
  if (!out) return;
  out.innerHTML = "";

  commands.forEach((c, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "cmd";

    const top = document.createElement("div");
    top.className = "cmdTop";

    const left = document.createElement("div");
    left.className = "cmdIdx";
    left.textContent = `Command ${idx + 1}`;

    const btn = document.createElement("button");
    btn.className = "copyBtn";
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      try {
        await copyText(c);
        setStatus(`Copied command ${idx + 1}.`, "ok");
      } catch {
        setStatus("Copy failed (browser permissions).", "bad");
      }
    });

    top.appendChild(left);
    top.appendChild(btn);

    const pre = document.createElement("pre");
    pre.textContent = c;

    wrap.appendChild(top);
    wrap.appendChild(pre);
    out.appendChild(wrap);
  });
}

function refreshReadinessUI() {
  const task = getTaskById(state.taskId);
  const placeholders = getResolvedPlaceholders();
  const { requires, missing } = computeMissingRequires(task, placeholders);

  const metaEl = el("meta");
  const genBtn = el("gen");
  const doneBtn = el("markDone");
  const resetBtn = el("resetSession");

  const produces = resolveFiles(task?.produces_files, placeholders);

  const tags = Array.isArray(task?.tags) ? task.tags.join(", ") : "";
  const phase = task?.phase ? task.phase : "";

  if (metaEl) {
    const reqTxt = requires.length ? `Requires: ${requires.map((r) => r.replace(placeholders.outdir, "{outdir}")).join(", ")}` : "Requires: —";
    const prodTxt = produces.length ? `Produces: ${produces.map((p) => p.replace(placeholders.outdir, "{outdir}")).join(", ")}` : "Produces: —";
    const tagTxt = tags ? `Tags: ${tags}` : "Tags: —";
    const phTxt = phase ? `Phase: ${phase}` : "Phase: —";
    metaEl.textContent = `${phTxt} • ${tagTxt} • ${reqTxt} • ${prodTxt}`;
  }

  const ok = missing.length === 0;

  if (genBtn) genBtn.disabled = !ok;
  const hasDomain = !!safeTrim(el("domain")?.value);
  if (doneBtn) doneBtn.disabled = !(hasDomain && produces.length > 0);
  if (resetBtn) resetBtn.disabled = !safeTrim(el("domain")?.value);

  if (!ok) {
    setStatus(`Blocked (strict): missing required outputs. Mark these as done first: ${missing.join(", ")}`, "bad");
    setHint("Run prerequisite tasks → then click “I ran these commands”.");
  } else {
    setStatus("Ready.", "ok");
    setHint("Generate → run commands → click “I ran these commands” to unlock next steps.");
  }
}

function generate() {
  if (!PLAYBOOK) return;

  state.domain = safeTrim(el("domain")?.value);
  state.url = safeTrim(el("url")?.value);
  state.completedFiles = loadCompletedFiles(state.domain);

  const task = getTaskById(state.taskId);
  const placeholders = getResolvedPlaceholders();

  const { missing } = computeMissingRequires(task, placeholders);
  if (missing.length) {
    refreshReadinessUI();
    return;
  }

  const modeObj = task?.modes?.[state.mode];
  if (!task || !modeObj) {
    setStatus("No task/mode selected.", "bad");
    return;
  }

  const cmds = (modeObj.commands || [])
    .map((x) => x.cmd)
    .map((cmd) => substitutePlaceholders(cmd, placeholders));

  renderNotes(task);
  renderCommands(cmds);
  const doneBtn = el("markDone");
  if (doneBtn) doneBtn.disabled = false;


  const copyAllBtn = el("copyAll");
  if (copyAllBtn) {
    copyAllBtn.disabled = cmds.length === 0;
    copyAllBtn.onclick = async () => {
      try {
        await copyText(cmds.join("\n"));
        setStatus("Copied all commands.", "ok");
      } catch {
        setStatus("Copy failed (browser permissions).", "bad");
      }
    };
  }

  setStatus("Commands generated. Run them in your terminal, then mark done.", "ok");
}

function markDone() {
  if (!PLAYBOOK) return;

  state.domain = safeTrim(el("domain")?.value);
  if (!state.domain) {
    setStatus("Enter a domain first.", "bad");
    return;
  }

  const task = getTaskById(state.taskId);
  const placeholders = getResolvedPlaceholders();
  const produces = resolveFiles(task?.produces_files, placeholders);

  if (!produces.length) {
    setStatus("This task doesn’t declare produced files.", "bad");
    return;
  }

  const files = loadCompletedFiles(state.domain);
  produces.forEach((p) => files.add(p));
  saveCompletedFiles(state.domain, files);
  state.completedFiles = files;

  setStatus(`Marked done: ${produces.join(", ")}`, "ok");
  refreshReadinessUI();
}

async function loadPlaybook() {
  try {
    const url = new URL("playbooks/pentest.yaml", window.location.href).toString();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);

    const txt = await res.text();
    try {
      PLAYBOOK = jsyaml.load(txt);
    } catch (yerr) {
      throw new Error(`YAML parse error: ${yerr.message}`);
    }

    if (!PLAYBOOK?.tasks?.length) throw new Error("Playbook loaded, but tasks[] is empty/missing.");

    populateTasks();

    setPill(`Playbook loaded • ${PLAYBOOK.tasks.length} tasks`);
    setHint("Strict mode: blocked until you mark prerequisite outputs as done.");
    setStatus(`Loaded playbook: ${PLAYBOOK.tasks.length} tasks.`, "ok");

    refreshReadinessUI();
  } catch (e) {
    console.error(e);
    setStatus(`Failed to load playbook: ${e.message}`, "bad");
    setPill("Playbook: failed to load");
    setHint("Check playbooks/pentest.yaml path + YAML formatting.");
  }
}

function wireUI() {
  const domainEl = el("domain");
  const urlEl = el("url");
  const taskEl = el("task");
  const modeEl = el("mode");

  domainEl?.addEventListener("input", () => {
    state.domain = safeTrim(domainEl.value);
    state.completedFiles = loadCompletedFiles(state.domain);
    refreshReadinessUI();
  });

  urlEl?.addEventListener("input", refreshReadinessUI);

  taskEl?.addEventListener("change", (e) => {
    state.taskId = e.target.value;
    populateModes();
    refreshReadinessUI();
  });

  modeEl?.addEventListener("change", (e) => {
    state.mode = e.target.value;
    refreshReadinessUI();
  });

  el("gen")?.addEventListener("click", generate);
  el("markDone")?.addEventListener("click", markDone);
  el("resetSession")?.addEventListener("click", () => {
    const d = safeTrim(el("domain")?.value);
    if (!d) return;
    resetCompletedFiles(d);
    setStatus("Session markers reset for this domain.", "ok");
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  wireUI();
  await loadPlaybook();
});
