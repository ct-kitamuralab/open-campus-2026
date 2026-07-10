(() => {
    "use strict";

    const QUALITY = {
        full: "本文あり",
        summary: "短文のみ",
        keywords: "キーワードのみ",
        weak: "データ少"
    };
    const $ = (selector) => document.querySelector(selector);

    async function init() {
        const response = await fetch("../data/teachers.json");
        if (!response.ok) throw new Error(`teachers.json load failed: ${response.status}`);
        const teachers = await response.json();
        renderSummary(teachers);
        renderTable(teachers);
    }

    function renderSummary(teachers) {
        const departments = new Set(teachers.map((teacher) => teacher.department).filter(Boolean));
        const counts = teachers.reduce((summary, teacher) => {
            const quality = teacher.cluster?.quality || "weak";
            summary[quality] = (summary[quality] || 0) + 1;
            return summary;
        }, {});
        const qualityText = Object.entries(QUALITY)
            .filter(([key]) => counts[key])
            .map(([key, label]) => `${label}${counts[key]}件`)
            .join(" / ");
        $("#sourceSummary").textContent = `${departments.size}学科、${teachers.length}件の教員データを掲載しています。${qualityText}`;
    }

    function renderTable(teachers) {
        $("#sourceDataHead").innerHTML = "<tr><th>学部</th><th>学科</th><th>教員</th><th>研究室・役職</th><th>品質</th><th>キーワード</th><th>公式ページ</th></tr>";
        $("#sourceDataBody").innerHTML = teachers.map((teacher) => {
            const quality = teacher.cluster?.quality || "weak";
            const keywords = normalizeKeywords(Array.isArray(teacher.keywords) && teacher.keywords.length ? teacher.keywords : teacher.source_text?.keywords_text || "");
            const url = teacher.profile_url || teacher.source_department_url || "";
            return `
        <tr>
          <td>${escapeHtml(teacher.faculty || "")}</td>
          <td><strong>${escapeHtml(teacher.department || "")}</strong></td>
          <td><strong>${escapeHtml(teacher.name || "")}</strong></td>
          <td>${escapeHtml([teacher.lab, teacher.position].filter(Boolean).join(" / "))}</td>
          <td><span class="quality-badge quality-${escapeHtml(quality)}">${escapeHtml(QUALITY[quality] || quality)}</span></td>
          <td>${escapeHtml(keywords.slice(0, 8).join(" / "))}</td>
          <td>${url ? `<a class="table-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">開く</a>` : "-"}</td>
        </tr>`;
        }).join("");
    }

    function normalizeKeywords(value) {
        const items = Array.isArray(value) ? value : String(value).split(/\s*(?:\/|、|，|,|・|\n)\s*/);
        return Array.from(new Set(items.map((item) => cleanText(item)).filter((item) => item.length >= 2)));
    }

    function cleanText(value) {
        return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "'": "&#39;",
            "\"": "&quot;"
        })[char]);
    }

    init().catch((error) => {
        console.error(error);
        $("#sourceSummary").textContent = "データの読み込みに失敗しました。";
    });
})();
