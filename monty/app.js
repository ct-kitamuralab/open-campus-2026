const doorsEl = document.querySelector("#doors");
const messageEl = document.querySelector("#message");
const stepLabelEl = document.querySelector("#stepLabel");
const statusCard = document.querySelector(".status-card");
const nextButton = document.querySelector("#nextButton");
const autoButton = document.querySelector("#autoButton");
const resetButton = document.querySelector("#resetButton");
const trialCountSelect = document.querySelector("#trialCount");
const progressWrap = document.querySelector("#progressWrap");
const progressBar = document.querySelector("#progressBar");
const progressText = document.querySelector("#progressText");

const nextActions = document.querySelector("#nextActions");
const autoActions = document.querySelector("#autoActions");

const stats = {
  stayWins: 0,
  stayTotal: 0,
  switchWins: 0,
  switchTotal: 0,
};

let prizeDoor = 0;
let selectedDoor = null;
let openedDoor = null;
let phase = "pick"; // "pick" | "decide" | "finished"
let autoRunning = false;

function randomDoor() {
  return Math.floor(Math.random() * 3);
}

/* ── UI Phase Control ── */
function showPhase(newPhase) {
  phase = newPhase;
  nextActions.classList.remove("visible");
  autoActions.classList.remove("visible");
  statusCard.classList.remove("result-win", "result-lose");

  switch (newPhase) {
    case "pick":
      autoActions.classList.add("visible");
      break;
    case "decide":
      // No buttons — user clicks doors directly
      break;
    case "result-win":
      nextActions.classList.add("visible");
      autoActions.classList.add("visible");
      statusCard.classList.add("result-win");
      break;
    case "result-lose":
      nextActions.classList.add("visible");
      autoActions.classList.add("visible");
      statusCard.classList.add("result-lose");
      break;
    case "auto":
      break;
  }
}

/* ── Game Flow ── */
function startRound() {
  prizeDoor = randomDoor();
  selectedDoor = null;
  openedDoor = null;
  stepLabelEl.textContent = "STEP 1";
  messageEl.textContent = "ドアを選んでください";
  showPhase("pick");
  renderDoors();
}

function onDoorClick(door) {
  if (autoRunning) return;

  if (phase === "pick") {
    // STEP 1: First pick
    selectedDoor = door;
    renderDoors();
    stepLabelEl.textContent = "STEP 1";
    messageEl.textContent = `ドア${door + 1}を選択中…`;

    // Delay before host reveals
    setTimeout(() => {
      revealGoatDoor();
    }, 600);

  } else if (phase === "decide") {
    // STEP 2: Final pick — click a door directly
    if (door === openedDoor) return; // Can't pick the opened door
    finishRound(door);
  }
}

function revealGoatDoor() {
  const candidates = [0, 1, 2].filter((d) => d !== selectedDoor && d !== prizeDoor);
  openedDoor = candidates[Math.floor(Math.random() * candidates.length)];
  stepLabelEl.textContent = "STEP 2";
  messageEl.textContent = `ドア${openedDoor + 1}はハズレでした！ 残りのドアをクリックしてください`;
  showPhase("decide");
  renderDoors();

  // Add reveal animation
  const doorEls = doorsEl.querySelectorAll(".door");
  doorEls[openedDoor].classList.add("revealing");
}

function finishRound(finalDoor) {
  const won = finalDoor === prizeDoor;
  const switched = finalDoor !== selectedDoor;

  if (switched) {
    stats.switchTotal += 1;
    if (won) stats.switchWins += 1;
  } else {
    stats.stayTotal += 1;
    if (won) stats.stayWins += 1;
  }

  selectedDoor = finalDoor;

  const action = switched ? "選び直して" : "そのままで";
  stepLabelEl.textContent = "RESULT";
  if (won) {
    messageEl.textContent = `🎉 当たり！ ${action}ドア${finalDoor + 1}が正解！`;
    showPhase("result-win");
  } else {
    messageEl.textContent = `残念… 正解はドア${prizeDoor + 1}でした`;
    showPhase("result-lose");
  }

  renderDoors();
  renderStats(true);
}

/* ── Auto Trials ── */
function runAutoTrials() {
  if (autoRunning) return;
  autoRunning = true;

  const totalTrials = parseInt(trialCountSelect.value, 10);
  let current = 0;

  autoButton.disabled = true;
  autoButton.textContent = "実行中…";
  resetButton.disabled = true;
  progressWrap.classList.add("active");
  progressBar.style.width = "0%";
  progressText.textContent = `0 / ${totalTrials}`;

  stepLabelEl.textContent = "SIMULATION";
  messageEl.textContent = "自動シミュレーション中…";
  showPhase("auto");
  autoActions.classList.add("visible");

  const interval = setInterval(() => {
    const prize = randomDoor();
    const firstChoice = randomDoor();
    const hostCandidates = [0, 1, 2].filter((d) => d !== firstChoice && d !== prize);
    const hostOpen = hostCandidates[Math.floor(Math.random() * hostCandidates.length)];
    const switchedDoor = [0, 1, 2].find((d) => d !== firstChoice && d !== hostOpen);

    if (current % 2 === 0) {
      stats.stayTotal += 1;
      if (firstChoice === prize) stats.stayWins += 1;
    } else {
      stats.switchTotal += 1;
      if (switchedDoor === prize) stats.switchWins += 1;
    }

    current += 1;
    const pct = (current / totalTrials) * 100;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `${current} / ${totalTrials}`;
    renderStats(false);

    if (current >= totalTrials) {
      clearInterval(interval);
      autoRunning = false;
      autoButton.disabled = false;
      autoButton.textContent = "自動シミュレーション";
      resetButton.disabled = false;

      stepLabelEl.textContent = "COMPLETE";
      messageEl.textContent = `${totalTrials}回のシミュレーションが完了しました`;
      showPhase("pick");

      setTimeout(() => {
        progressWrap.classList.remove("active");
      }, 1500);
    }
  }, 30);
}

/* ── Reset ── */
function resetStats() {
  stats.stayWins = 0;
  stats.stayTotal = 0;
  stats.switchWins = 0;
  stats.switchTotal = 0;
  renderStats(false);
  startRound();
}

/* ── Render ── */
function formatRate(wins, total) {
  if (total === 0) return "0%";
  return `${Math.round((wins / total) * 100)}%`;
}

function renderStats(animate) {
  document.querySelector("#stayWins").textContent = stats.stayWins;
  document.querySelector("#stayTotal").textContent = stats.stayTotal;
  document.querySelector("#stayRate").textContent = formatRate(stats.stayWins, stats.stayTotal);
  document.querySelector("#switchWins").textContent = stats.switchWins;
  document.querySelector("#switchTotal").textContent = stats.switchTotal;
  document.querySelector("#switchRate").textContent = formatRate(stats.switchWins, stats.switchTotal);
  document.querySelector("#totalCount").textContent = stats.stayTotal + stats.switchTotal;

  if (animate) {
    document.querySelectorAll(".stats article").forEach((el) => {
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
    });
  }
}

function renderDoors() {
  doorsEl.innerHTML = "";

  for (let door = 0; door < 3; door += 1) {
    const button = document.createElement("button");
    const isHostOpen = door === openedDoor;
    const isFinished = phase === "result-win" || phase === "result-lose";
    const isOpen = isHostOpen || isFinished;

    // Clickable in "pick" (if not yet picked) or "decide" (if not the opened door)
    const canClick =
      (phase === "pick" && selectedDoor === null) ||
      (phase === "decide" && door !== openedDoor);

    button.type = "button";
    button.className = "door";
    button.disabled = !canClick;

    // Aria label
    let ariaState = "未開封";
    if (isOpen) {
      ariaState = door === prizeDoor ? "当たり" : "ハズレ";
    }
    button.setAttribute("aria-label", `ドア${door + 1}: ${ariaState}`);

    // Tag
    let tagHTML = "";
    if (door === selectedDoor && !isFinished) {
      tagHTML = `<span class="door-tag">あなたの選択</span>`;
    } else if (isFinished && door === selectedDoor) {
      tagHTML = `<span class="door-tag">最終選択</span>`;
    }

    // Icon for opened doors
    const iconContent = isOpen ? (door === prizeDoor ? "🎁" : "❌") : "";

    button.innerHTML = `
      ${tagHTML}
      <span class="door-number">${door + 1}</span>
      <span class="door-icon">${iconContent}</span>
    `;

    // State classes
    if (door === selectedDoor) button.classList.add("selected");
    if (isOpen) button.classList.add("open");
    if (isFinished && door === prizeDoor) button.classList.add("win");
    if (isFinished && door !== prizeDoor) button.classList.add("lose");

    // In "decide" phase, highlight the clickable doors
    if (phase === "decide" && door !== openedDoor) {
      button.classList.add("choosable");
    }

    button.addEventListener("click", () => onDoorClick(door));
    doorsEl.append(button);
  }
}

/* ── Event Listeners ── */
nextButton.addEventListener("click", startRound);
autoButton.addEventListener("click", runAutoTrials);
resetButton.addEventListener("click", resetStats);

/* ── Init ── */
renderStats(false);
startRound();
