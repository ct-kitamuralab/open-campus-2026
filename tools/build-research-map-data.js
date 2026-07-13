const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const TEACHERS_PATH = path.join(ROOT, "data", "teachers.json");
const OUTPUT_PATH = path.join(ROOT, "data", "research-map-analysis.json");
const KUROMOJI_PATH = path.join(ROOT, "vendor", "kuromoji.js");
const KUROMOJI_DICT_PATH = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";
const TARGET_DEPARTMENT = "高度応用情報科学科";
const MAX_TERMS = 1400;

let tokenizer = null;

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

async function main() {
    tokenizer = await loadKuromoji();
    const teachersJson = fs.readFileSync(TEACHERS_PATH, "utf8");
    const teachers = JSON.parse(teachersJson);
    const analysis = {
        source: "data/teachers.json",
        sourceHash: crypto.createHash("sha256").update(teachersJson).digest("hex"),
        tokenizer: "kuromoji@0.1.2",
        targetDepartment: TARGET_DEPARTMENT,
        department: buildAnalysis(buildDepartmentRows(teachers)),
        teacher: buildAnalysis(buildTeacherRows(teachers))
    };

    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(analysis)}\n`);
    console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
    console.log(`Departments: ${analysis.department.rows.length}, teachers: ${analysis.teacher.rows.length}`);
}

function buildAnalysis(rows) {
    const { terms, matrix } = vectorize(rows);
    const projection = projectPca2d(matrix, terms);
    return {
        rows,
        terms,
        matrix: matrix.map((row) => row.map(roundNumber)),
        coords: projection.coords.map(([x, y]) => [roundNumber(x), roundNumber(y)]),
        pca: {
            explainedVarianceRatio: projection.pca.explainedVarianceRatio.map(roundNumber),
            cumulativeExplainedVarianceRatio: roundNumber(projection.pca.cumulativeExplainedVarianceRatio),
            components: projection.pca.components.map((component) => ({
                positiveLoadings: component.positiveLoadings.map((item) => ({ term: item.term, weight: roundNumber(item.weight) })),
                negativeLoadings: component.negativeLoadings.map((item) => ({ term: item.term, weight: roundNumber(item.weight) }))
            }))
        },
        similarities: computeSimilarities(matrix).map((row) => row.map(roundNumber))
    };
}

function buildTeacherRows(sourceTeachers) {
    return sourceTeachers.map((teacher, index) => {
        const quality = teacher.research_map?.quality || "weak";
        const keywords = normalizeKeywords(keywordSource(teacher));
        const theme = teacher.source_text?.theme || "";
        const research = teacher.research || teacher.description || theme || teacher.research_map?.text || "";
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
            warnings: teacher.research_map?.warnings || [],
            teacherCount: 1,
            profileUrl: teacher.profile_url || teacher.source_department_url || ""
        };
    });
}

function buildDepartmentRows(sourceTeachers) {
    const groups = new Map();
    sourceTeachers.forEach((teacher) => {
        if (!groups.has(teacher.department)) groups.set(teacher.department, []);
        groups.get(teacher.department).push(teacher);
    });

    return Array.from(groups, ([department, members]) => {
        const faculty = members.find((member) => member.faculty)?.faculty || "";
        const qualityCounts = countBy(members, (member) => member.research_map?.quality || "weak");
        const keywords = topKeywords(members.flatMap((member) => normalizeKeywords(keywordSource(member))), 12);
        const warnings = unique(members.flatMap((member) => member.research_map?.warnings || []));
        const representative = members.find((member) => member.research_map?.quality === "full" && (member.research || member.description))
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
            text: joinUnique(members.map((member) => member.research_map?.text || "")),
            quality: aggregateQuality(qualityCounts, members.length),
            qualityCounts,
            warnings,
            teacherCount: members.length,
            profileUrl: representative?.source_department_url || representative?.profile_url || "",
            teachers: members.map((member) => ({
                name: member.name || "",
                lab: member.lab || "",
                position: member.position || "",
                profile_url: member.profile_url || "",
                source_department_url: member.source_department_url || ""
            }))
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
    if (tokenizer) {
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

function tokenizeJapaneseText(text) {
    return tokenizer.tokenize(text)
        .filter((token) => isUsefulJapaneseToken(token))
        .map((token) => token.basic_form && token.basic_form !== "*" ? token.basic_form : token.surface_form);
}

function isUsefulJapaneseToken(token) {
    if (token.pos !== "名詞") return false;
    if (["非自立", "接尾", "数", "代名詞"].includes(token.pos_detail_1)) return false;
    return true;
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

function projectPca2d(matrix, terms) {
    const centered = centerColumns(matrix);
    const first = powerIterationForCovariance(centered);
    const firstScores = centered.map((row) => dot(row, first.vector));
    const deflated = centered.map((row) => {
        const score = dot(row, first.vector);
        return row.map((value, index) => value - score * first.vector[index]);
    });
    const second = powerIterationForCovariance(deflated);
    const secondScores = centered.map((row) => dot(row, second.vector));
    const totalVariance = centered.reduce((sum, row) => sum + dot(row, row), 0) || 1;
    const firstRatio = dot(firstScores, firstScores) / totalVariance;
    const secondRatio = dot(secondScores, secondScores) / totalVariance;
    return {
        coords: firstScores.map((score, index) => [score, secondScores[index]]),
        pca: {
            explainedVarianceRatio: [firstRatio, secondRatio],
            cumulativeExplainedVarianceRatio: firstRatio + secondRatio,
            components: [first.vector, second.vector].map((vector) => ({
                positiveLoadings: componentTerms(vector, terms, "positive", 15),
                negativeLoadings: componentTerms(vector, terms, "negative", 15)
            }))
        }
    };
}

function componentTerms(vector, terms, direction, limit) {
    const items = vector.map((weight, index) => ({ term: terms[index], weight }));
    items.sort((a, b) => direction === "positive" ? b.weight - a.weight : a.weight - b.weight);
    return items.slice(0, limit);
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

async function loadKuromoji() {
    installXmlHttpRequestPolyfill();
    const kuromoji = require(KUROMOJI_PATH);
    return await new Promise((resolve, reject) => {
        kuromoji.builder({ dicPath: KUROMOJI_DICT_PATH }).build((error, builtTokenizer) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(builtTokenizer);
        });
    });
}

function installXmlHttpRequestPolyfill() {
    global.XMLHttpRequest = class XMLHttpRequestPolyfill {
        constructor() {
            this.responseType = "";
            this.response = null;
            this.status = 0;
            this.onload = null;
            this.onerror = null;
            this._url = "";
        }

        open(method, url) {
            if (method !== "GET") throw new Error(`Unsupported XMLHttpRequest method: ${method}`);
            this._url = url;
        }

        async send() {
            try {
                const response = await fetch(this._url);
                this.status = response.status;
                if (!response.ok) throw new Error(`Dictionary load failed: ${response.status} ${this._url}`);
                const buffer = Buffer.from(await response.arrayBuffer());
                this.response = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
                this.onload?.();
            } catch (error) {
                this.status = 0;
                this.onerror?.(error);
            }
        }
    };
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

function roundNumber(value) {
    return Number(value.toFixed(6));
}
