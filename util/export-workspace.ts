export const EXPORT_DRAFTS_STORAGE_KEY = 'furigana_export_drafts';
export const EXPORT_HISTORY_STORAGE_KEY = 'furigana_export_history';

export type ExportBlockKind = 'title' | 'subtitle' | 'paragraph' | 'quote' | 'list-item';

export interface ExtractedPageBlock {
  id: string;
  kind: ExportBlockKind;
  text: string;
}

export interface EditableToken {
  id: string;
  type: 'text' | 'ruby';
  text: string;
  reading?: string;
}

export interface ExportDraftBlock extends ExtractedPageBlock {
  included: boolean;
  tokens: EditableToken[];
  lastGeneratedText: string;
}

export interface ExportWorkspaceDraft {
  id: string;
  title: string;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  blocks: ExportDraftBlock[];
}

export interface ExportHistoryItem {
  id: string;
  title: string;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  blockCount: number;
}

export function createDraftId() {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createWorkspaceDraft(payload: { title: string; sourceUrl: string; blocks: ExtractedPageBlock[] }): ExportWorkspaceDraft {
  const now = new Date().toISOString();
  return {
    id: createDraftId(),
    title: payload.title,
    sourceUrl: payload.sourceUrl,
    createdAt: now,
    updatedAt: now,
    blocks: payload.blocks.map((block) => ({
      ...block,
      included: true,
      tokens: [],
      lastGeneratedText: '',
    })),
  };
}

export function createHistoryItem(draft: ExportWorkspaceDraft): ExportHistoryItem {
  return {
    id: draft.id,
    title: draft.title,
    sourceUrl: draft.sourceUrl,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    blockCount: draft.blocks.filter((block) => block.included).length,
  };
}

export function isDraftStale(block: ExportDraftBlock) {
  return block.text.trim() !== block.lastGeneratedText.trim();
}

export function extractTokensFromRubyHtml(html: string): EditableToken[] {
  const parser = new DOMParser();
  const documentFragment = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = documentFragment.body.firstElementChild;
  if (!root) return [];

  const tokens: EditableToken[] = [];

  root.childNodes.forEach((node, index) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text) {
        tokens.push({
          id: `text-${index}`,
          type: 'text',
          text,
        });
      }
      return;
    }

    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (node.tagName.toLowerCase() !== 'ruby') {
      const text = node.textContent ?? '';
      if (text) {
        tokens.push({
          id: `text-${index}`,
          type: 'text',
          text,
        });
      }
      return;
    }

    const reading = node.querySelector('rt')?.textContent ?? '';
    const baseText = Array.from(node.childNodes)
      .filter((child) => !(child instanceof HTMLElement) || !['rt', 'rp'].includes(child.tagName.toLowerCase()))
      .map((child) => child.textContent ?? '')
      .join('');

    tokens.push({
      id: `ruby-${index}`,
      type: 'ruby',
      text: baseText,
      reading,
    });
  });

  return tokens;
}

export function tokensToHtml(tokens: EditableToken[]) {
  return tokens.map((token) => {
    if (token.type === 'text') {
      return escapeHtml(token.text);
    }

    return `<ruby>${escapeHtml(token.text)}<rt>${escapeHtml(token.reading ?? '')}</rt></ruby>`;
  }).join('');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
