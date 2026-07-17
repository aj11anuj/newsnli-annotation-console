/* ═══════════════════════════════════════════
   NewsNLI Audio Annotator – App Logic
   ═══════════════════════════════════════════ */

(() => {
  "use strict";

  // ─── DOM references ───
  const $ = (sel) => document.querySelector(sel);
  const uploadScreen   = $("#uploadScreen");
  const annotationScreen = $("#annotationScreen");
  const completeScreen = $("#completeScreen");
  const dropZone       = $("#dropZone");
  const csvFileInput   = $("#csvFileInput");
  const resumeSection  = $("#resumeSection");
  const resumeCards    = $("#resumeCards");
  const headerStats    = $("#headerStats");
  const progressText   = $("#progressText");
  const fileNameDisplay= $("#fileNameDisplay");
  const progressBar    = $("#progressBar");
  const sampleCard     = $("#sampleCard");
  const sampleBadge    = $("#sampleBadge");
  const premiseText    = $("#premiseText");
  const hypothesisText = $("#hypothesisText");
  const categoryBadge  = $("#categoryBadge");
  const recordBtn      = $("#recordBtn");
  const recordPulse    = $("#recordPulse");
  const recordInstruction = $("#recordInstruction");
  const recordTimer    = $("#recordTimer");
  const timerText      = $("#timerText");
  const prevBtn        = $("#prevBtn");
  const skipBtn        = $("#skipBtn");
  const statusBar      = $("#sampleStatusBar");
  const totalCompleted = $("#totalCompleted");
  const completeFolderName = $("#completeFolderName");
  const newSessionBtn  = $("#newSessionBtn");
  const fixedSidebar   = $("#fixedSidebar");

  // ─── State ───
  let csvData       = [];      // Array of {premise, hypothesis, category}
  let csvFileName   = "";
  let currentIndex  = 0;
  let recordedSet   = new Set();  // indices that have recordings
  let mediaRecorder = null;
  let audioChunks   = [];
  let isRecording   = false;
  let timerInterval = null;
  let timerSeconds  = 0;
  let isSaving      = false;

  // ─── Init ───
  init();

  async function init() {
    setupUploadHandlers();
    setupRecordHandlers();
    setupNavHandlers();
    await loadSavedProgress();
  }

  // ═══════════════ CSV UPLOAD ═══════════════

  function setupUploadHandlers() {
    dropZone.addEventListener("click", () => csvFileInput.click());

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".csv")) {
        handleCSVFile(file);
      } else {
        showToast("Please upload a .csv file", "error");
      }
    });

    csvFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) handleCSVFile(file);
    });

    newSessionBtn.addEventListener("click", () => {
      showScreen("upload");
      loadSavedProgress();
    });
  }

  function handleCSVFile(file) {
    csvFileName = file.name;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      csvData = parseCSV(text);
      if (csvData.length === 0) {
        showToast("No valid data found in CSV", "error");
        return;
      }
      // Check for existing recordings
      const existingRes = await fetch(`/api/check-recordings/${encodeURIComponent(csvFileName)}`);
      const existingData = await existingRes.json();
      if (existingData.success && existingData.recorded.length > 0) {
        recordedSet = new Set(existingData.recorded);
      } else {
        recordedSet = new Set();
      }

      // Check saved progress for this file
      const progressRes = await fetch("/api/load-progress");
      const progressData = await progressRes.json();
      if (progressData.success && progressData.progress[csvFileName]) {
        currentIndex = progressData.progress[csvFileName].currentIndex;
        // Ensure index is valid
        if (currentIndex >= csvData.length) currentIndex = 0;
      } else {
        currentIndex = 0;
      }

      startAnnotation();
    };
    reader.readAsText(file);
  }

  function parseCSV(text) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    // Parse header to find column indices
    const headerTokens = parseCSVLine(lines[0]);
    const headers = headerTokens.map((h) => h.toLowerCase().trim());

    const premiseIdx    = headers.findIndex((h) => h === "premise");
    const hypothesisIdx = headers.findIndex((h) => h === "hypothesis");
    const categoryIdx   = headers.findIndex((h) => h === "category");

    if (premiseIdx === -1 || hypothesisIdx === -1) {
      showToast("CSV must have 'premise' and 'hypothesis' columns", "error");
      return [];
    }

    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length <= Math.max(premiseIdx, hypothesisIdx)) continue;
      data.push({
        premise:    cols[premiseIdx]    || "",
        hypothesis: cols[hypothesisIdx] || "",
        category:   categoryIdx !== -1 ? (cols[categoryIdx] || "—") : "—",
      });
    }
    return data;
  }

  /** Handle quoted CSV fields properly */
  function parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          result.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    result.push(current.trim());
    return result;
  }

  // ═══════════════ RESUME ═══════════════

  async function loadSavedProgress() {
    try {
      const res = await fetch("/api/load-progress");
      const data = await res.json();
      if (!data.success || Object.keys(data.progress).length === 0) {
        resumeSection.style.display = "none";
        return;
      }

      resumeCards.innerHTML = "";
      for (const [name, info] of Object.entries(data.progress)) {
        const card = document.createElement("div");
        card.className = "resume-card";
        card.innerHTML = `
          <div class="resume-card-info">
            <div class="resume-card-name">${escapeHTML(name)}</div>
            <div class="resume-card-progress">Sample ${info.currentIndex + 1} of ${info.totalSamples} · Last active ${timeAgo(info.lastUpdated)}</div>
          </div>
          <svg class="resume-card-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        `;
        card.addEventListener("click", () => {
          showToast("Upload the same CSV file to resume", "success");
        });
        resumeCards.appendChild(card);
      }
      resumeSection.style.display = "block";
    } catch {
      resumeSection.style.display = "none";
    }
  }

  // ═══════════════ ANNOTATION ═══════════════

  function startAnnotation() {
    showScreen("annotation");
    headerStats.style.display = "flex";
    fileNameDisplay.textContent = csvFileName.replace(/\.csv$/i, "");
    buildStatusBar();
    renderSample();
  }

  function renderSample() {
    if (currentIndex >= csvData.length) {
      finishAnnotation();
      return;
    }

    const sample = csvData[currentIndex];

    // Animate card
    sampleCard.style.animation = "none";
    // Force reflow
    void sampleCard.offsetHeight;
    sampleCard.style.animation = "card-in 0.4s cubic-bezier(0.22, 1, 0.36, 1)";

    sampleBadge.textContent = `Sample ${currentIndex + 1}`;
    premiseText.textContent  = sample.premise;
    hypothesisText.textContent = sample.hypothesis;
    categoryBadge.textContent  = sample.category;

    // Update re-record badge
    const existingBadge = sampleCard.querySelector(".re-record-badge");
    if (existingBadge) existingBadge.remove();
    if (recordedSet.has(currentIndex)) {
      const badge = document.createElement("div");
      badge.className = "re-record-badge";
      badge.textContent = "✓ Recorded";
      sampleCard.appendChild(badge);
    }

    // Update progress
    const completed = recordedSet.size;
    progressText.textContent = `${completed} / ${csvData.length}`;
    const pct = (completed / csvData.length) * 100;
    progressBar.style.width = pct + "%";

    // Update nav
    prevBtn.disabled = currentIndex === 0;

    // Update status dots
    updateStatusBar();

    // Save progress
    saveProgress();
  }

  function buildStatusBar() {
    statusBar.innerHTML = "";
    const maxDots = 100; // Only show dots for up to 100 samples to keep UI clean
    const total = csvData.length;

    if (total <= maxDots) {
      for (let i = 0; i < total; i++) {
        const dot = document.createElement("div");
        dot.className = "status-dot";
        dot.title = `Sample ${i + 1}`;
        dot.addEventListener("click", () => {
          currentIndex = i;
          renderSample();
        });
        statusBar.appendChild(dot);
      }
    } else {
      // Too many — show a condensed version
      statusBar.style.display = "none";
    }
  }

  function updateStatusBar() {
    const dots = statusBar.querySelectorAll(".status-dot");
    dots.forEach((dot, i) => {
      dot.classList.remove("current", "recorded");
      if (i === currentIndex) dot.classList.add("current");
      else if (recordedSet.has(i)) dot.classList.add("recorded");
    });
  }

  async function saveProgress() {
    try {
      await fetch("/api/save-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvName: csvFileName,
          currentIndex,
          totalSamples: csvData.length,
        }),
      });
    } catch {
      // Silently fail – not critical
    }
  }

  function finishAnnotation() {
    showScreen("complete");
    totalCompleted.textContent = recordedSet.size;
    completeFolderName.textContent = `recordings/${csvFileName.replace(/\.csv$/i, "")}`;
  }

  // ═══════════════ RECORDING ═══════════════

  function setupRecordHandlers() {
    recordBtn.addEventListener("mouseenter", startRecording);
    recordBtn.addEventListener("mouseleave", stopRecording);

    // Fallback for touch devices
    recordBtn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      startRecording();
    });
    recordBtn.addEventListener("touchend", (e) => {
      e.preventDefault();
      stopRecording();
    });
  }

  async function startRecording() {
    if (isRecording || isSaving) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: getSupportedMimeType(),
      });
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((t) => t.stop());

        if (audioChunks.length === 0) return;

        const blob = new Blob(audioChunks, { type: getSupportedMimeType() });
        await saveAudio(blob);
      };

      mediaRecorder.start(100); // Collect data every 100ms
      isRecording = true;

      // Visual feedback
      recordBtn.classList.add("recording");
      recordPulse.classList.add("active");
      recordInstruction.textContent = "Recording… move cursor away to stop";
      recordInstruction.classList.add("recording");
      recordTimer.style.display = "flex";
      startTimer();

    } catch (err) {
      console.error("Mic access error:", err);
      showToast("Microphone access denied. Please allow mic access.", "error");
    }
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;

    isRecording = false;
    mediaRecorder.stop();

    // Reset visuals
    recordBtn.classList.remove("recording");
    recordPulse.classList.remove("active");
    recordInstruction.textContent = "Hover over the button to start recording";
    recordInstruction.classList.remove("recording");
    stopTimer();
    recordTimer.style.display = "none";
  }

  async function saveAudio(blob) {
    isSaving = true;
    showSavingOverlay(true);

    const sample = csvData[currentIndex];
    const formData = new FormData();
    formData.append("audio", blob, `sample_${currentIndex}.webm`);
    formData.append("folderName", csvFileName);
    formData.append("sampleNumber", String(currentIndex));
    formData.append("premise", sample.premise || "");
    formData.append("hypothesis", sample.hypothesis || "");
    formData.append("category", sample.category || "");

    try {
      const res = await fetch("/api/save-audio", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let errMsg = "Failed to save audio";
        try {
          const errData = await res.json();
          if (errData && errData.detail) errMsg = errData.detail;
        } catch {}
        showToast(errMsg, "error");
        return;
      }

      const data = await res.json();

      if (data.success) {
        recordedSet.add(currentIndex);
        showToast(`Sample ${currentIndex + 1} saved ✓`, "success");

        // Auto-advance to next sample
        currentIndex++;
        renderSample();
      } else {
        showToast("Failed to save audio", "error");
      }
    } catch (err) {
      console.error("Save error:", err);
      showToast("Error saving audio file", "error");
    } finally {
      isSaving = false;
      showSavingOverlay(false);
    }
  }

  function getSupportedMimeType() {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return "audio/webm";
  }

  // ─── Timer ───
  function startTimer() {
    timerSeconds = 0;
    timerText.textContent = "0:00";
    timerInterval = setInterval(() => {
      timerSeconds++;
      const mins = Math.floor(timerSeconds / 60);
      const secs = timerSeconds % 60;
      timerText.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // ═══════════════ NAVIGATION ═══════════════

  function setupNavHandlers() {
    prevBtn.addEventListener("click", () => {
      if (currentIndex > 0) {
        currentIndex--;
        renderSample();
      }
    });

    skipBtn.addEventListener("click", () => {
      currentIndex++;
      renderSample();
    });
  }

  // ═══════════════ UI HELPERS ═══════════════

  function showScreen(name) {
    uploadScreen.style.display     = name === "upload"     ? "" : "none";
    annotationScreen.style.display = name === "annotation" ? "" : "none";
    completeScreen.style.display   = name === "complete"   ? "" : "none";

    // Show/hide the fixed sidebar alongside the annotation screen
    if (fixedSidebar) {
      fixedSidebar.style.display = name === "annotation" ? "flex" : "none";
    }

    if (name === "upload") {
      headerStats.style.display = "none";
    }
  }

  function showToast(message, type = "success") {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `toast ${type}`;

    // Force reflow then show
    void toast.offsetHeight;
    toast.classList.add("visible");

    setTimeout(() => toast.classList.remove("visible"), 2500);
  }

  function showSavingOverlay(show) {
    let overlay = document.querySelector(".saving-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "saving-overlay";
      overlay.innerHTML = '<div class="saving-spinner"></div>';
      document.body.appendChild(overlay);
    }
    if (show) overlay.classList.add("visible");
    else overlay.classList.remove("visible");
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function timeAgo(isoStr) {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
})();
