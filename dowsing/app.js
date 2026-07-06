(() => {
  "use strict";

  const LEVELS = {
    easy: { size: 8, signal: 10, noise: 0.65 },
    normal: { size: 10, signal: 8, noise: 1.35 },
    hard: { size: 12, signal: 6.5, noise: 2.1 }
  };

  const $ = (selector) => document.querySelector(selector);
  const grid = $("#grid");
  const state = {
    round: "plain",
    scores: { plain: null, bayes: null },
    target: null,
    clicks: 0,
    history: [],
    probabilities: [],
    finished: false
  };

  function gaussianRandom() {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function params() {
    return LEVELS[$("#difficulty").value];
  }

  function roundName(round) {
    return round === "bayes" ? "ベイズあり" : "ヒントなし";
  }

  function freshProbabilities(size) {
    return Array(size * size).fill(1 / (size * size));
  }

  function newRound(round) {
    const { size } = params();
    state.round = round;
    state.target = Math.floor(Math.random() * size * size);
    state.clicks = 0;
    state.history = [];
    state.probabilities = freshProbabilities(size);
    state.finished = false;
    $("#roundComplete").hidden = true;
    $("#resultPanel").hidden = true;
    $("#gamePlay").hidden = false;
    updateRoundUI();
    renderGrid();
    renderStatus();
  }

  function updateRoundUI() {
    const isBayes = state.round === "bayes";
    $("#roundBadge").textContent = isBayes ? "ベイズあり" : "ヒントなし";
    $("#roundBadge").className = `status-badge ${isBayes ? "bayes" : "plain"}`;
    $("#roundTitle").textContent = isBayes ? "お宝予想マップを使おう" : "センサー反応だけで探そう";
    $("#roundInstruction").textContent = isBayes
      ? "明るい色ほど宝箱がありそうなマス。✦ は現在もっとも確率が高い場所です。"
      : "地面をクリックしてロッド型センサーをかざそう。色は変わらないので、反応の強さを覚えて推理しよう。";
    $("#bayesTip").hidden = !isBayes;
    $("#legend").innerHTML = isBayes
      ? '<span>0%</span><i class="legend-gradient"></i><span>20%以上</span><span class="legend-box checked"></span><span>調査済み</span>'
      : '<span>未調査</span><span class="legend-box checked"></span><span>調査済み</span>';

    renderProgress();
  }

  function renderProgress(showResult = false) {
    const order = ["plain", "bayes"];
    const steps = [
      { round: order[0], label: roundName(order[0]) },
      { round: order[1], label: roundName(order[1]) },
      { round: "result", label: "結果を比較" }
    ];
    const bothComplete = state.scores.plain !== null && state.scores.bayes !== null;

    $("#roundProgress").innerHTML = steps.map((step, index) => {
      const isActive = showResult ? step.round === "result" : step.round === state.round;
      const isDone = step.round !== "result" && state.scores[step.round] !== null;
      const isLocked = step.round === "result" && !bothComplete;
      const status = `${isDone ? "done" : ""} ${isActive ? "active" : ""} ${isLocked ? "result-locked" : ""}`;
      const line = index < 2
        ? `<div class="progress-line"><i class="${state.scores[steps[index].round] !== null ? "filled" : ""}"></i></div>`
        : "";
      return `
        <button class="round-step ${status}" type="button" data-round-select="${step.round}"
          ${isLocked ? 'disabled aria-disabled="true" title="両方のモードをクリアすると結果を見られます"' : ""}>
          <span>${index + 1}</span>
          <div><small>${index === 2 ? "RESULT" : `ROUND ${index + 1}`}</small><strong>${step.label}</strong></div>
        </button>${line}`;
    }).join("");

    document.querySelectorAll("[data-round-select]").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = button.dataset.roundSelect;
        if (selected === "result") {
          showResults();
          return;
        }
        if (selected === state.round && !$("#gamePlay").hidden) return;
        state.scores[selected] = null;
        newRound(selected);
      });
    });
  }

  function renderGrid() {
    const { size } = params();
    grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    grid.replaceChildren();
    const maxProbability = Math.max(...state.probabilities);
    const recommended = state.probabilities.indexOf(maxProbability);
    const uniformProbability = 1 / (size * size);

    state.probabilities.forEach((probability, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.dataset.index = index;
      button.setAttribute("role", "gridcell");
      const x = index % size;
      const y = Math.floor(index / size);
      button.setAttribute("aria-label", `${y + 1}行 ${x + 1}列にダウジングロッドをかざす`);

      if (state.history.some((item) => item.index === index)) button.classList.add("checked");
      if (state.round === "bayes") {
        button.style.background = probabilityColor(probability, uniformProbability);
        if (index === recommended && state.clicks > 0) button.classList.add("recommended");
        button.title = `宝箱の推定確率 ${(probability * 100).toFixed(1)}%`;
      }
      if (state.finished && index === state.target) button.classList.add("target");
      button.addEventListener("click", () => scan(index));
      grid.appendChild(button);
    });
  }

  function probabilityColor(probability, uniformProbability) {
    // 固定された絶対確率で着色する。
    // 最大値を常に赤くする相対表示ではないため、最大候補が3%なら暗い色のままになる。
    const stops = [
      [0, [21, 40, 76]],
      [.01, [24, 67, 101]],
      [.03, [28, 140, 166]],
      [.05, [32, 196, 217]],
      [.10, [223, 242, 58]],
      [.20, [255, 107, 53]]
    ];

    // 初期の一様確率以下は、候補として絞れていないので最も暗く見せる。
    const value = probability <= uniformProbability ? 0 : Math.min(.20, probability);
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 1; i < stops.length; i += 1) {
      if (value <= stops[i][0]) {
        a = stops[i - 1];
        b = stops[i];
        break;
      }
    }
    const ratio = (value - a[0]) / (b[0] - a[0] || 1);
    const rgb = a[1].map((channel, i) => Math.round(channel + (b[1][i] - channel) * ratio));
    return `rgb(${rgb.join(",")})`;
  }

  function scan(index) {
    if (state.finished) return;
    const { size, signal, noise } = params();
    const x = index % size;
    const y = Math.floor(index / size);
    const tx = state.target % size;
    const ty = Math.floor(state.target / size);
    const distance = Math.hypot(x - tx, y - ty);
    const expected = signal / (distance + 1);
    const reading = Math.max(0, expected + gaussianRandom() * noise);

    updateBayes(index, reading);
    state.clicks += 1;
    state.history.unshift({ index, x, y, reading });
    if (index === state.target) {
      state.finished = true;
      state.scores[state.round] = state.clicks;
    }
    renderGrid();
    renderStatus(reading);
    if (state.finished) window.setTimeout(showRoundComplete, 500);
  }

  function updateBayes(scanIndex, reading) {
    const { size, signal, noise } = params();
    const scanX = scanIndex % size;
    const scanY = Math.floor(scanIndex / size);
    const updated = state.probabilities.map((prior, hypothesisIndex) => {
      const hx = hypothesisIndex % size;
      const hy = Math.floor(hypothesisIndex / size);
      const expected = signal / (Math.hypot(scanX - hx, scanY - hy) + 1);
      const likelihood = Math.exp(-.5 * ((reading - expected) / noise) ** 2);
      return prior * Math.max(likelihood, 1e-12);
    });
    const total = updated.reduce((sum, value) => sum + value, 0);
    state.probabilities = updated.map((value) => value / total);
  }

  function renderStatus(reading) {
    $("#clickCount").textContent = state.clicks;
    if (typeof reading !== "number") {
      $("#readingLabel").textContent = "まだ観測していません";
      $("#readingText").textContent = "地面を1マス選んで、ロッドをかざしてみよう。";
      $("#meterFill").style.width = "0";
    } else {
      const strength = Math.min(100, Math.round(reading / params().signal * 100));
      $("#meterFill").style.width = `${strength}%`;
      $("#readingLabel").textContent = `${reading.toFixed(2)} / ${params().signal}`;
      $("#readingText").textContent =
        strength >= 70 ? "ロッドが大きく揺れた！ 宝箱はすぐ近くかも。" :
        strength >= 40 ? "ロッドが反応している。この辺りは怪しそう。" :
        strength >= 15 ? "かすかな反応。宝箱は少し離れているかも。" :
        "ロッドはほぼ動かない。別の場所へ行ってみよう。";
    }

    const log = $("#historyLog");
    log.replaceChildren();
    if (!state.history.length) {
      const empty = document.createElement("li");
      empty.className = "empty-log";
      empty.textContent = "まだ記録はありません";
      log.appendChild(empty);
    } else {
      state.history.slice(0, 8).forEach((item, i) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${state.clicks - i}回目：${item.y + 1}行 ${item.x + 1}列</span><strong>反応 ${item.reading.toFixed(2)}</strong>`;
        log.appendChild(li);
      });
    }

    if (state.round === "bayes" && state.clicks > 0) {
      const maximum = Math.max(...state.probabilities);
      const percent = maximum * 100;
      const confidence =
        percent >= 20 ? "かなり有力です" :
        percent >= 10 ? "有力になってきました" :
        percent >= 5 ? "まだ候補が分散しています" :
        "現在トップですが、確率はまだ低いです";
      $("#tipText").textContent = `✦ は現在の1位（推定確率 ${percent.toFixed(1)}%）。${confidence}。`;
    }
  }

  function showRoundComplete() {
    const nextRound = state.round === "plain" ? "bayes" : "plain";
    const nextIsIncomplete = state.scores[nextRound] === null;
    const roundNumber = state.round === "plain" ? 1 : 2;
    $("#completeEyebrow").textContent = `ROUND ${roundNumber} COMPLETE`;
    $("#completeMessage").textContent = `${state.clicks}回の観測で掘り当てました。`;
    $("#nextRoundButton").innerHTML = nextIsIncomplete
      ? `${roundName(nextRound)}に挑戦 <span>→</span>`
      : "結果を比較する <span>→</span>";
    $("#roundComplete").hidden = false;
  }

  function nextStage() {
    const nextRound = ["plain", "bayes"].find((round) => state.scores[round] === null);
    if (nextRound) {
      newRound(nextRound);
      $("#game").scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      showResults();
    }
  }

  function showResults() {
    $("#roundComplete").hidden = true;
    $("#gamePlay").hidden = true;
    $("#resultPanel").hidden = false;
    $("#plainScore").textContent = state.scores.plain;
    $("#bayesScore").textContent = state.scores.bayes;
    renderProgress(true);

    const difference = state.scores.plain - state.scores.bayes;
    if (difference > 0) {
      const reduction = Math.round(difference / state.scores.plain * 100);
      $("#resultHeadline").textContent = "お宝予想マップが冒険を短縮！";
      $("#resultInsight").textContent = `今回はベイズありの方が ${difference}回少なく、観測回数を約${reduction}%減らせました。`;
    } else if (difference < 0) {
      $("#resultHeadline").textContent = "今回は「ヒントなし」が勝利";
      $("#resultInsight").textContent = "ベイズは必ず当たる魔法ではありません。誤差と偶然があるからこそ、複数回試すことが大切です。";
    } else {
      $("#resultHeadline").textContent = "今回は引き分け！";
      $("#resultInsight").textContent = "同じ回数で発見しました。もう一度試すと、違う結果になるかもしれません。";
    }
  }

  $("#nextRoundButton").addEventListener("click", nextStage);
  $("#playAgainButton").addEventListener("click", () => {
    state.scores = { plain: null, bayes: null };
    newRound("plain");
    $("#game").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#resetButton").addEventListener("click", () => {
    state.scores = { plain: null, bayes: null };
    newRound(state.round);
  });
  $("#difficulty").addEventListener("change", () => {
    state.scores = { plain: null, bayes: null };
    newRound(state.round);
  });

  newRound("plain");
})();
