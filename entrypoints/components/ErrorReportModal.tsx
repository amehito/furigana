import { useEffect, useMemo, useState } from 'react';

const REPORT_FORM_ID = '1FAIpQLSdjKa6b2yIqzpRo3ZZzEXA0QL6LAzy-UTE9Z9vtM6KwGPNKVA';
const REPORT_ENDPOINT = `https://docs.google.com/forms/d/e/${REPORT_FORM_ID}/formResponse`;
const REPORT_STORAGE_KEY ='furigana_reported_words';
const KANJI_PATTERN = /[\u4E00-\u9FFF]/;
const REPORT_OPTIONS = [
  { label: '注音错误', value: 'UNCORRECT_FURIGANA' },
  { label: '缺少注音', value: 'MISS_FURIGANA' },
  { label: '多音字 / 多读音', value: 'MULTI_PRONUANCE' },
  { label: '其他', value: 'other' },
] as const;

type ReportType = (typeof REPORT_OPTIONS)[number]['value'];

type ErrorReportModalProps = {
  currentFurigana: string;
  isOpen: boolean;
  onClose: () => void;
  reportContext: string;
  word: string;
};

export function ErrorReportModal({
  currentFurigana,
  isOpen,
  onClose,
  reportContext,
  word,
}: ErrorReportModalProps) {
  const [selectedType, setSelectedType] = useState<ReportType>('UNCORRECT_FURIGANA');
  const [suggestedReading, setSuggestedReading] = useState('');
  const [remark, setRemark] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [hasReported, setHasReported] = useState(false);

  const shouldShowSuggestion = selectedType === 'MULTI_PRONUANCE';
  const currentUrl = useMemo(() => window.location.href, []);
  const plainFurigana = useMemo(() => extractReadingText(currentFurigana), [currentFurigana]);
  const showTitleReading = KANJI_PATTERN.test(word) && plainFurigana;

  useEffect(() => {
    if (!isOpen) return;

    setSelectedType('UNCORRECT_FURIGANA');
    setSuggestedReading('');
    setRemark('');
    setIsSubmitting(false);
    setMessage('');
    setHasReported(hasWordBeenReported(word));
  }, [isOpen, word]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (hasReported || isSubmitting) return;
    if (shouldShowSuggestion && !suggestedReading.trim()) {
      setMessage('请填写建议读音。');
      return;
    }

    setIsSubmitting(true);
    setMessage('');

    const payload = new URLSearchParams();
    payload.append('entry.1330580616', word);
    payload.append('entry.721528465', buildReportContext(reportContext, suggestedReading));
    payload.append('entry.54097300', currentUrl);
    payload.append('entry.1644994052', selectedType);
    payload.append('entry.1136462363', buildExtraNote(remark, suggestedReading));

    try {
      await fetch(REPORT_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: payload.toString(),
      });

      saveReportedWord(word);
      setHasReported(true);
      setMessage('✅ 您已上报成功');
    } catch (error) {
      console.error('上报失败:', error);
      setMessage('提交失败，请稍后再试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="oye-report-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-modal="true"
        className="oye-report-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="oye-report-header">
          <div>
            <p className="oye-report-eyebrow">错误反馈</p>
            <h3 className="oye-report-title">
              {word}
              {showTitleReading ? <span className="oye-report-title-reading">（{plainFurigana}）</span> : null}
            </h3>
          </div>
          <button className="oye-report-close" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className="oye-report-meta">
          <p><strong>当前注音：</strong>{plainFurigana || currentFurigana}</p>
          <p><strong>上下文：</strong>{reportContext}</p>
        </div>

        {hasReported ? (
          <div className="oye-report-success">✅ 您已上报成功</div>
        ) : (
          <form className="oye-report-form" onSubmit={handleSubmit}>
            <div className="oye-report-field">
              <label className="oye-report-label" htmlFor="oye-report-type">
                问题类型
              </label>
              <select
                className="oye-report-input"
                id="oye-report-type"
                onChange={(event) => setSelectedType(event.target.value as ReportType)}
                value={selectedType}
              >
                {REPORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {shouldShowSuggestion ? (
              <div className="oye-report-field">
                <label className="oye-report-label" htmlFor="oye-suggested-reading">
                  建议读音
                </label>
                <input
                  className="oye-report-input"
                  id="oye-suggested-reading"
                  onChange={(event) => setSuggestedReading(event.target.value)}
                  placeholder="请输入建议读音"
                  value={suggestedReading}
                />
              </div>
            ) : null}

            <div className="oye-report-field">
              <label className="oye-report-label" htmlFor="oye-report-remark">
                备注
              </label>
              <input
                className="oye-report-input"
                id="oye-report-remark"
                onChange={(event) => setRemark(event.target.value)}
                placeholder="可补充错误原因、建议或特殊上下文"
                value={remark}
              />
            </div>

            {message ? <div className="oye-report-message">{message}</div> : null}

            <div className="oye-report-actions">
              <button className="oye-report-secondary" onClick={onClose} type="button">
                取消
              </button>
              <button className="oye-report-submit" disabled={isSubmitting} type="submit">
                {isSubmitting ? '正在提交...' : '提交反馈'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function buildReportContext(context: string, suggestedReading: string) {
  if (!suggestedReading.trim()) return context;
  return `${context}\nSuggestedReading: ${suggestedReading.trim()}`;
}

function buildExtraNote(remark: string, suggestedReading: string) {
  const parts = [
    suggestedReading.trim() ? `建议读音: ${suggestedReading.trim()}` : '',
    remark.trim(),
  ].filter(Boolean);

  return parts.join('\n');
}

function extractReadingText(content: string) {
  const rtMatches = Array.from(content.matchAll(/<rt[^>]*>(.*?)<\/rt>/g))
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);

  if (rtMatches.length) {
    return rtMatches.join('');
  }

  return content.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
}

function hasWordBeenReported(word: string) {
  const reportedWords = readReportedWords();
  return reportedWords.includes(word);
}

function saveReportedWord(word: string) {
  const reportedWords = readReportedWords();
  if (reportedWords.includes(word)) return;

  localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify([...reportedWords, word]));
}

function readReportedWords(): string[] {
  try {
    const raw = localStorage.getItem(REPORT_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
