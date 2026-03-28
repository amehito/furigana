import { useEffect, useMemo, useState } from 'react';

const REPORT_FORM_ID = '1FAIpQLSdjKa6b2yIqzpRo3ZZzEXA0QL6LAzy-UTE9Z9vtM6KwGPNKVA';
const REPORT_ENDPOINT = `https://docs.google.com/forms/d/e/${REPORT_FORM_ID}/formResponse`;
const REPORT_STORAGE_KEY = 'https://word.cloud.microsoft/en-us/';
const REPORT_OPTIONS = [
  'UNCORRECT_FURIGANA',
  'MISS_FURIGANA',
  'MULTI_PRONUANCE',
  'other',
] as const;

type ReportType = (typeof REPORT_OPTIONS)[number];

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
  const [selectedTypes, setSelectedTypes] = useState<ReportType[]>([]);
  const [suggestedReading, setSuggestedReading] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [hasReported, setHasReported] = useState(false);

  const shouldShowSuggestion = selectedTypes.includes('MULTI_PRONUANCE');

  const currentUrl = useMemo(() => window.location.href, []);

  useEffect(() => {
    if (!isOpen) return;

    setSelectedTypes([]);
    setSuggestedReading('');
    setIsSubmitting(false);
    setMessage('');
    setHasReported(hasWordBeenReported(word));
  }, [isOpen, word]);

  if (!isOpen) return null;

  const handleTypeChange = (type: ReportType) => {
    setSelectedTypes((current) => {
      if (current.includes(type)) {
        return current.filter((item) => item !== type);
      }

      return [...current, type];
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (hasReported || isSubmitting) return;
    if (!selectedTypes.length) {
      setMessage('请至少选择一个问题类型。');
      return;
    }
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

    for (const type of selectedTypes) {
      payload.append('entry.1774717866', type);
    }

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
      setMessage('✅ 您已上报过该词');
    } catch (error) {
      console.error('上报失败:', error);
      setMessage('提交失败，请稍后再试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="weicheng-report-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-modal="true"
        className="weicheng-report-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="weicheng-report-header">
          <div>
            <p className="weicheng-report-eyebrow">错误反馈</p>
            <h3 className="weicheng-report-title">{word}</h3>
          </div>
          <button className="weicheng-report-close" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className="weicheng-report-meta">
          <p><strong>当前网址：</strong>{currentUrl}</p>
          <p><strong>当前注音：</strong>{currentFurigana}</p>
          <p><strong>上下文：</strong>{reportContext}</p>
        </div>

        {hasReported ? (
          <div className="weicheng-report-success">✅ 您已上报过该词</div>
        ) : (
          <form className="weicheng-report-form" onSubmit={handleSubmit}>
            <div className="weicheng-report-options">
              {REPORT_OPTIONS.map((type) => (
                <label className="weicheng-report-option" key={type}>
                  <input
                    checked={selectedTypes.includes(type)}
                    onChange={() => handleTypeChange(type)}
                    type="checkbox"
                  />
                  <span>{type}</span>
                </label>
              ))}
            </div>

            {shouldShowSuggestion ? (
              <div className="weicheng-report-field">
                <label className="weicheng-report-label" htmlFor="weicheng-suggested-reading">
                  建议读音
                </label>
                <input
                  className="weicheng-report-input"
                  id="weicheng-suggested-reading"
                  onChange={(event) => setSuggestedReading(event.target.value)}
                  placeholder="请输入建议读音"
                  value={suggestedReading}
                />
              </div>
            ) : null}

            {message ? <div className="weicheng-report-message">{message}</div> : null}

            <div className="weicheng-report-actions">
              <button className="weicheng-report-secondary" onClick={onClose} type="button">
                取消
              </button>
              <button className="weicheng-report-submit" disabled={isSubmitting} type="submit">
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
