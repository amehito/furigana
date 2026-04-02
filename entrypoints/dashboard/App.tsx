import { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  ChevronUp,
  Download,
  FileText,
  Printer,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { browser } from 'wxt/browser';
import { furiganaService } from '../../util/common';
import {
  EXPORT_DRAFTS_STORAGE_KEY,
  EXPORT_HISTORY_STORAGE_KEY,
  type ExportBlockKind,
  type ExportDraftBlock,
  type ExportHistoryItem,
  type ExportWorkspaceDraft,
  createHistoryItem,
  extractTokensFromRubyHtml,
  isDraftStale,
  tokensToHtml,
} from '../../util/export-workspace';

const ICON_PROPS = { size: 24, strokeWidth: 1.75 };
type MenuKey = 'print' | 'favorites';

function App() {
  const [draft, setDraft] = useState<ExportWorkspaceDraft | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [history, setHistory] = useState<ExportHistoryItem[]>([]);
  const [activeMenu, setActiveMenu] = useState<MenuKey>('print');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const load = async () => {
      const draftId = new URLSearchParams(window.location.search).get('draft');
      const storage = await browser.storage.local.get([
        EXPORT_DRAFTS_STORAGE_KEY,
        EXPORT_HISTORY_STORAGE_KEY,
        'favorites',
      ]);

      const draftMap = normalizeDraftMap(storage[EXPORT_DRAFTS_STORAGE_KEY]);
      const nextDraft = draftId ? draftMap[draftId] ?? null : null;
      const nextFavorites = Array.isArray(storage.favorites) ? storage.favorites : [];
      const nextHistory = normalizeHistory(storage[EXPORT_HISTORY_STORAGE_KEY]);

      setDraft(nextDraft);
      setFavorites(nextFavorites);
      setHistory(nextHistory);
      setError(nextDraft ? '' : '没有找到可编辑的导出草稿，请先从 popup 发起“导出当前页面”。');
      setLoading(false);
    };

    void load();
  }, []);

  useEffect(() => {
    if (!draft) return;

    const needsGeneration = draft.blocks.some((block) => !block.tokens.length && block.text.trim());
    if (!needsGeneration) return;

    void hydrateDraftRuby(draft, setDraft, setError);
  }, [draft]);

  useEffect(() => {
    if (!draft) return;

    const handle = window.setTimeout(async () => {
      const nextDraft = {
        ...draft,
        updatedAt: new Date().toISOString(),
      };

      const storage = await browser.storage.local.get([EXPORT_DRAFTS_STORAGE_KEY, EXPORT_HISTORY_STORAGE_KEY]);
      const draftMap = normalizeDraftMap(storage[EXPORT_DRAFTS_STORAGE_KEY]);
      const nextHistory = upsertHistory(normalizeHistory(storage[EXPORT_HISTORY_STORAGE_KEY]), nextDraft);
      draftMap[nextDraft.id] = nextDraft;

      await browser.storage.local.set({
        [EXPORT_DRAFTS_STORAGE_KEY]: draftMap,
        [EXPORT_HISTORY_STORAGE_KEY]: nextHistory,
      });

      setHistory(nextHistory);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [draft]);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 360);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const includedBlocks = useMemo(
    () => draft?.blocks.filter((block) => block.included) ?? [],
    [draft],
  );

  const renderMain = () => {
    if (loading) {
      return <div className="workspace-empty">正在载入导出工作台...</div>;
    }

    if (activeMenu === 'favorites') {
      return (
        <section className="workspace-panel">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-kicker">收藏记录</p>
              <h2>已收藏词条</h2>
            </div>
          </div>

          {favorites.length ? (
            <div className="favorites-grid">
              {favorites.map((item) => (
                <article className="favorite-card" key={item}>
                  <p className="favorite-card__word">{item}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="workspace-empty">当前还没有收藏记录，划词卡片里的收藏会同步显示在这里。</div>
          )}
        </section>
      );
    }

    if (!draft) {
      return <div className="workspace-empty">{error || '暂无草稿'}</div>;
    }

    return (
      <div className="workspace-content">
        <section className="workspace-panel workspace-panel--editor">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-kicker">打印内容</p>
              <h2>{draft.title}</h2>
              <p className="workspace-meta">{draft.sourceUrl}</p>
            </div>
            <div className="workspace-actions">
              <button className="workspace-button workspace-button--ghost" onClick={() => window.print()} type="button">
                <Printer {...ICON_PROPS} />
                <span>导出 PDF</span>
              </button>
            </div>
          </div>

          <div className="workspace-stats">
            <div className="workspace-stat">
              <span>保留段落</span>
              <strong>{includedBlocks.length}</strong>
            </div>
            <div className="workspace-stat">
              <span>最近保存</span>
              <strong>{formatDateTime(draft.updatedAt)}</strong>
            </div>
          </div>

          <div className="editor-list">
            {draft.blocks.map((block, index) => {
              const stale = isDraftStale(block);
              return (
                <article className="editor-card" key={block.id}>
                  <div className="editor-card__toolbar">
                    <label className="editor-card__toggle">
                      <input
                        checked={block.included}
                        onChange={(event) => updateDraftBlock(setDraft, block.id, { included: event.target.checked })}
                        type="checkbox"
                      />
                      <span>{block.included ? '已收录' : '已排除'}</span>
                    </label>

                    <div className="editor-card__actions">
                      <button
                        className="icon-action"
                        disabled={index === 0}
                        onClick={() => moveDraftBlock(setDraft, index, -1)}
                        title="上移"
                        type="button"
                      >
                        <ChevronUp {...ICON_PROPS} />
                      </button>
                      <button
                        className="icon-action"
                        disabled={index === draft.blocks.length - 1}
                        onClick={() => moveDraftBlock(setDraft, index, 1)}
                        title="下移"
                        type="button"
                      >
                        <ChevronUp className="rotate-180" {...ICON_PROPS} />
                      </button>
                      <button
                        className="icon-action"
                        onClick={() => void regenerateBlock(setDraft, draft, block.id)}
                        title="重新生成注音"
                        type="button"
                      >
                        <RefreshCw {...ICON_PROPS} />
                      </button>
                      <button
                        className="icon-action"
                        onClick={() => removeDraftBlock(setDraft, block.id)}
                        title="删除段落"
                        type="button"
                      >
                        <Trash2 {...ICON_PROPS} />
                      </button>
                    </div>
                  </div>

                  <div className="editor-card__grid">
                    <div className="editor-card__fields">
                      <label className="editor-label">
                        <span>段落样式</span>
                        <select
                          className="editor-select"
                          value={block.kind}
                          onChange={(event) => updateDraftBlock(setDraft, block.id, { kind: event.target.value as ExportBlockKind })}
                        >
                          <option value="title">主标题</option>
                          <option value="subtitle">副标题</option>
                          <option value="paragraph">正文</option>
                          <option value="quote">引用</option>
                          <option value="list-item">列表</option>
                        </select>
                      </label>

                      <label className="editor-label">
                        <span>文字内容</span>
                        <textarea
                          className="editor-textarea"
                          rows={block.kind === 'paragraph' ? 5 : 3}
                          value={block.text}
                          onBlur={() => void regenerateBlock(setDraft, draft, block.id)}
                          onChange={(event) => updateDraftBlock(setDraft, block.id, { text: event.target.value })}
                        />
                      </label>

                      <div className="editor-ruby">
                        <div className="editor-ruby__header">
                          <span>注音修正</span>
                          {stale ? <span className="editor-hint">正文已改动，离开输入框后会自动重算注音。</span> : null}
                        </div>
                        <div className="editor-ruby__list">
                          {block.tokens.filter((token) => token.type === 'ruby').length ? (
                            block.tokens.map((token) => token.type === 'ruby' ? (
                              <label className="ruby-chip" key={token.id}>
                                <span>{token.text}</span>
                                <input
                                  value={token.reading ?? ''}
                                  onChange={(event) => updateDraftToken(setDraft, block.id, token.id, event.target.value)}
                                />
                              </label>
                            ) : null)
                          ) : (
                            <div className="editor-hint">这段里暂时没有可编辑的注音，或正在生成中。</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="editor-card__preview">
                      <p className="editor-preview__label">打印预览</p>
                      <BlockPreview block={block} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="workspace-panel workspace-panel--history">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-kicker">历史记录</p>
              <h2>最近导出</h2>
            </div>
          </div>

          <div className="history-list">
            {history.length ? history.map((item) => (
              <article className="history-card" key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.blockCount} 段内容</p>
                <time>{formatDateTime(item.updatedAt)}</time>
              </article>
            )) : (
              <div className="workspace-empty workspace-empty--compact">这里空空如也</div>
            )}
          </div>
        </aside>

        <section className="print-sheet-wrapper">
          <article className="print-sheet">
            <header className="print-sheet__header">
              <p className="print-sheet__eyebrow">Japanese Reading Export</p>
              <h1>{draft.title}</h1>
              <p>{draft.sourceUrl}</p>
            </header>

            <div className="print-sheet__body">
              {includedBlocks.map((block) => (
                <BlockPreview block={block} key={block.id} printable />
              ))}
            </div>
          </article>
        </section>
      </div>
    );
  };

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand">
          <div className="workspace-brand__icon">
            <Download {...ICON_PROPS} />
          </div>
          <div>
            <p>日语注音导出</p>
            <strong>管理后台</strong>
          </div>
        </div>

        <nav className="workspace-nav">
          <button
            className={`workspace-nav__item ${activeMenu === 'print' ? 'is-active' : ''}`}
            onClick={() => setActiveMenu('print')}
            type="button"
          >
            <FileText {...ICON_PROPS} />
            <span>打印内容</span>
          </button>
          <button
            className={`workspace-nav__item ${activeMenu === 'favorites' ? 'is-active' : ''}`}
            onClick={() => setActiveMenu('favorites')}
            type="button"
          >
            <BookMarked {...ICON_PROPS} />
            <span>收藏记录</span>
          </button>
        </nav>
      </aside>

      <main className="workspace-main">{renderMain()}</main>

      <button
        aria-label="回到顶部"
        className={`back-to-top ${showBackToTop ? 'is-visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        type="button"
      >
        <ChevronUp {...ICON_PROPS} />
        <span>顶部</span>
      </button>
    </div>
  );
}

function BlockPreview({ block, printable = false }: { block: ExportDraftBlock; printable?: boolean }) {
  const html = block.tokens.length ? tokensToHtml(block.tokens) : block.text;
  const className = [
    'block-preview',
    `block-preview--${block.kind}`,
    printable ? 'is-printable' : '',
    block.included ? '' : 'is-muted',
  ].filter(Boolean).join(' ');

  return <section className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

async function hydrateDraftRuby(
  draft: ExportWorkspaceDraft,
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  setError: React.Dispatch<React.SetStateAction<string>>,
) {
  try {
    const nextBlocks = await Promise.all(
      draft.blocks.map(async (block) => {
        if (block.tokens.length || !block.text.trim()) return block;
        const html = await furiganaService.convert(block.text);
        return {
          ...block,
          tokens: extractTokensFromRubyHtml(html),
          lastGeneratedText: block.text,
        };
      }),
    );

    setDraft((current) => current ? { ...current, blocks: nextBlocks } : current);
  } catch (error) {
    setError(error instanceof Error ? error.message : '生成注音失败');
  }
}

async function regenerateBlock(
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  draft: ExportWorkspaceDraft,
  blockId: string,
) {
  const current = draft.blocks.find((item) => item.id === blockId);
  if (!current) return;

  const html = await furiganaService.convert(current.text);
  setDraft((state) => {
    if (!state) return state;
    return {
      ...state,
      blocks: state.blocks.map((block) => block.id === blockId ? {
        ...block,
        tokens: extractTokensFromRubyHtml(html),
        lastGeneratedText: block.text,
      } : block),
    };
  });
}

function updateDraftBlock(
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  blockId: string,
  patch: Partial<ExportDraftBlock>,
) {
  setDraft((state) => {
    if (!state) return state;
    return {
      ...state,
      blocks: state.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block),
    };
  });
}

function updateDraftToken(
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  blockId: string,
  tokenId: string,
  reading: string,
) {
  setDraft((state) => {
    if (!state) return state;
    return {
      ...state,
      blocks: state.blocks.map((block) => block.id === blockId ? {
        ...block,
        tokens: block.tokens.map((token) => token.id === tokenId ? { ...token, reading } : token),
      } : block),
    };
  });
}

function moveDraftBlock(
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  index: number,
  direction: -1 | 1,
) {
  setDraft((state) => {
    if (!state) return state;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= state.blocks.length) return state;

    const blocks = [...state.blocks];
    const [item] = blocks.splice(index, 1);
    blocks.splice(targetIndex, 0, item);
    return { ...state, blocks };
  });
}

function removeDraftBlock(
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  blockId: string,
) {
  setDraft((state) => {
    if (!state) return state;
    return {
      ...state,
      blocks: state.blocks.filter((block) => block.id !== blockId),
    };
  });
}

function normalizeDraftMap(value: unknown): Record<string, ExportWorkspaceDraft> {
  return value && typeof value === 'object' ? value as Record<string, ExportWorkspaceDraft> : {};
}

function normalizeHistory(value: unknown): ExportHistoryItem[] {
  return Array.isArray(value) ? value as ExportHistoryItem[] : [];
}

function upsertHistory(history: ExportHistoryItem[], draft: ExportWorkspaceDraft) {
  const next = [createHistoryItem(draft), ...history.filter((item) => item.id !== draft.id)];
  return next.slice(0, 12);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default App;
