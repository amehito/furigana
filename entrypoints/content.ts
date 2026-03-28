import '../assets/content.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { furiganaService } from '../util/common';
import { browser } from 'wxt/browser';
import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type TooltipSettings,
  type TranslatorEngine,
} from '../types/settings';
import { ErrorReportModal } from './components/ErrorReportModal';

const divName = 'my-floating-popup';
const styleId = 'furigana-dynamic-style';
const reportModalId = 'weicheng-report-root';
const MAX_TOOLTIP_CHARS = 100;
const WORD_CARD_CHARS = 7;
const KANJI_PATTERN = /[\u4E00-\u9FFF]/;
type SelectionContext = { prev: string; next: string };
type ReportPayload = { word: string; reportContext: string; currentFurigana: string };

const TRANSLATOR_URL_BUILDERS: Record<TranslatorEngine, (text: string) => string> = {
  google: (text) => `https://translate.google.com/?sl=ja&tl=zh-CN&text=${encodeURIComponent(text)}&op=translate`,
  deepl: (text) => `https://www.deepl.com/translator#ja/zh-hans/${encodeURIComponent(text)}`,
  bing: (text) => `https://www.bing.com/translator?from=ja&to=zh-Hans&text=${encodeURIComponent(text)}`,
  papago: (text) => `https://papago.naver.com/?sk=ja&tk=zh-CN&st=${encodeURIComponent(text)}`,
};

export default defineContentScript({
  matches: ['<all_urls>'],
  async main(ctx) {
    // 1. 创建并基础初始化浮层
    const overlay = document.createElement('div');
    overlay.id = divName;
    overlay.style.position = 'absolute';
    overlay.style.display = 'none';
    overlay.style.zIndex = '999999';
    document.body.appendChild(overlay);

    const reportModalContainer = document.createElement('div');
    reportModalContainer.id = reportModalId;
    document.body.appendChild(reportModalContainer);
    const reportModalRoot = createRoot(reportModalContainer);

    const chromeLike = globalThis as typeof globalThis & {
      chrome?: {
        tts?: {
          stop?: () => void;
          speak?: (text: string, options?: Record<string, unknown>) => void;
        };
      };
    };

    const loadTooltipSettings = async (): Promise<TooltipSettings> => {
      const data = await browser.storage.local.get('tooltipSettings');
      return { ...DEFAULT_SETTINGS, ...(data.tooltipSettings ?? {}) };
    };

    let extensionSettings: ExtensionSettings = DEFAULT_EXTENSION_SETTINGS;
    const loadExtensionSettings = async (): Promise<ExtensionSettings> => {
      const data = await browser.storage.local.get('extensionSettings');
      extensionSettings = { ...DEFAULT_EXTENSION_SETTINGS, ...(data.extensionSettings ?? {}) };
      return extensionSettings;
    };

    const renderReportModal = (payload: ReportPayload | null) => {
      reportModalRoot.render(
        React.createElement(ErrorReportModal, {
          isOpen: Boolean(payload),
          onClose: () => renderReportModal(null),
          word: payload?.word ?? '',
          reportContext: payload?.reportContext ?? '',
          currentFurigana: payload?.currentFurigana ?? '',
        }),
      );
    };

    const applyStyles = (settings: TooltipSettings) => {
      overlay.style.backgroundColor = settings.backgroundColor;
      overlay.style.fontSize = `${settings.fontSize}px`;
      overlay.style.color = settings.textColor;
      overlay.style.padding = `${settings.padding}px ${Math.max(settings.padding + 4, 12)}px`;
      overlay.style.opacity = '1';

      let styleTag = document.getElementById(styleId) as HTMLStyleElement;
      if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = styleId;
        document.head.appendChild(styleTag);
      }

      // 通过 CSS 变量或直接写选择器来控制注音样式
      styleTag.innerHTML = `
        #${divName} rt {
          font-size: ${settings.rubySize || 0.6}em !important;
          color: ${settings.rubyColor || settings.textColor} !important;
          line-height: 1.1 !important;
        }
        #${divName} ruby {
          ruby-align: center;
        }
      `;
    };

    applyStyles(await loadTooltipSettings());
    await loadExtensionSettings();

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      if (changes.tooltipSettings) {
        applyStyles({ ...DEFAULT_SETTINGS, ...(changes.tooltipSettings.newValue ?? {}) });
      }

      if (changes.extensionSettings) {
        extensionSettings = { ...DEFAULT_EXTENSION_SETTINGS, ...(changes.extensionSettings.newValue ?? {}) };
      }
    });

    document.addEventListener('mouseup', async (e) => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() || '';

      if (!selectedText || !selection || selection.rangeCount === 0) {
        overlay.style.display = 'none';
        return;
      }

      if (!isExtensionEnabledOnCurrentPage(extensionSettings)) {
        overlay.style.display = 'none';
        return;
      }

      if (!KANJI_PATTERN.test(selectedText)) {
        overlay.style.display = 'none';
        return;
      }

      if (selectedText.length > MAX_TOOLTIP_CHARS) {
        overlay.style.display = 'none';
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const settings = await loadTooltipSettings();
      applyStyles(settings);

      let top = rect.top + window.scrollY - 50;
      let left = rect.left + window.scrollX + rect.width / 2;
      if (settings?.position === 'bottom') top = rect.bottom + window.scrollY + 10;
      if (settings?.position === 'left') left = rect.left + window.scrollX - 10;
      if (settings?.position === 'right') left = rect.right + window.scrollX + 10;

      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.transform = 'translateX(-50%)';
      overlay.style.display = 'block';

      const selectionContext = getSelectionContext(range);

      try {
        if (selectedText.length < WORD_CARD_CHARS) {
          await renderWordCard(selectedText, selectionContext);
        } else {
          await renderTooltipWithAudio(selectedText, selectionContext);
        }
      } catch (err) {
        overlay.innerHTML = `<div class="error">转换失败</div>`;
      }
    });

    // 点击其他地方隐藏
    document.addEventListener('mousedown', (e) => {
      // 避免点击浮层内部时消失
      if (!(e.target as HTMLElement).closest(`#${divName}`)) {
        overlay.style.display = 'none';
      }
    });

    const getFavorites = async (): Promise<string[]> => {
      const data = await browser.storage.local.get('favorites');
      return Array.isArray(data.favorites) ? data.favorites : [];
    };

    const setFavorites = async (list: string[]) => {
      await browser.storage.local.set({ favorites: list });
    };

    const isFavorite = async (word: string) => {
      const list = await getFavorites();
      return list.includes(word);
    };

    const toggleFavorite = async (word: string) => {
      const list = await getFavorites();
      const exists = list.includes(word);
      const next = exists ? list.filter((it) => it !== word) : [...list, word];
      await setFavorites(next);
      return !exists;
    };

    const playAudio = (text: string) => {
      const tts = chromeLike.chrome?.tts;

      if (tts?.speak) {
        tts.stop?.();
        tts.speak(text, { lang: 'ja-JP', rate: 0.9 });
      } else if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ja-JP';
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
      } else {
        console.warn('无可用 TTS');
      }
    };

    const renderTooltipWithAudio = async (text: string, context: SelectionContext) => {
      const html = await furiganaService.convert(text, context);

      overlay.innerHTML = `
        <div class="tooltip-panel">
          <div class="tooltip-body content">${html}</div>
          <div class="tooltip-actions">
            <button class="word-card-btn audio-btn" type="button">播放音频</button>
            <button class="word-card-btn translate-btn" type="button">翻译</button>
            <button class="word-card-btn report-btn" type="button">🚩</button>
          </div>
        </div>
      `;

      overlay.querySelector<HTMLButtonElement>('.audio-btn')?.addEventListener('click', () => {
        playAudio(text);
      });

      overlay.querySelector<HTMLButtonElement>('.translate-btn')?.addEventListener('click', () => {
        openTranslator(text, extensionSettings.translatorEngine);
      });

      overlay.querySelector<HTMLButtonElement>('.report-btn')?.addEventListener('click', () => {
        renderReportModal({
          word: text,
          reportContext: formatReportContext(text, context),
          currentFurigana: html,
        });
      });
    };

    const renderWordCard = async (text: string, context: SelectionContext) => {
      const rubyHtml = await furiganaService.convert(text, context);
      const entityType = furiganaService.getEntityType(text);
      const fav = await isFavorite(text);
      const tagLabel = entityType === 'place'
        ? '地名'
        : entityType === 'person'
          ? '人名'
          : entityType === 'place-or-person'
            ? '地名/人名'
            : '词卡';

      overlay.innerHTML = `
        <div class="word-card">
          <div class="word-card-header">
            <strong class="word-card-word">${text}</strong>
            <span class="word-card-tag">${tagLabel}</span>
          </div>
          <div class="card-furigana">
            ${rubyHtml}
          </div>
          <div class="word-card-actions">
            <button class="word-card-btn audio-btn" type="button">播放音频</button>
            <button class="word-card-btn translate-btn" type="button">翻译</button>
            <button class="word-card-btn favorite-btn ${fav ? 'is-active' : ''}" type="button">${fav ? '已收藏' : '添加收藏'}</button>
            <button class="word-card-btn report-btn" type="button">🚩</button>
          </div>
        </div>
      `;

      overlay.querySelector<HTMLButtonElement>('.audio-btn')?.addEventListener('click', () => {
        playAudio(text);
      });

      overlay.querySelector<HTMLButtonElement>('.translate-btn')?.addEventListener('click', () => {
        openTranslator(text, extensionSettings.translatorEngine);
      });

      overlay.querySelector<HTMLButtonElement>('.favorite-btn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const nowFav = await toggleFavorite(text);
        const btn = overlay.querySelector<HTMLButtonElement>('.favorite-btn');
        if (btn) {
          btn.textContent = nowFav ? '已收藏' : '添加收藏';
          btn.classList.toggle('is-active', nowFav);
        }
      });

      overlay.querySelector<HTMLButtonElement>('.report-btn')?.addEventListener('click', () => {
        renderReportModal({
          word: text,
          reportContext: formatReportContext(text, context),
          currentFurigana: rubyHtml,
        });
      });
    };

    const getSelectionContext = (range: Range): SelectionContext => {
      const startText = range.startContainer.textContent ?? '';
      const endText = range.endContainer.textContent ?? '';

      return {
        prev: startText.slice(Math.max(0, range.startOffset - 5), range.startOffset),
        next: endText.slice(range.endOffset, range.endOffset + 5),
      };
    };

    const formatReportContext = (text: string, context: SelectionContext) => {
      return `${context.prev || '∅'}[${text}]${context.next || '∅'}`;
    };

    const openTranslator = (text: string, engine: TranslatorEngine) => {
      const builder = TRANSLATOR_URL_BUILDERS[engine] ?? TRANSLATOR_URL_BUILDERS.google;
      window.open(builder(text), '_blank', 'noopener,noreferrer');
    };
  },
});

function isExtensionEnabledOnCurrentPage(settings: ExtensionSettings) {
  const host = normalizeHost(window.location.hostname);
  if (!host) return true;

  if (matchesHostList(host, settings.pausedHosts)) {
    return false;
  }

  if (settings.siteAccessMode === 'whitelist') {
    return matchesHostList(host, settings.whitelist);
  }

  return !matchesHostList(host, settings.blacklist);
}

function matchesHostList(host: string, list: string[]) {
  return list.some((item) => {
    const normalized = normalizeHost(item);
    return normalized === host || host.endsWith(`.${normalized}`);
  });
}

function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/^www\./, '');
}
