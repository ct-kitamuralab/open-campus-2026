(() => {
  "use strict";

  const drawButton = document.querySelector("#drawButton");
  const nextButton = document.querySelector("#nextButton");
  const declaration = document.querySelector("#declaration");
  const resultActions = document.querySelector("#resultActions");
  const mysteryBox = document.querySelector("#mysteryBox");
  const boxMark = document.querySelector("#boxMark");
  const drawBall = document.querySelector("#drawBall");
  const drawText = document.querySelector("#drawText");
  const roundCount = document.querySelector("#roundCount");
  const status = document.querySelector("#status");
  const statusLabel = status.querySelector("span");
  const message = document.querySelector("#message");
  const probabilityA = document.querySelector("#probabilityA");
  const probabilityB = document.querySelector("#probabilityB");
  const probabilityBar = document.querySelector("#probabilityBar");
  const barA = document.querySelector("#barA");
  const barB = document.querySelector("#barB");
  const blueCount = document.querySelector("#blueCount");
  const redCount = document.querySelector("#redCount");
  const history = document.querySelector("#history");

  let hiddenBox = "A";
  let observations = [];
  let finished = false;

  function calculateProbabilityA() {
    const difference = observations.reduce((total, color) => {
      return total + (color === "blue" ? 1 : -1);
    }, 0);

    if (difference >= 0) {
      return 1 / (1 + Math.pow(3, -difference));
    }

    const oddsA = Math.pow(3, difference);
    return oddsA / (1 + oddsA);
  }

  function describeUpdate(color, probability) {
    const difference = Math.abs(probability - 0.5);

    if (difference < 0.0001) {
      return "青と赤の情報が打ち消し合い、AとBが同じくらいに戻りました";
    }

    const likelyBox = probability > 0.5 ? "A" : "B";
    const colorName = color === "blue" ? "青" : "赤";
    return `${colorName}が出ました。今は箱${likelyBox}の可能性が高そうです`;
  }

  function renderProbabilities() {
    const probability = calculateProbabilityA();
    const percentA = probability * 100;
    const percentB = 100 - percentA;
    const labelA = `${percentA.toFixed(1)}%`;
    const labelB = `${percentB.toFixed(1)}%`;

    probabilityA.textContent = labelA;
    probabilityB.textContent = labelB;
    barA.style.width = `${percentA}%`;
    barB.style.width = `${percentB}%`;
    probabilityBar.setAttribute("aria-label", `箱A ${labelA}、箱B ${labelB}`);

    return probability;
  }

  function renderHistory() {
    const blues = observations.filter((color) => color === "blue").length;
    const reds = observations.length - blues;

    blueCount.textContent = `青 ${blues}`;
    redCount.textContent = `赤 ${reds}`;
    roundCount.textContent = `観測 ${observations.length}回`;
    history.innerHTML = "";

    if (observations.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-history";
      empty.textContent = "球を引くと、ここに色が並びます。";
      history.append(empty);
      return;
    }

    observations.forEach((color, index) => {
      const ball = document.createElement("span");
      const colorName = color === "blue" ? "青" : "赤";
      ball.className = `history-ball ${color}`;
      ball.textContent = index + 1;
      ball.setAttribute("aria-label", `${index + 1}回目: ${colorName}`);
      history.append(ball);
    });
  }

  function draw() {
    if (finished) return;

    const blueProbability = hiddenBox === "A" ? 0.75 : 0.25;
    const color = Math.random() < blueProbability ? "blue" : "red";
    const colorName = color === "blue" ? "青" : "赤";

    observations.push(color);
    drawBall.className = `draw-placeholder ${color}`;
    drawBall.textContent = "";
    drawText.textContent = `${colorName}い球が出ました`;
    renderHistory();

    const probability = renderProbabilities();
    statusLabel.textContent = `OBSERVATION ${observations.length}`;
    message.textContent = describeUpdate(color, probability);
    declaration.disabled = false;
  }

  function finish(guess) {
    if (finished || observations.length === 0) return;

    finished = true;
    const correct = guess === hiddenBox;
    const resultText = correct ? "正解です" : "惜しい、不正解です";

    status.classList.add(correct ? "correct" : "incorrect");
    statusLabel.textContent = correct ? "CORRECT" : "RESULT";
    message.textContent = `${resultText}。使われていたのは箱${hiddenBox}でした`;
    mysteryBox.classList.add("revealed");
    boxMark.textContent = hiddenBox;
    drawButton.disabled = true;
    declaration.disabled = true;
    resultActions.hidden = false;
  }

  function startGame() {
    hiddenBox = Math.random() < 0.5 ? "A" : "B";
    observations = [];
    finished = false;

    mysteryBox.classList.remove("revealed");
    boxMark.textContent = "?";
    drawBall.className = "draw-placeholder";
    drawBall.textContent = "?";
    drawText.textContent = "まだ球を引いていません";
    status.classList.remove("correct", "incorrect");
    statusLabel.textContent = "START";
    message.textContent = "最初はAとBが同じくらいありそうです";
    drawButton.disabled = false;
    declaration.disabled = true;
    resultActions.hidden = true;

    renderHistory();
    renderProbabilities();
  }

  drawButton.addEventListener("click", draw);
  nextButton.addEventListener("click", startGame);
  declaration.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => finish(button.dataset.guess));
  });

  startGame();
})();
