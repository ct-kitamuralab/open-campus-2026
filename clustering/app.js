(() => {
  "use strict";

  const TARGET_DEPARTMENT = "高度応用情報科学科";
  const COLORS = ["#ff6b35", "#15284c", "#20c4d9", "#dff23a", "#7d5fff", "#00a676", "#f0a202", "#d7263d", "#6f42c1", "#008c7a"];
  const ANALYSIS_DATA_URL = "../data/clustering-analysis.json";
  const KUROMOJI_SCRIPT_URL = "../vendor/kuromoji.js";
  const KUROMOJI_DICT_PATH = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";
  const MAX_TERMS = 1400;
  const QUALITY = {
    full: { label: "本文あり", order: 0 },
    summary: { label: "短文のみ", order: 1 },
    keywords: { label: "キーワードのみ", order: 2 },
    weak: { label: "データ少", order: 3 }
  };
  const $ = (selector) => document.querySelector(selector);

  const state = {
    rawTeachers: [],
    analysisData: null,
    mode: "department",
    colorMode: "similarity",
    rows: [],
    terms: [],
    matrix: [],
    coords: [],
    similarities: [],
    referenceId: "",
    selectedId: "",
    tokenizer: null,
    mapView: null,
    mapSize: { width: 900, height: 540 },
    activePointers: new Map(),
    dragStart: null,
    dragMoved: false,
    pendingPointIndex: null
  };

  function buildTeacherRows(teachers) {
    return teachers.map((teacher, index) => {
      const quality = teacher.cluster?.quality || "weak";
      const keywords = normalizeKeywords(keywordSource(teacher));
      const theme = teacher.source_text?.theme || "";
      const research = teacher.research || teacher.description || theme || teacher.cluster?.text || "";
      return {
        id: `teacher:${teacher.id || index}`,
        kind: "teacher",
        label: teacher.name || `教員 ${index + 1}`,
        shortLabel: teacher.name || `教員 ${index + 1}`,
        faculty: teacher.faculty || "",
        department: teacher.department || "",
        name: teacher.name || "",
        position: teacher.position || "",
        lab: teacher.lab || "",
        theme,
        description: research,
        keywords,
        text: joinUnique([teacher.lab, theme, teacher.research, teacher.description, teacher.source_text?.keywords_text]),
        quality,
        qualityCounts: { [quality]: 1 },
        warnings: teacher.cluster?.warnings || [],
        teacherCount: 1,
        profileUrl: teacher.profile_url || teacher.source_department_url || ""
      };
    });
  }

  function buildDepartmentRows(teachers) {
    const groups = new Map();
    teachers.forEach((teacher) => {
      if (!groups.has(teacher.department)) groups.set(teacher.department, []);
      groups.get(teacher.department).push(teacher);
    });

    return Array.from(groups, ([department, members]) => {
      const faculty = members.find((member) => member.faculty)?.faculty || "";
      const qualityCounts = countBy(members, (member) => member.cluster?.quality || "weak");
      const keywords = topKeywords(members.flatMap((member) => normalizeKeywords(keywordSource(member))), 12);
      const warnings = unique(members.flatMap((member) => member.cluster?.warnings || []));
      const representative = members.find((member) => member.cluster?.quality === "full" && (member.research || member.description))
        || members.find((member) => member.research || member.description || member.source_text?.theme)
        || members[0];
      const sampleTexts = members
        .map((member) => member.research || member.description || member.source_text?.theme || "")
        .filter(Boolean)
        .slice(0, 3);
      return {
        id: `department:${department}`,
        kind: "department",
        label: department,
        shortLabel: department,
        faculty,
        department,
        name: "",
        position: "",
        lab: "",
        theme: keywords.join(" / "),
        description: sampleTexts.length
          ? `教員${members.length}人の研究紹介を集約しています。例: ${sampleTexts.join(" ")}`
          : `教員${members.length}人の研究キーワードを集約しています。`,
        keywords,
        text: joinUnique(members.map((member) => member.cluster?.text || "")),
        quality: aggregateQuality(qualityCounts, members.length),
        qualityCounts,
        warnings,
        teacherCount: members.length,
        profileUrl: representative?.source_department_url || representative?.profile_url || "",
        teachers: members
      };
    });
  }

  function normalizeKeywords(value) {
    const items = Array.isArray(value) ? value : String(value).split(/\s*(?:\/|、|，|,|・|\n)\s*/);
    return unique(items.map((item) => cleanText(item)).filter((item) => item.length >= 2));
  }

  function keywordSource(teacher) {
    return Array.isArray(teacher.keywords) && teacher.keywords.length ? teacher.keywords : teacher.source_text?.keywords_text || "";
  }

  function topKeywords(keywords, limit) {
    const counts = new Map();
    keywords.forEach((keyword) => counts.set(keyword, (counts.get(keyword) || 0) + 1));
    return Array.from(counts, ([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword, "ja"))
      .slice(0, limit)
      .map((item) => item.keyword);
  }

  function aggregateQuality(counts, total) {
    if ((counts.weak || 0) / total >= 0.5) return "weak";
    if ((counts.full || 0) / total >= 0.5) return "full";
    if (((counts.full || 0) + (counts.summary || 0)) / total >= 0.5) return "summary";
    return "keywords";
  }

  function vectorize(rows) {
    const docs = rows.map((row) => tokenize(row));
    const frequencies = [];
    const documentFrequency = new Map();
    const totalFrequency = new Map();

    docs.forEach((tokens) => {
      const counts = new Map();
      tokens.forEach((token) => {
        counts.set(token, (counts.get(token) || 0) + 1);
        totalFrequency.set(token, (totalFrequency.get(token) || 0) + 1);
      });
      counts.forEach((_, token) => documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1));
      frequencies.push(counts);
    });

    const docCount = rows.length;
    let terms = Array.from(documentFrequency, ([term, df]) => {
      const idf = Math.log((docCount + 1) / (df + 1)) + 1;
      const score = Math.log((totalFrequency.get(term) || 0) + 1) * idf;
      return { term, df, score };
    })
      .filter((item) => item.df <= Math.max(1, docCount * 0.85))
      .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term, "ja"))
      .slice(0, MAX_TERMS)
      .map((item) => item.term);

    if (!terms.length) terms = ["データ"];

    const vocab = new Map(terms.map((term, index) => [term, index]));
    const matrix = frequencies.map((counts) => {
      const vector = Array(terms.length).fill(0);
      let total = 0;
      counts.forEach((count, term) => {
        if (vocab.has(term)) total += count;
      });
      counts.forEach((count, term) => {
        const index = vocab.get(term);
        if (index === undefined) return;
        const tf = count / (total || 1);
        const idf = Math.log((rows.length + 1) / ((documentFrequency.get(term) || 0) + 1)) + 1;
        vector[index] = tf * idf;
      });
      return normalize(vector);
    });

    return { terms, matrix };
  }

  function tokenize(row) {
    const tokens = [];
    const add = (term) => {
      const normalized = normalizeTerm(term);
      if (!normalized || isStopTerm(normalized)) return;
      tokens.push(normalized);
    };

    const text = normalizeForTokenize(row.text);
    for (const match of text.matchAll(/[a-z][a-z0-9+#._-]{1,}/g)) add(match[0]);
    if (state.tokenizer) {
      tokenizeJapaneseText(text).forEach((token) => add(token));
      return tokens.length ? tokens : ["データ"];
    }

    for (const match of text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〤]{2,}/gu)) {
      const segment = match[0];
      if (segment.length <= 8) add(segment);
      for (let n = 2; n <= 3; n += 1) {
        for (let i = 0; i <= segment.length - n; i += 1) add(segment.slice(i, i + n));
      }
    }
    return tokens.length ? tokens : ["データ"];
  }

  function normalizeForTokenize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[\u3000\s]+/g, " ");
  }

  function tokenizeJapaneseText(text) {
    return state.tokenizer.tokenize(text)
      .filter((token) => isUsefulJapaneseToken(token))
      .map((token) => token.basic_form && token.basic_form !== "*" ? token.basic_form : token.surface_form);
  }

  function isUsefulJapaneseToken(token) {
    if (token.pos !== "名詞") return false;
    if (["非自立", "接尾", "数", "代名詞"].includes(token.pos_detail_1)) return false;
    return true;
  }

  function normalizeTerm(value) {
    return cleanText(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  }

  function isStopTerm(term) {
    if (term.length < 2) return true;
    if (/^[0-9.%-]+$/.test(term)) return true;
    return false;
  }

  function normalize(vector) {
    let sum = 0;
    for (const value of vector) sum += value * value;
    const norm = Math.sqrt(sum) || 1;
    return vector.map((value) => value / norm);
  }

  function dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
    return sum;
  }

  function computeSimilarities(matrix) {
    return matrix.map((row) => matrix.map((other) => Math.max(0, Math.min(1, dot(row, other)))));
  }

  function projectPca2d(matrix) {
    const centered = centerColumns(matrix);
    const first = powerIterationForCovariance(centered);
    const deflated = centered.map((row) => {
      const score = dot(row, first.vector);
      return row.map((value, index) => value - score * first.vector[index]);
    });
    const second = powerIterationForCovariance(deflated);
    return centered.map((row) => [dot(row, first.vector), dot(row, second.vector)]);
  }

  function centerColumns(matrix) {
    const means = matrix[0].map((_, column) => average(matrix.map((row) => row[column])));
    return matrix.map((row) => row.map((value, column) => value - means[column]));
  }

  function powerIterationForCovariance(matrix) {
    let vector = normalize(Array.from({ length: matrix[0].length }, (_, index) => (index % 7) + 1));
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const projected = matrix.map((row) => dot(row, vector));
      const next = Array(vector.length).fill(0);
      matrix.forEach((row, rowIndex) => {
        row.forEach((value, column) => { next[column] += value * projected[rowIndex]; });
      });
      vector = normalize(next);
    }
    return { vector };
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function rebuildRows() {
    state.mapView = null;
    const precomputed = state.analysisData?.[state.mode];
    if (isValidAnalysis(precomputed)) {
      state.rows = precomputed.rows;
      state.terms = precomputed.terms;
      state.matrix = precomputed.matrix;
      state.coords = precomputed.coords;
      state.similarities = precomputed.similarities;
      populateSelect();
      rerender();
      return;
    }

    state.rows = state.mode === "department" ? buildDepartmentRows(state.rawTeachers) : buildTeacherRows(state.rawTeachers);
    const { terms, matrix } = vectorize(state.rows);
    state.terms = terms;
    state.matrix = matrix;
    state.coords = projectPca2d(matrix);
    state.similarities = computeSimilarities(matrix);
    populateSelect();
    rerender();
  }

  function rerender() {
    renderMetrics();
    renderScatter();
    renderSidePanel();
    renderDetails();
    renderDataTable();
  }

  function populateSelect() {
    const select = $("#departmentSelect");
    const previous = state.referenceId;
    const preferred = state.mode === "department"
      ? state.rows.find((row) => row.department === TARGET_DEPARTMENT)
      : state.rows.find((row) => row.department === TARGET_DEPARTMENT);
    if (!state.rows.some((row) => row.id === previous)) state.referenceId = preferred?.id || state.rows[0]?.id || "";
    if (!state.rows.some((row) => row.id === state.selectedId)) state.selectedId = state.referenceId;

    select.innerHTML = state.rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(optionLabel(row))}</option>`).join("");
    select.value = state.referenceId;
    $("#selectLabel").textContent = state.mode === "department" ? "基準にする学科" : "基準にする教員・研究室";
  }

  function optionLabel(row) {
    if (row.kind === "department") return row.department;
    return `${row.name}（${row.department}）`;
  }

  function referenceIndex() {
    return Math.max(0, state.rows.findIndex((row) => row.id === state.referenceId));
  }

  function selectedIndex() {
    return Math.max(0, state.rows.findIndex((row) => row.id === state.selectedId));
  }

  function renderMetrics() {
    const ref = referenceIndex();
    const nearest = nearestRows(ref, 1)[0];
    $("#countMetricLabel").textContent = state.mode === "department" ? "学科数" : "教員数";
    $("#departmentCount").textContent = state.rows.length;
    $("#metricReference").textContent = shortMetricText(state.rows[ref]?.label || "-");
    $("#metricNearest").textContent = nearest ? shortMetricText(nearest.label) : "-";
    $("#qualitySummary").textContent = qualitySummary(state.rows);
    $("#selectedBadge").textContent = state.rows[ref]?.label || "";
  }

  function shortMetricText(value) {
    return value.length > 12 ? `${value.slice(0, 12)}...` : value;
  }

  function renderScatter() {
    const width = 900;
    const height = state.mode === "department" ? 540 : 600;
    state.mapSize = { width, height };
    if (!state.mapView) resetMapView();
    const padding = 72;
    const xs = state.coords.map((coord) => coord[0]);
    const ys = state.coords.map((coord) => coord[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const sx = (value) => padding + ((value - minX) / (maxX - minX || 1)) * (width - padding * 2);
    const sy = (value) => height - padding - ((value - minY) / (maxY - minY || 1)) * (height - padding * 2);
    const ref = referenceIndex();
    const selected = selectedIndex();
    const labeled = labeledIndices(ref, selected);
    const scores = state.similarities[ref] || [];
    const facultyColors = colorMap(state.rows.map((row) => state.mode === "department" ? row.faculty : row.department));

    const points = state.rows.map((row, index) => {
      const x = sx(state.coords[index][0]);
      const y = sy(state.coords[index][1]);
      const isReference = index === ref;
      const isSelected = index === selected;
      const color = state.colorMode === "similarity"
        ? similarityColor(scores[index] || 0)
        : facultyColors.get(state.mode === "department" ? row.faculty : row.department);
      const radius = pointRadius(row, isReference, isSelected);
      const label = labeled.has(index) ? `<text class="point-label ${state.mode === "teacher" ? "teacher-label" : ""}" x="${x + 10}" y="${y - 10}">${escapeHtml(row.shortLabel)}</text>` : "";
      return `
        <g tabindex="0" role="button" aria-label="${escapeHtml(row.label)}を選択" data-index="${index}">
          <title>${escapeHtml(rowTitle(row, scores[index] || 0))}</title>
          <circle class="point ${isReference ? "selected" : ""} ${isSelected && !isReference ? "focused" : ""} ${row.quality === "weak" ? "weak-point" : ""}" cx="${x}" cy="${y}" r="${radius}" fill="${color}"></circle>
          ${label}
        </g>`;
    }).join("");

    $("#scatterPlot").innerHTML = `
      <svg viewBox="${viewBoxValue()}" aria-hidden="true">
        <line class="axis-line" x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}"></line>
        <line class="axis-line" x1="${width / 2}" y1="${padding}" x2="${width / 2}" y2="${height - padding}"></line>
        ${points}
      </svg>
      <p class="gesture-hint" aria-live="polite">2本指でスクロール・拡大縮小できます</p>`;
    bindMapPan();
    document.querySelectorAll("#scatterPlot [data-index]").forEach((node) => {
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") selectRow(Number(node.dataset.index));
      });
    });
  }

  function resetMapView() {
    state.mapView = { x: 0, y: 0, width: state.mapSize.width, height: state.mapSize.height };
    updateMapViewBox();
  }

  function viewBoxValue() {
    const view = state.mapView || { x: 0, y: 0, width: state.mapSize.width, height: state.mapSize.height };
    return `${view.x} ${view.y} ${view.width} ${view.height}`;
  }

  function updateMapViewBox() {
    const svg = $("#scatterPlot svg");
    if (svg) svg.setAttribute("viewBox", viewBoxValue());
  }

  function zoomMap(factor) {
    const view = state.mapView;
    if (!view) return;
    const nextWidth = clamp(view.width * factor, state.mapSize.width / 5, state.mapSize.width);
    const nextHeight = clamp(view.height * factor, state.mapSize.height / 5, state.mapSize.height);
    const centerX = view.x + view.width / 2;
    const centerY = view.y + view.height / 2;
    state.mapView = boundedView({
      x: centerX - nextWidth / 2,
      y: centerY - nextHeight / 2,
      width: nextWidth,
      height: nextHeight
    });
    updateMapViewBox();
  }

  function zoomMapAt(factor, clientX, clientY, plot) {
    const view = state.mapView;
    const rect = plot?.getBoundingClientRect();
    if (!view || !rect?.width || !rect.height) return;
    const nextWidth = clamp(view.width * factor, state.mapSize.width / 5, state.mapSize.width);
    const nextHeight = clamp(view.height * factor, state.mapSize.height / 5, state.mapSize.height);
    const ratioX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((clientY - rect.top) / rect.height, 0, 1);
    const focusX = view.x + view.width * ratioX;
    const focusY = view.y + view.height * ratioY;
    state.mapView = boundedView({
      x: focusX - nextWidth * ratioX,
      y: focusY - nextHeight * ratioY,
      width: nextWidth,
      height: nextHeight
    });
    updateMapViewBox();
  }

  function panMap(deltaClientX, deltaClientY, plot) {
    const view = state.mapView;
    if (!view || !plot) return;
    const rect = plot.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    state.mapView = boundedView({
      ...view,
      x: view.x - deltaClientX * (view.width / rect.width),
      y: view.y - deltaClientY * (view.height / rect.height)
    });
    updateMapViewBox();
  }

  function boundedView(view) {
    const maxX = Math.max(0, state.mapSize.width - view.width);
    const maxY = Math.max(0, state.mapSize.height - view.height);
    return {
      ...view,
      x: clamp(view.x, 0, maxX),
      y: clamp(view.y, 0, maxY)
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function bindMapPan() {
    const plot = $("#scatterPlot");
    if (!plot || plot.dataset.panBound === "true") return;
    plot.dataset.panBound = "true";
    let pinchStart = null;
    const updateGestureHint = (touches) => plot.classList.toggle("show-gesture-hint", touches === 1);
    plot.addEventListener("touchstart", (event) => updateGestureHint(event.touches.length), { passive: true });
    plot.addEventListener("touchmove", (event) => updateGestureHint(event.touches.length), { passive: true });
    plot.addEventListener("touchend", (event) => updateGestureHint(event.touches.length), { passive: true });
    plot.addEventListener("touchcancel", () => updateGestureHint(0), { passive: true });
    plot.addEventListener("pointerdown", (event) => {
      const target = event.target.closest?.("[data-index]");
      state.pendingPointIndex = target ? Number(target.dataset.index) : null;
      state.dragMoved = false;
      state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
      const pointers = Array.from(state.activePointers.values());
      if (event.pointerType === "touch" && pointers.length >= 2) {
        state.pendingPointIndex = null;
        state.dragMoved = true;
        pinchStart = mapPointerMetrics(pointers);
      }
      if (event.pointerType !== "touch" || pointers.length === 2) {
        plot.setPointerCapture?.(event.pointerId);
        state.dragStart = mapPointerCenter(pointers);
      }
    });
    plot.addEventListener("pointermove", (event) => {
      if (!state.activePointers.has(event.pointerId)) return;
      state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
      const pointers = Array.from(state.activePointers.values());
      const canDrag = event.pointerType !== "touch" || pointers.length >= 2;
      if (!canDrag) return;
      event.preventDefault();
      const center = mapPointerCenter(pointers);
      if (!state.dragStart) state.dragStart = center;
      if (event.pointerType === "touch" && pointers.length >= 2) {
        const pinch = mapPointerMetrics(pointers);
        if (pinchStart) zoomMapAt(pinchStart.distance / pinch.distance, pinchStart.center.x, pinchStart.center.y, plot);
        pinchStart = pinch;
      }
      const deltaX = center.x - state.dragStart.x;
      const deltaY = center.y - state.dragStart.y;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) state.dragMoved = true;
      panMap(deltaX, deltaY, plot);
      state.dragStart = center;
    }, { passive: false });
    plot.addEventListener("pointerup", (event) => {
      const wasSingleTouch = event.pointerType === "touch" && state.activePointers.size === 1;
      const canSelect = state.pendingPointIndex !== null && !state.dragMoved && (event.pointerType !== "touch" || wasSingleTouch);
      state.activePointers.delete(event.pointerId);
      state.dragStart = null;
      pinchStart = state.activePointers.size >= 2 ? mapPointerMetrics(Array.from(state.activePointers.values())) : null;
      if (canSelect) selectRow(state.pendingPointIndex);
      state.pendingPointIndex = null;
      state.dragMoved = false;
    });
    ["pointercancel", "pointerleave"].forEach((type) => {
      plot.addEventListener(type, (event) => {
        state.activePointers.delete(event.pointerId);
        state.dragStart = null;
        pinchStart = null;
        state.pendingPointIndex = null;
        state.dragMoved = false;
      });
    });
  }

  function mapPointerCenter(pointers) {
    const total = pointers.reduce((sum, pointer) => ({ x: sum.x + pointer.x, y: sum.y + pointer.y }), { x: 0, y: 0 });
    return { x: total.x / pointers.length, y: total.y / pointers.length };
  }

  function mapPointerMetrics(pointers) {
    const [first, second] = pointers;
    return {
      center: mapPointerCenter([first, second]),
      distance: Math.hypot(second.x - first.x, second.y - first.y) || 1
    };
  }

  async function toggleMapFullscreen() {
    const card = $("#mapCard");
    if (!card) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }
    if (document.fullscreenEnabled && card.requestFullscreen) {
      await card.requestFullscreen();
      return;
    }
    card.classList.toggle("is-map-expanded");
    document.body.classList.toggle("map-expanded", card.classList.contains("is-map-expanded"));
    updateFullscreenButton();
  }

  function updateFullscreenButton() {
    const button = $("#mapFullscreenButton");
    const card = $("#mapCard");
    if (!button || !card) return;
    const expanded = Boolean(document.fullscreenElement) || card.classList.contains("is-map-expanded");
    button.textContent = expanded ? "閉じる" : "全画面";
  }

  function similarityColor(score) {
    const hue = 205 - Math.round(score * 185);
    const light = 68 - Math.round(score * 20);
    return `hsl(${hue} 82% ${light}%)`;
  }

  function colorMap(values) {
    const keys = unique(values.filter(Boolean));
    return new Map(keys.map((key, index) => [key, COLORS[index % COLORS.length]]));
  }

  function pointRadius(row, isReference, isSelected) {
    if (state.mode === "department") return isReference ? 12 : isSelected ? 10 : 7 + Math.min(7, row.teacherCount / 2);
    return isReference ? 8 : isSelected ? 7 : 4.8;
  }

  function labeledIndices(ref, selected) {
    if (state.mode === "department") return new Set(state.rows.map((_, index) => index));
    return new Set([ref, selected, ...nearestRows(ref, 10).map((item) => item.index)]);
  }

  function renderSidePanel() {
    const ref = referenceIndex();
    const selected = selectedIndex();
    const row = state.rows[selected];
    $("#similarTitle").textContent = `${state.rows[ref].label}に近い${state.mode === "department" ? "学科" : "教員・研究室"}`;
    $("#similarList").innerHTML = nearestRows(ref, state.mode === "department" ? 5 : 6).map((item) => rankItem(item, item.similarity)).join("");
    $("#selectedDepartmentName").textContent = row.label;
    $("#selectedFaculty").textContent = metadataLine(row);
    $("#selectedDescription").textContent = row.description || "研究本文が短いため、主にキーワードや研究室名で計算しています。";
    $("#selectedBadges").innerHTML = qualityBadges(row);
    $("#selectedKeywords").innerHTML = row.keywords.length ? row.keywords.slice(0, 10).map((keyword) => `<span>${escapeHtml(keyword)}</span>`).join("") : "<span>キーワードなし</span>";
    const link = $("#profileLink");
    link.hidden = !row.profileUrl;
    if (row.profileUrl) link.href = row.profileUrl;

    $("#memberTitle").textContent = state.mode === "department" ? "所属教員・研究室" : "所属学科と近い学科";
    $("#clusterMemberList").innerHTML = state.mode === "department" ? departmentTeacherItems(row) : teacherRouteItems(row);
    document.querySelectorAll("#similarList [data-index], #clusterMemberList [data-index]").forEach((node) => {
      node.addEventListener("click", () => selectRow(Number(node.dataset.index)));
    });
  }

  function nearestRows(index, limit) {
    const scores = state.similarities[index] || [];
    return state.rows
      .map((item, i) => ({ ...item, index: i, similarity: scores[i] || 0 }))
      .filter((item) => item.index !== index)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  function rankItem(item, score) {
    const percent = Math.round(score * 100);
    return `
      <button class="rank-item" type="button" data-index="${item.index}">
        <div class="rank-head"><strong>${escapeHtml(item.label)}</strong><span>${percent}%</span></div>
        <small>${escapeHtml(metadataLine(item))}</small>
        <div class="progress-track"><i style="width: ${percent}%"></i></div>
      </button>`;
  }

  function departmentTeacherItems(row) {
    return (row.teachers || []).slice(0, 8).map((teacher) => `
      <a class="compact-item" href="${escapeHtml(teacher.profile_url || teacher.source_department_url || "#")}" target="_blank" rel="noopener">
        <strong>${escapeHtml(teacher.name || "教員")}</strong>
        <span>${escapeHtml(teacher.lab || teacher.position || "研究室")}</span>
      </a>
    `).join("") || "<p class=\"muted-text\">教員データがありません。</p>";
  }

  function teacherRouteItems(row) {
    const departmentIndex = state.rows.findIndex((item) => item.department === row.department && item.id !== row.id);
    const departmentLabel = `<div class="compact-item"><strong>${escapeHtml(row.department)}</strong><span>所属学科</span></div>`;
    const near = nearestRows(selectedIndex(), 6)
      .filter((item) => item.department !== row.department)
      .map((item) => `<button class="compact-item" type="button" data-index="${item.index}"><strong>${escapeHtml(item.label)}</strong><span>${Math.round(item.similarity * 100)}%</span></button>`)
      .join("");
    return departmentLabel + (departmentIndex >= 0 ? "" : "") + near;
  }

  function renderDetails() {
    const ref = referenceIndex();
    const selected = selectedIndex();
    $("#termList").innerHTML = [ref, selected].filter((value, index, array) => array.indexOf(value) === index).map((index) => `
      <div class="term-item">
        <h4>${escapeHtml(state.rows[index].label)}</h4>
        <p>${escapeHtml(topTermsForRow(index, 14).join(" / ") || "特徴語がありません")}</p>
      </div>
    `).join("");

    const comparison = compareTerms(ref, selected, 10);
    $("#comparisonTitle").textContent = `${state.rows[ref].label}と${state.rows[selected].label}の比較`;
    $("#comparisonList").innerHTML = [
      comparisonBlock("共通して多い語", comparison.common),
      comparisonBlock(`${state.rows[ref].shortLabel}らしい語`, comparison.reference),
      comparisonBlock(`${state.rows[selected].shortLabel}らしい語`, comparison.selected)
    ].join("");
  }

  function topTermsForRow(rowIndex, limit) {
    return state.matrix[rowIndex]
      .map((value, index) => ({ term: state.terms[index], value }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .map((item) => item.term);
  }

  function compareTerms(referenceIndexValue, selectedIndexValue, limit) {
    const reference = state.matrix[referenceIndexValue];
    const selected = state.matrix[selectedIndexValue];
    const items = state.terms.map((term, index) => ({
      term,
      reference: reference[index] || 0,
      selected: selected[index] || 0
    }));
    return {
      common: items
        .filter((item) => item.reference > 0 && item.selected > 0)
        .sort((a, b) => (b.reference + b.selected) - (a.reference + a.selected))
        .slice(0, limit)
        .map((item) => item.term),
      reference: items
        .filter((item) => item.reference > 0)
        .sort((a, b) => (b.reference - b.selected) - (a.reference - a.selected))
        .slice(0, limit)
        .map((item) => item.term),
      selected: items
        .filter((item) => item.selected > 0)
        .sort((a, b) => (b.selected - b.reference) - (a.selected - a.reference))
        .slice(0, limit)
        .map((item) => item.term)
    };
  }

  function comparisonBlock(title, terms) {
    return `
      <div class="comparison-item">
        <h4>${escapeHtml(title)}</h4>
        <p>${escapeHtml(terms.length ? terms.join(" / ") : "共通する特徴語が少ないです")}</p>
      </div>`;
  }

  function renderDataTable() {
    const head = $("#dataHead");
    const body = $("#dataBody");
    if (!head || !body) return;
    const ref = referenceIndex();
    const scores = state.similarities[ref] || [];
    if (state.mode === "department") {
      head.innerHTML = "<tr><th>学部</th><th>学科</th><th>教員数</th><th>類似度</th><th>品質</th><th>代表キーワード</th></tr>";
      body.innerHTML = state.rows.map((row, index) => `
        <tr>
          <td>${escapeHtml(row.faculty)}</td>
          <td><strong>${escapeHtml(row.department)}</strong></td>
          <td>${row.teacherCount}</td>
          <td>${Math.round((scores[index] || 0) * 100)}%</td>
          <td>${qualityBadges(row)}</td>
          <td>${escapeHtml(row.keywords.slice(0, 8).join(" / "))}</td>
        </tr>`).join("");
      return;
    }

    head.innerHTML = "<tr><th>学科</th><th>教員</th><th>研究室</th><th>類似度</th><th>品質</th><th>キーワード</th></tr>";
    body.innerHTML = state.rows.map((row, index) => `
      <tr>
        <td>${escapeHtml(row.department)}</td>
        <td><strong>${escapeHtml(row.name)}</strong><br><span class="muted-cell">${escapeHtml(row.position)}</span></td>
        <td>${escapeHtml(row.lab)}</td>
        <td>${Math.round((scores[index] || 0) * 100)}%</td>
        <td>${qualityBadges(row)}</td>
        <td>${escapeHtml(row.keywords.slice(0, 6).join(" / "))}</td>
      </tr>`).join("");
  }

  function selectRow(index) {
    state.selectedId = state.rows[index].id;
    renderMetrics();
    renderScatter();
    renderSidePanel();
    renderDetails();
  }

  function rowTitle(row, similarity) {
    const percent = Math.round(similarity * 100);
    return row.kind === "department"
      ? `${row.department} / 類似度${percent}% / 教員${row.teacherCount}人 / ${qualityText(row)}`
      : `${row.name} / 類似度${percent}% / ${row.department} / ${row.lab || row.position} / ${qualityText(row)}`;
  }

  function metadataLine(row) {
    if (row.kind === "department") return `${row.faculty} / 教員${row.teacherCount}人 / ${qualityText(row)}`;
    return [row.department, row.position, row.lab].filter(Boolean).join(" / ");
  }

  function qualityText(row) {
    if (row.kind === "teacher") return QUALITY[row.quality]?.label || row.quality;
    return Object.entries(row.qualityCounts)
      .sort((a, b) => (QUALITY[a[0]]?.order ?? 9) - (QUALITY[b[0]]?.order ?? 9))
      .map(([quality, count]) => `${QUALITY[quality]?.label || quality}${count}`)
      .join(" / ");
  }

  function qualityBadges(row) {
    const entries = row.kind === "teacher" ? [[row.quality, 1]] : Object.entries(row.qualityCounts);
    const badges = entries
      .sort((a, b) => (QUALITY[a[0]]?.order ?? 9) - (QUALITY[b[0]]?.order ?? 9))
      .map(([quality, count]) => `<span class="quality-badge quality-${escapeHtml(quality)}">${escapeHtml(QUALITY[quality]?.label || quality)}${row.kind === "department" ? ` ${count}` : ""}</span>`);
    if (row.warnings.length) badges.push(`<span class="quality-badge quality-warning">注意 ${row.warnings.length}</span>`);
    return badges.join("");
  }

  function qualitySummary(rows) {
    const counts = rows.reduce((summary, row) => {
      if (row.kind === "teacher") {
        summary[row.quality] = (summary[row.quality] || 0) + 1;
      } else {
        Object.entries(row.qualityCounts).forEach(([quality, count]) => {
          summary[quality] = (summary[quality] || 0) + count;
        });
      }
      return summary;
    }, {});
    return ["full", "summary", "keywords", "weak"]
      .filter((quality) => counts[quality])
      .map((quality) => `${QUALITY[quality].label}${counts[quality]}`)
      .join(" / ");
  }

  function bindEvents() {
    $("#mapFullscreenButton")?.addEventListener("click", () => {
      toggleMapFullscreen().catch(console.error);
    });
    $("#mapZoomInButton")?.addEventListener("click", () => zoomMap(0.78));
    $("#mapZoomOutButton")?.addEventListener("click", () => zoomMap(1.28));
    $("#mapResetButton")?.addEventListener("click", resetMapView);
    document.addEventListener("fullscreenchange", updateFullscreenButton);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const card = $("#mapCard");
      if (!card?.classList.contains("is-map-expanded")) return;
      card.classList.remove("is-map-expanded");
      document.body.classList.remove("map-expanded");
      updateFullscreenButton();
    });
    document.querySelectorAll('input[name="analysisMode"]').forEach((radio) => {
      radio.addEventListener("change", (event) => {
        state.mode = event.target.value;
        state.referenceId = "";
        state.selectedId = "";
        rebuildRows();
      });
    });
    document.querySelectorAll('input[name="colorMode"]').forEach((radio) => {
      radio.addEventListener("change", (event) => {
        state.colorMode = event.target.value;
        renderScatter();
      });
    });
    $("#departmentSelect").addEventListener("change", (event) => {
      state.referenceId = event.target.value;
      state.selectedId = event.target.value;
      rerender();
    });
    document.querySelectorAll('a[href^="#"]:not(#profileLink)').forEach((anchor) => {
      anchor.addEventListener("click", (event) => {
        const target = document.querySelector(anchor.getAttribute("href"));
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  async function init() {
    state.analysisData = await loadPrecomputedAnalysis();
    if (state.analysisData) {
      bindEvents();
      rebuildRows();
      return;
    }

    const [response, tokenizer] = await Promise.all([
      fetch("../data/teachers.json"),
      loadKuromoji()
    ]);
    if (!response.ok) throw new Error(`teachers.json load failed: ${response.status}`);
    state.rawTeachers = await response.json();
    state.tokenizer = tokenizer;
    bindEvents();
    rebuildRows();
  }

  async function loadPrecomputedAnalysis() {
    try {
      const response = await fetch(ANALYSIS_DATA_URL);
      if (!response.ok) return null;
      const analysis = await response.json();
      return isValidAnalysis(analysis.department) && isValidAnalysis(analysis.teacher) ? analysis : null;
    } catch (_) {
      return null;
    }
  }

  function isValidAnalysis(analysis) {
    return Boolean(
      analysis
      && Array.isArray(analysis.rows)
      && Array.isArray(analysis.terms)
      && Array.isArray(analysis.matrix)
      && Array.isArray(analysis.coords)
      && Array.isArray(analysis.similarities)
    );
  }

  async function loadKuromoji() {
    try {
      await loadScript(KUROMOJI_SCRIPT_URL);
      if (!window.kuromoji) return null;
      return await new Promise((resolve) => {
        window.kuromoji.builder({ dicPath: KUROMOJI_DICT_PATH }).build((error, tokenizer) => {
          resolve(error ? null : tokenizer);
        });
      });
    } catch (_) {
      return null;
    }
  }

  function loadScript(src) {
    if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function joinUnique(values) {
    return unique(values.map((value) => cleanText(value)).filter(Boolean)).join(" ");
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function countBy(values, fn) {
    return values.reduce((counts, value) => {
      const key = fn(value);
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  init().catch((error) => {
    $("#scatterPlot").textContent = "データを読み込めませんでした。ローカルファイルとして開いた場合は、簡易サーバー経由で確認してください。";
    console.error(error);
  });
})();
