(() => {
  "use strict";

  const TARGET_DEPARTMENT = "高度応用情報科学科";
  const COLORS = ["#ff6b35", "#15284c", "#20c4d9", "#dff23a", "#7d5fff", "#00a676", "#f0a202", "#d7263d", "#6f42c1", "#008c7a"];
  const MAX_TERMS = 1400;
  const STOP_TERMS = new Set([
    "研究", "工学", "技術", "学科", "大学", "千葉", "教授", "准教", "助教", "学生", "教育", "分野", "方法", "目的",
    "ため", "こと", "もの", "これ", "それ", "およ", "また", "など", "ます", "です", "する", "して", "から", "まで", "より"
  ]);
  const QUALITY = {
    full: { label: "本文あり", order: 0 },
    summary: { label: "短文", order: 1 },
    keywords: { label: "キーワード中心", order: 2 },
    weak: { label: "弱い", order: 3 }
  };
  const $ = (selector) => document.querySelector(selector);

  const state = {
    rawTeachers: [],
    mode: "department",
    rows: [],
    terms: [],
    matrix: [],
    coords: [],
    clusters: [],
    similarities: [],
    distances: [],
    nClusters: 5,
    method: "kmeans",
    selectedId: ""
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
        text: teacher.cluster?.text || joinUnique([teacher.lab, theme, teacher.research, teacher.description, teacher.source_text?.keywords_text]),
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
    const keywordTerms = new Set();
    const docs = rows.map((row) => tokenize(row, keywordTerms));
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
      const keywordBoost = keywordTerms.has(term) ? 2.8 : 1;
      const commonPenalty = df > docCount * 0.55 ? 0.35 : 1;
      const score = Math.log((totalFrequency.get(term) || 0) + 1) * idf * keywordBoost * commonPenalty;
      return { term, df, score };
    })
      .filter((item) => item.df <= Math.max(1, docCount * 0.85) || keywordTerms.has(item.term))
      .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term, "ja"))
      .slice(0, MAX_TERMS)
      .map((item) => item.term);

    if (!terms.length) terms = ["データ"];

    const vocab = new Map(terms.map((term, index) => [term, index]));
    const matrix = frequencies.map((counts) => {
      const vector = Array(terms.length).fill(0);
      let total = 0;
      counts.forEach((count, term) => {
        if (!vocab.has(term)) return;
        total += count;
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

  function tokenize(row, keywordTerms) {
    const tokens = [];
    const add = (term, weight = 1) => {
      const normalized = normalizeTerm(term);
      if (!normalized || isStopTerm(normalized)) return;
      for (let i = 0; i < weight; i += 1) tokens.push(normalized);
    };

    row.keywords.forEach((keyword) => {
      const normalized = normalizeTerm(keyword);
      if (!normalized || isStopTerm(normalized)) return;
      keywordTerms.add(normalized);
      add(normalized, 5);
    });

    const text = normalizeForTokenize(row.text);
    for (const match of text.matchAll(/[a-z][a-z0-9+#._-]{1,}/g)) add(match[0]);
    for (const match of text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〤]{2,}/gu)) {
      const segment = match[0];
      if (segment.length <= 8) add(segment, segment.length >= 4 ? 2 : 1);
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

  function normalizeTerm(value) {
    return cleanText(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  }

  function isStopTerm(term) {
    if (term.length < 2) return true;
    if (STOP_TERMS.has(term)) return true;
    if (/^[ぁ-んー]{2,3}$/.test(term)) return true;
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

  function distance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  function computeSimilarities(matrix) {
    return matrix.map((row) => matrix.map((other) => Math.max(0, Math.min(1, dot(row, other)))));
  }

  function computeDistances(matrix) {
    const distances = Array.from({ length: matrix.length }, () => Array(matrix.length).fill(0));
    for (let i = 0; i < matrix.length; i += 1) {
      for (let j = i + 1; j < matrix.length; j += 1) {
        const current = distance(matrix[i], matrix[j]);
        distances[i][j] = current;
        distances[j][i] = current;
      }
    }
    return distances;
  }

  function kmeans(matrix, k) {
    const centroids = initialCentroids(matrix, k);
    let labels = Array(matrix.length).fill(0);
    for (let iteration = 0; iteration < 60; iteration += 1) {
      let changed = false;
      labels = matrix.map((row, rowIndex) => {
        let best = 0;
        let bestDistance = Infinity;
        centroids.forEach((centroid, clusterIndex) => {
          const currentDistance = distance(row, centroid);
          if (currentDistance < bestDistance) {
            bestDistance = currentDistance;
            best = clusterIndex;
          }
        });
        if (best !== labels[rowIndex]) changed = true;
        return best;
      });

      const sums = Array.from({ length: k }, () => Array(matrix[0].length).fill(0));
      const counts = Array(k).fill(0);
      matrix.forEach((row, rowIndex) => {
        const label = labels[rowIndex];
        counts[label] += 1;
        row.forEach((value, index) => { sums[label][index] += value; });
      });
      centroids.forEach((_, clusterIndex) => {
        if (!counts[clusterIndex]) return;
        centroids[clusterIndex] = normalize(sums[clusterIndex].map((value) => value / counts[clusterIndex]));
      });
      if (!changed) break;
    }
    return labels;
  }

  function initialCentroids(matrix, k) {
    const chosen = [0];
    while (chosen.length < k) {
      let bestIndex = 0;
      let bestDistance = -1;
      matrix.forEach((row, index) => {
        if (chosen.includes(index)) return;
        const nearest = Math.min(...chosen.map((chosenIndex) => distance(row, matrix[chosenIndex])));
        if (nearest > bestDistance) {
          bestDistance = nearest;
          bestIndex = index;
        }
      });
      chosen.push(bestIndex);
    }
    return chosen.map((index) => matrix[index].slice());
  }

  function agglomerative(distances, k) {
    let groups = distances.map((_, index) => ({ members: [index], size: 1 }));
    let clusterDistances = distances.map((row) => row.slice());
    while (groups.length > k) {
      let bestPair = [0, 1];
      let bestDistance = Infinity;
      for (let i = 0; i < groups.length; i += 1) {
        for (let j = i + 1; j < groups.length; j += 1) {
          const current = clusterDistances[i][j];
          if (current < bestDistance) {
            bestDistance = current;
            bestPair = [i, j];
          }
        }
      }

      const [a, b] = bestPair;
      const merged = {
        members: groups[a].members.concat(groups[b].members),
        size: groups[a].size + groups[b].size
      };
      const keep = groups.map((_, index) => index).filter((index) => index !== a && index !== b);
      const nextGroups = keep.map((index) => groups[index]).concat(merged);
      const nextDistances = Array.from({ length: nextGroups.length }, () => Array(nextGroups.length).fill(0));

      for (let i = 0; i < keep.length; i += 1) {
        for (let j = i + 1; j < keep.length; j += 1) {
          nextDistances[i][j] = clusterDistances[keep[i]][keep[j]];
          nextDistances[j][i] = nextDistances[i][j];
        }
      }
      keep.forEach((oldIndex, newIndex) => {
        const distanceToMerged = (
          clusterDistances[a][oldIndex] * groups[a].size + clusterDistances[b][oldIndex] * groups[b].size
        ) / merged.size;
        const mergedIndex = nextGroups.length - 1;
        nextDistances[newIndex][mergedIndex] = distanceToMerged;
        nextDistances[mergedIndex][newIndex] = distanceToMerged;
      });

      groups = nextGroups;
      clusterDistances = nextDistances;
    }

    const labels = Array(distances.length).fill(0);
    groups.forEach((group, clusterIndex) => group.members.forEach((rowIndex) => { labels[rowIndex] = clusterIndex; }));
    return labels;
  }

  function project2d(matrix) {
    const similarities = computeSimilarities(matrix);
    const n = matrix.length;
    const centered = similarities.map((row) => row.slice());
    const rowMeans = centered.map((row) => average(row));
    const colMeans = centered[0].map((_, col) => average(centered.map((row) => row[col])));
    const allMean = average(rowMeans);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) centered[i][j] = centered[i][j] - rowMeans[i] - colMeans[j] + allMean;
    }

    const first = powerIteration(centered);
    const deflated = centered.map((row, i) => row.map((value, j) => value - first.value * first.vector[i] * first.vector[j]));
    const second = powerIteration(deflated);
    return matrix.map((_, index) => [first.vector[index] * Math.sqrt(Math.abs(first.value)), second.vector[index] * Math.sqrt(Math.abs(second.value))]);
  }

  function powerIteration(matrix) {
    let vector = normalize(Array.from({ length: matrix.length }, (_, index) => index + 1));
    for (let iteration = 0; iteration < 90; iteration += 1) {
      const next = normalize(matrix.map((row) => dot(row, vector)));
      vector = next;
    }
    const mv = matrix.map((row) => dot(row, vector));
    return { vector, value: dot(vector, mv) };
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function silhouetteScore(distances, labels) {
    const uniqueLabels = Array.from(new Set(labels));
    if (uniqueLabels.length <= 1 || uniqueLabels.length >= distances.length) return null;
    const scores = distances.map((rowDistances, index) => {
      const own = labels[index];
      const same = rowDistances.filter((_, i) => labels[i] === own && i !== index);
      const a = same.length ? average(same) : 0;
      const b = Math.min(...uniqueLabels.filter((label) => label !== own).map((label) => {
        const members = rowDistances.filter((_, i) => labels[i] === label);
        return average(members);
      }));
      return (b - a) / Math.max(a, b || 1);
    });
    return average(scores);
  }

  function topTerms(clusterId, limit = 10) {
    const indices = state.clusters.map((label, index) => label === clusterId ? index : -1).filter((index) => index >= 0);
    const means = Array(state.terms.length).fill(0);
    indices.forEach((rowIndex) => {
      state.matrix[rowIndex].forEach((value, termIndex) => { means[termIndex] += value; });
    });
    return means
      .map((value, index) => ({ term: state.terms[index], value: value / (indices.length || 1) }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .map((item) => item.term);
  }

  function rebuildRows() {
    state.rows = state.mode === "department" ? buildDepartmentRows(state.rawTeachers) : buildTeacherRows(state.rawTeachers);
    const maxClusters = Math.min(state.mode === "department" ? 8 : 10, Math.max(2, state.rows.length - 1));
    const clusterInput = $("#clusterCount");
    clusterInput.max = String(maxClusters);
    state.nClusters = clamp(state.nClusters, 2, maxClusters);
    clusterInput.value = String(state.nClusters);

    const { terms, matrix } = vectorize(state.rows);
    state.terms = terms;
    state.matrix = matrix;
    state.coords = project2d(matrix);
    state.similarities = computeSimilarities(matrix);
    state.distances = computeDistances(matrix);
    populateSelect();
    rerender();
  }

  function rerender() {
    const k = Math.min(state.nClusters, state.rows.length);
    state.clusters = state.method === "kmeans" ? kmeans(state.matrix, k) : agglomerative(state.distances, k);
    renderMetrics();
    renderScatter();
    renderSidePanel();
    renderClusterDetails();
    renderDataTable();
  }

  function populateSelect() {
    const select = $("#departmentSelect");
    const previous = state.selectedId;
    const preferred = state.mode === "department"
      ? state.rows.find((row) => row.department === TARGET_DEPARTMENT)
      : state.rows.find((row) => row.department === TARGET_DEPARTMENT);
    if (!state.rows.some((row) => row.id === previous)) state.selectedId = preferred?.id || state.rows[0]?.id || "";

    select.innerHTML = state.rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(optionLabel(row))}</option>`).join("");
    select.value = state.selectedId;
    $("#selectLabel").textContent = state.mode === "department" ? "近さを見る学科" : "近さを見る教員";
  }

  function optionLabel(row) {
    if (row.kind === "department") return row.department;
    return `${row.name}（${row.department}）`;
  }

  function selectedIndex() {
    return Math.max(0, state.rows.findIndex((row) => row.id === state.selectedId));
  }

  function renderMetrics() {
    const score = silhouetteScore(state.distances, state.clusters);
    $("#countMetricLabel").textContent = state.mode === "department" ? "学科数" : "教員数";
    $("#departmentCount").textContent = state.rows.length;
    $("#metricClusterCount").textContent = state.nClusters;
    $("#metricMethod").textContent = state.method === "kmeans" ? "KMeans" : "階層";
    $("#qualitySummary").textContent = qualitySummary(state.rows);
    $("#silhouetteScore").textContent = score === null ? "-" : score.toFixed(3);
    $("#clusterCountLabel").textContent = state.nClusters;
    $("#selectedBadge").textContent = selectedRow().label;
  }

  function renderScatter() {
    const width = 900;
    const height = state.mode === "department" ? 620 : 700;
    const padding = 72;
    const xs = state.coords.map((coord) => coord[0]);
    const ys = state.coords.map((coord) => coord[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const sx = (value) => padding + ((value - minX) / (maxX - minX || 1)) * (width - padding * 2);
    const sy = (value) => height - padding - ((value - minY) / (maxY - minY || 1)) * (height - padding * 2);
    const selected = selectedIndex();
    const labeled = labeledIndices(selected);
    const points = state.rows.map((row, index) => {
      const x = sx(state.coords[index][0]);
      const y = sy(state.coords[index][1]);
      const isSelected = index === selected;
      const color = COLORS[state.clusters[index] % COLORS.length];
      const radius = state.mode === "department" ? (isSelected ? 10 : 8) : (isSelected ? 8 : 4.8);
      const label = labeled.has(index) ? `<text class="point-label ${state.mode === "teacher" ? "teacher-label" : ""}" x="${x + 10}" y="${y - 10}">${escapeHtml(row.shortLabel)}</text>` : "";
      return `
        <g tabindex="0" role="button" aria-label="${escapeHtml(row.label)}を選択" data-index="${index}">
          <title>${escapeHtml(rowTitle(row))}</title>
          <circle class="point ${isSelected ? "selected" : ""} ${row.quality === "weak" ? "weak-point" : ""}" cx="${x}" cy="${y}" r="${radius}" fill="${color}"></circle>
          ${label}
        </g>`;
    }).join("");

    $("#scatterPlot").innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <line class="axis-line" x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}"></line>
        <line class="axis-line" x1="${width / 2}" y1="${padding}" x2="${width / 2}" y2="${height - padding}"></line>
        ${points}
      </svg>`;
    document.querySelectorAll("#scatterPlot [data-index]").forEach((node) => {
      node.addEventListener("click", () => selectRow(Number(node.dataset.index)));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") selectRow(Number(node.dataset.index));
      });
    });
  }

  function labeledIndices(selected) {
    if (state.mode === "department") return new Set(state.rows.map((_, index) => index));
    const scores = state.similarities[selected] || [];
    const close = state.rows
      .map((_, index) => ({ index, score: scores[index] || 0 }))
      .filter((item) => item.index !== selected)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((item) => item.index);
    return new Set([selected, ...close]);
  }

  function renderSidePanel() {
    const index = selectedIndex();
    const row = state.rows[index];
    const scores = state.similarities[index];
    const similar = state.rows
      .map((item, i) => ({ ...item, index: i, similarity: scores[i] }))
      .filter((item) => item.index !== index)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, state.mode === "department" ? 8 : 10);

    $("#similarTitle").textContent = `${row.label}に近い${state.mode === "department" ? "学科" : "教員"}`;
    $("#similarList").innerHTML = similar.map((item) => rankItem(item, item.similarity)).join("");
    $("#selectedDepartmentName").textContent = row.label;
    $("#selectedFaculty").textContent = metadataLine(row);
    $("#selectedDescription").textContent = row.description || "研究本文が短いため、主にキーワードや研究室名で計算しています。";
    $("#selectedBadges").innerHTML = qualityBadges(row);
    $("#selectedKeywords").innerHTML = row.keywords.length ? row.keywords.slice(0, 10).map((keyword) => `<span>${escapeHtml(keyword)}</span>`).join("") : "<span>キーワードなし</span>";
    const link = $("#profileLink");
    link.hidden = !row.profileUrl;
    if (row.profileUrl) link.href = row.profileUrl;

    const cluster = state.clusters[index];
    const members = state.rows
      .map((item, i) => ({ ...item, index: i, similarity: scores[i] }))
      .filter((item) => state.clusters[item.index] === cluster)
      .sort((a, b) => b.similarity - a.similarity);
    $("#clusterMemberList").innerHTML = members.map((item) => `
      <button class="compact-item" type="button" data-index="${item.index}">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${Math.round(item.similarity * 100)}%</span>
      </button>
    `).join("");
    document.querySelectorAll("#clusterMemberList [data-index]").forEach((node) => {
      node.addEventListener("click", () => selectRow(Number(node.dataset.index)));
    });
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

  function renderClusterDetails() {
    const clusterIds = Array.from(new Set(state.clusters)).sort((a, b) => a - b);
    $("#termList").innerHTML = clusterIds.map((clusterId) => {
      const labels = state.rows.filter((_, index) => state.clusters[index] === clusterId).map((row) => row.shortLabel);
      const shown = labels.slice(0, 10).join("、");
      const suffix = labels.length > 10 ? ` ほか${labels.length - 10}件` : "";
      return `
        <div class="term-item">
          <h4>クラスタ ${clusterId}: ${escapeHtml(shown + suffix)}</h4>
          <p>${escapeHtml(topTerms(clusterId, 12).join(" / "))}</p>
        </div>`;
    }).join("");

    $("#summaryBody").innerHTML = clusterIds.map((clusterId) => {
      const indices = state.clusters.map((label, index) => label === clusterId ? index : -1).filter((index) => index >= 0);
      const labels = indices.map((index) => state.rows[index].shortLabel);
      const shown = labels.slice(0, 12).join("、");
      const suffix = labels.length > 12 ? ` ほか${labels.length - 12}件` : "";
      const avgSimilarity = averageInnerSimilarity(indices);
      return `<tr><td><strong>${clusterId}</strong></td><td>${indices.length}</td><td>${avgSimilarity.toFixed(3)}</td><td>${escapeHtml(shown + suffix)}</td></tr>`;
    }).join("");
  }

  function averageInnerSimilarity(indices) {
    if (indices.length <= 1) return 1;
    let total = 0;
    let count = 0;
    indices.forEach((i) => {
      indices.forEach((j) => {
        if (i >= j) return;
        total += state.similarities[i][j];
        count += 1;
      });
    });
    return total / count;
  }

  function renderDataTable() {
    if (state.mode === "department") {
      $("#dataHead").innerHTML = "<tr><th>学部</th><th>学科</th><th>教員数</th><th>品質</th><th>代表キーワード</th><th>クラスタ</th></tr>";
      $("#dataBody").innerHTML = state.rows.map((row, index) => `
        <tr>
          <td>${escapeHtml(row.faculty)}</td>
          <td><strong>${escapeHtml(row.department)}</strong></td>
          <td>${row.teacherCount}</td>
          <td>${qualityBadges(row)}</td>
          <td>${escapeHtml(row.keywords.slice(0, 8).join(" / "))}</td>
          <td>${state.clusters[index]}</td>
        </tr>`).join("");
      return;
    }

    $("#dataHead").innerHTML = "<tr><th>学科</th><th>教員</th><th>研究室</th><th>品質</th><th>キーワード</th><th>クラスタ</th></tr>";
    $("#dataBody").innerHTML = state.rows.map((row, index) => `
      <tr>
        <td>${escapeHtml(row.department)}</td>
        <td><strong>${escapeHtml(row.name)}</strong><br><span class="muted-cell">${escapeHtml(row.position)}</span></td>
        <td>${escapeHtml(row.lab)}</td>
        <td>${qualityBadges(row)}</td>
        <td>${escapeHtml(row.keywords.slice(0, 6).join(" / "))}</td>
        <td>${state.clusters[index]}</td>
      </tr>`).join("");
  }

  function selectRow(index) {
    state.selectedId = state.rows[index].id;
    $("#departmentSelect").value = state.selectedId;
    renderMetrics();
    renderScatter();
    renderSidePanel();
  }

  function selectedRow() {
    return state.rows[selectedIndex()] || state.rows[0] || { label: "" };
  }

  function rowTitle(row) {
    return row.kind === "department"
      ? `${row.department} / 教員${row.teacherCount}人 / ${qualityText(row)}`
      : `${row.name} / ${row.department} / ${row.lab || row.position} / ${qualityText(row)}`;
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
    const counts = countBy(rows, (row) => row.quality);
    return ["full", "summary", "keywords", "weak"]
      .filter((quality) => counts[quality])
      .map((quality) => `${QUALITY[quality].label}${counts[quality]}`)
      .join(" / ");
  }

  function bindEvents() {
    $("#clusterCount").addEventListener("input", (event) => {
      state.nClusters = Number(event.target.value);
      rerender();
    });
    document.querySelectorAll('input[name="method"]').forEach((radio) => {
      radio.addEventListener("change", (event) => {
        state.method = event.target.value;
        rerender();
      });
    });
    document.querySelectorAll('input[name="analysisMode"]').forEach((radio) => {
      radio.addEventListener("change", (event) => {
        state.mode = event.target.value;
        state.selectedId = "";
        rebuildRows();
      });
    });
    $("#departmentSelect").addEventListener("change", (event) => {
      state.selectedId = event.target.value;
      renderMetrics();
      renderScatter();
      renderSidePanel();
    });
    $("#similarList").addEventListener("click", (event) => {
      const item = event.target.closest("[data-index]");
      if (!item) return;
      selectRow(Number(item.dataset.index));
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
    const response = await fetch("../data/teachers.json");
    if (!response.ok) throw new Error(`teachers.json load failed: ${response.status}`);
    state.rawTeachers = await response.json();
    bindEvents();
    rebuildRows();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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
