import { service } from '@/entrypoints/background/service';

type LabRow = {
  word: string;
  currentReading: string;
  context: string;
};

if (import.meta.env.MODE === 'production') {
  document.body.innerHTML = "<h1>403 Forbidden</h1><p>该工具仅限开发者模式使用。</p>";
  // 或者直接跳转到插件官网
  // window.location.href = "https://your-website.com";
}

const KANJI_PATTERN = /[\u4E00-\u9FFF]/;
const SEGMENTER = new Intl.Segmenter('ja-JP', { granularity: 'word' });

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Lab root container not found.');
}

root.innerHTML = `
  <style>
    :root {
      color-scheme: light;
      font-family: "Inter", "Hiragino Sans", "Yu Gothic", sans-serif;
      color: #1f2937;
      background: #f4f7fb;
    }

    body {
      margin: 0;
      background: linear-gradient(180deg, #f7fafc, #eef4fb);
    }

    .weicheng-lab {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 40px;
    }

    .weicheng-lab__header {
      margin-bottom: 20px;
    }

    .weicheng-lab__title {
      margin: 0 0 6px;
      font-size: 28px;
      line-height: 1.2;
    }

    .weicheng-lab__desc {
      margin: 0;
      color: #64748b;
      line-height: 1.6;
    }

    .weicheng-lab__panel {
      padding: 20px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
    }

    .weicheng-lab__textarea {
      width: 100%;
      min-height: 260px;
      padding: 16px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 16px;
      resize: vertical;
      font: inherit;
      font-size: 15px;
      line-height: 1.8;
      box-sizing: border-box;
      background: #fff;
    }

    .weicheng-lab__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-top: 16px;
    }

    .weicheng-lab__button {
      border: 0;
      border-radius: 999px;
      padding: 10px 16px;
      font: inherit;
      font-weight: 600;
      color: #fff;
      cursor: pointer;
      background: linear-gradient(135deg, #2563eb, #0f766e);
    }

    .weicheng-lab__button--secondary {
      background: linear-gradient(135deg, #475569, #334155);
    }

    .weicheng-lab__button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .weicheng-lab__status {
      color: #64748b;
      font-size: 14px;
    }

    .weicheng-lab__table-wrap {
      margin-top: 20px;
      overflow: auto;
      border: 1px solid rgba(226, 232, 240, 0.9);
      border-radius: 18px;
      background: #fff;
    }

    .weicheng-lab__table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }

    .weicheng-lab__table th,
    .weicheng-lab__table td {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.9);
      text-align: left;
      vertical-align: top;
      font-size: 14px;
      line-height: 1.6;
    }

    .weicheng-lab__table th {
      position: sticky;
      top: 0;
      background: #f8fafc;
      color: #475569;
      font-weight: 700;
    }

    .weicheng-lab__empty {
      padding: 28px 16px;
      text-align: center;
      color: #94a3b8;
    }
  </style>

  <main class="weicheng-lab">
    <header class="weicheng-lab__header">
      <h1 class="weicheng-lab__title">注音测试实验室</h1>
      <p class="weicheng-lab__desc">粘贴一段日文文章，按词切分、去重、提取上下文，并导出注音校对 CSV。</p>
    </header>

    <section class="weicheng-lab__panel">
      <textarea class="weicheng-lab__textarea" placeholder="请粘贴需要分析的日文文章"></textarea>

      <div class="weicheng-lab__actions">
        <button class="weicheng-lab__button" type="button">开始分析</button>
        <button class="weicheng-lab__button weicheng-lab__button--secondary" type="button" disabled>导出 CSV</button>
        <span class="weicheng-lab__status">等待输入文章</span>
      </div>

      <div class="weicheng-lab__table-wrap">
        <table class="weicheng-lab__table">
          <thead>
            <tr>
              <th>原文</th>
              <th>当前注音</th>
              <th>上下文</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="weicheng-lab__empty" colspan="3">暂无分析结果</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
`;

const textarea = root.querySelector<HTMLTextAreaElement>('.weicheng-lab__textarea');
const analyzeButton = root.querySelector<HTMLButtonElement>('.weicheng-lab__button');
const exportButton = root.querySelectorAll<HTMLButtonElement>('.weicheng-lab__button')[1];
const status = root.querySelector<HTMLSpanElement>('.weicheng-lab__status');
const tableBody = root.querySelector<HTMLTableSectionElement>('tbody');

if (!textarea || !analyzeButton || !exportButton || !status || !tableBody) {
  throw new Error('Lab UI failed to initialize.');
}

let currentRows: LabRow[] = [];

analyzeButton.addEventListener('click', async () => {
  const text = textarea.value.trim();
  if (!text) {
    status.textContent = '请先输入文章';
    return;
  }

  analyzeButton.disabled = true;
  exportButton.disabled = true;
  status.textContent = '分析中...';

  try {
    currentRows = await analyzeArticle(text);
    renderTable(currentRows);
    exportButton.disabled = currentRows.length === 0;
    status.textContent = currentRows.length
      ? `分析完成，共 ${currentRows.length} 个待校对词`
      : '未找到包含汉字的词段';
  } catch (error) {
    console.error('分析失败:', error);
    status.textContent = '分析失败，请打开控制台查看详情';
  } finally {
    analyzeButton.disabled = false;
  }
});

exportButton.addEventListener('click', () => {
  if (!currentRows.length) return;
  exportRowsToCsv(currentRows);
});

async function analyzeArticle(text: string): Promise<LabRow[]> {
  const seen = new Set<string>();
  const entries = Array.from(SEGMENTER.segment(text));
  const rows: LabRow[] = [];

  for (const entry of entries) {
    const word = entry.segment.trim();
    if (!entry.isWordLike || !word) continue;
    if (!KANJI_PATTERN.test(word)) continue;
    if (seen.has(word)) continue;

    seen.add(word);
    const prev = text.slice(Math.max(0, entry.index - 10), entry.index);
    const next = text.slice(entry.index + word.length, entry.index + word.length + 10);
    const context = `${prev}[${word}]${next}`;
    const currentReading = await service.getReading(word, { prev, next });

    rows.push({
      word,
      currentReading,
      context,
    });
  }

  return rows;
}

function renderTable(rows: LabRow[]) {
  if (!rows.length) {
    tableBody.innerHTML = `
      <tr>
        <td class="weicheng-lab__empty" colspan="3">暂无分析结果</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.word)}</td>
      <td>${escapeHtml(row.currentReading)}</td>
      <td>${escapeHtml(row.context)}</td>
    </tr>
  `).join('');
}

function exportRowsToCsv(rows: LabRow[]) {
  const headers = ['Word', 'CurrentReading', 'Context', 'IsCorrect', 'CorrectReading', 'Note'];
  const lines = rows.map((row) => [
    row.word,
    row.currentReading,
    row.context,
    '',
    '',
    '',
  ]);

  const csvContent = [headers, ...lines]
    .map((line) => line.map(escapeCsvCell).join(','))
    .join('\r\n');

  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `furigana-lab-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: string) {
  const normalized = String(value ?? '');
  return `"${normalized.replaceAll('"', '""')}"`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
