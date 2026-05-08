import '../assets/content.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Flag, Languages, LoaderCircle, Pin, PinOff, Star, Volume2 } from 'lucide-react';
import { furiganaService } from '../util/common';
import type { ExtractedPageBlock } from '../util/export-workspace';
import {
  FAVORITES_LIMIT,
  FAVORITES_STORAGE_KEY,
  createFavoriteItem,
  matchFavorite,
  normalizeFavoriteItems,
} from '../util/favorites';
import { browser } from 'wxt/browser';
import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type TooltipSettings,
  type TranslatorEngine,
} from '../types/settings';
import { ErrorReportModal } from './components/ErrorReportModal';
import type { MimeticWordEntry } from '../util/common';

const divName = 'my-floating-popup';
const styleId = 'furigana-dynamic-style';
const reportModalId = 'oye-report-root';
const MAX_TOOLTIP_CHARS = 100;
const WORD_CARD_CHARS = 7;
const TOOLTIP_VIEWPORT_MARGIN = 12;
const TOOLTIP_SELECTION_GAP = 10;
const MIN_TOOLTIP_VIEWPORT_HEIGHT = 160;
const JAPANESE_TEXT_PATTERN = /[\u3040-\u30FF\u31F0-\u31FF\u4E00-\u9FFF]/;
const LUCIDE_ICON_SIZE = 16;
const LUCIDE_ICON_STROKE = 1.5;
type SelectionContext = { prev: string; next: string };
type ReportPayload = { word: string; reportContext: string; currentFurigana: string };
type ReadingTag = 'possible_sokuon' | 'possible_polyphonic' | 'mimetic';

const READING_TAG_LABELS: Record<ReadingTag, string> = {
  possible_sokuon: '促音候选',
  possible_polyphonic: '多音字',
  mimetic: '拟声拟态',
};

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
    const audioIcons = {
      play: createIconMarkup(Volume2),
      loading: createIconMarkup(LoaderCircle, 'oye-icon-spin'),
      translate: createIconMarkup(Languages),
      report: createIconMarkup(Flag),
      favorite: createIconMarkup(Star),
      pin: createIconMarkup(Pin),
      pinOff: createIconMarkup(PinOff),
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
      overlay.style.fontSize = `${settings.fontSize}px`;
      overlay.style.color = settings.textColor;
      overlay.style.padding = '0';
      overlay.style.opacity = '1';
      overlay.style.setProperty('--oye-tooltip-font', `${settings.fontSize}px`);
      overlay.style.setProperty('--oye-tooltip-content-font', `${settings.fontSize + 4}px`);
      const glassOpacity = Math.min(settings.bgOpacity / 100, 0.82);
      overlay.style.setProperty('--oye-tooltip-bg', hexToRgba(settings.backgroundColor, glassOpacity));
      overlay.style.setProperty('--oye-tooltip-text', settings.textColor);
      overlay.style.setProperty('--oye-tooltip-radius', `${settings.borderRadius}px`);
      overlay.style.setProperty('--oye-tooltip-padding', `${settings.padding}px`);
      overlay.style.setProperty(
        '--oye-tooltip-shadow',
        [
          '0 10px 28px rgba(31,43,64,0.08)',
          'inset 0 1px 0 rgba(255,255,255,0.86)',
        ].join(', '),
      );

      let styleTag = document.getElementById(styleId) as HTMLStyleElement;
      if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = styleId;
        document.head.appendChild(styleTag);
      }

      // 通过 CSS 变量或直接写选择器来控制注音样式
      styleTag.innerHTML = `
        #${divName} rt {
          font-size: ${settings.rubySize || 0.58}em !important;
          color: ${settings.rubyColor || '#7c8796'} !important;
          font-weight: ${settings.rubyWeight || 400} !important;
          line-height: 1.08 !important;
          opacity: 0.9;
          letter-spacing: 0;
        }
        #${divName} ruby {
          ruby-align: center;
          ruby-position: over;
          line-height: 1.82;
        }
      `;
    };

    applyStyles(await loadTooltipSettings());
    await loadExtensionSettings();
    primeSpeechSynthesis();

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'extract-page-text') {
      return; 
    }

    // 使用 sendResponse 同步回传数据
    sendResponse({
      title: document.title,
      sourceUrl: window.location.href,
      blocks: extractReadablePageBlocks(),
    });

    return true;
    });

    let suppressNextSelectionRender = false;
    let isPinned = false;
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

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
      if ((e.target as HTMLElement | null)?.closest(`#${divName}`)) {
        return;
      }

      if (suppressNextSelectionRender) {
        suppressNextSelectionRender = false;
        return;
      }

      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() || '';

      if (!selectedText || !selection || selection.rangeCount === 0) {
        overlay.style.display = 'none';
        return;
      }

      if (!extensionSettings.globalEnabled || extensionSettings.furiganaMode === 'disable') {
        overlay.style.display = 'none';
        return;
      }

      if (!isExtensionEnabledOnCurrentPage(extensionSettings)) {
        overlay.style.display = 'none';
        return;
      }

      if (!JAPANESE_TEXT_PATTERN.test(selectedText)) {
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

      if (!isPinned) {
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.transform = 'none';
        overlay.style.position = 'fixed';
        overlay.style.visibility = 'hidden';
        overlay.style.display = 'block';
      } else {
        overlay.style.visibility = 'visible';
        overlay.style.display = 'block';
      }

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

      if (!isPinned) {
        positionOverlayNearSelection(rect, settings.position);
        overlay.style.visibility = 'visible';
      }
    });

    // 点击其他地方隐藏
    document.addEventListener('mousedown', (e) => {
      if (isPinned) {
        return;
      }

      // 避免点击浮层内部时消失
      if (!(e.target as HTMLElement).closest(`#${divName}`)) {
        suppressNextSelectionRender = overlay.style.display !== 'none';
        overlay.style.display = 'none';
        window.getSelection()?.removeAllRanges();
      }
    });

    const getFavorites = async () => {
      const data = await browser.storage.local.get(FAVORITES_STORAGE_KEY);
      return normalizeFavoriteItems(data[FAVORITES_STORAGE_KEY]);
    };

    const setFavorites = async (list: ReturnType<typeof normalizeFavoriteItems>) => {
      await browser.storage.local.set({ [FAVORITES_STORAGE_KEY]: list });
    };

    const isFavorite = async (word: string) => {
      const list = await getFavorites();
      return list.some((item) => matchFavorite(item, { text: word, sourceUrl: window.location.href }));
    };

    const toggleFavorite = async (word: string, context: SelectionContext) => {
      const list = await getFavorites();
      const exists = list.some((item) => matchFavorite(item, { text: word, sourceUrl: window.location.href }));
      if (!exists && list.length >= FAVORITES_LIMIT) {
        window.alert('警告：认知负荷已达上限！不消灭这些“死角”，新知识将无法进入。');
        return { active: false, full: true };
      }

      const next = exists
        ? list.filter((item) => !matchFavorite(item, { text: word, sourceUrl: window.location.href }))
        : [
            createFavoriteItem({
              text: word,
              furigana: await furiganaService.convert(word, context),
              sourceUrl: window.location.href,
              timestamp: Date.now(),
              context: formatReportContext(word, context),
            }),
            ...list,
          ];
      await setFavorites(next);
      return { active: !exists, full: false };
    };

    const playAudio = (text: string, triggerButton?: HTMLButtonElement | null) => {
      const tts = chromeLike.chrome?.tts;
      const volume = Math.max(0, Math.min(extensionSettings.ttsVolume, 1));
      const rate = Math.max(0.5, Math.min(extensionSettings.ttsRate, 2));
      const clearButtonState = () => {
        if (!triggerButton) return;
        setAudioButtonState(triggerButton, false);
      };

      if (tts?.speak) {
        setAudioButtonState(triggerButton, true);
        tts.stop?.();
        tts.speak(text, { lang: 'ja-JP', rate, volume });
        window.setTimeout(clearButtonState, 1200);
      } else if (window.speechSynthesis) {
        setAudioButtonState(triggerButton, true);
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ja-JP';
        utterance.rate = rate;
        utterance.volume = volume;
        utterance.onstart = clearButtonState;
        utterance.onerror = clearButtonState;
        utterance.onend = clearButtonState;
        window.speechSynthesis.speak(utterance);
      } else {
        console.warn('无可用 TTS');
        clearButtonState();
      }
    };

    const setOverlayScreenPosition = (left: number, top: number) => {
      const viewport = getViewportBounds();
      const rect = overlay.getBoundingClientRect();
      const minLeft = viewport.left + TOOLTIP_VIEWPORT_MARGIN;
      const minTop = viewport.top + TOOLTIP_VIEWPORT_MARGIN;
      const maxLeft = Math.max(minLeft, viewport.right - rect.width - TOOLTIP_VIEWPORT_MARGIN);
      const maxTop = Math.max(minTop, viewport.bottom - rect.height - TOOLTIP_VIEWPORT_MARGIN);
      const safeLeft = Math.max(minLeft, Math.min(left, maxLeft));
      const safeTop = Math.max(minTop, Math.min(top, maxTop));
      overlay.style.left = `${safeLeft}px`;
      overlay.style.top = `${safeTop}px`;
    };

    const getViewportBounds = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;

      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
      };
    };

    const constrainOverlayToViewport = () => {
      const viewport = getViewportBounds();
      const maxHeight = Math.max(MIN_TOOLTIP_VIEWPORT_HEIGHT, viewport.height - TOOLTIP_VIEWPORT_MARGIN * 2);
      const maxWidth = Math.max(220, viewport.width - TOOLTIP_VIEWPORT_MARGIN * 2);
      overlay.style.maxHeight = `${maxHeight}px`;
      overlay.style.maxWidth = `${maxWidth}px`;
      overlay.style.overflowY = 'auto';
      overlay.style.overflowX = 'hidden';
    };

    const positionOverlayNearSelection = (
      selectionRect: DOMRect,
      preferredPosition: TooltipSettings['position'],
    ) => {
      constrainOverlayToViewport();
      const tooltipRect = overlay.getBoundingClientRect();
      const viewport = getViewportBounds();
      const fits = {
        top: selectionRect.top - tooltipRect.height - TOOLTIP_SELECTION_GAP >= viewport.top + TOOLTIP_VIEWPORT_MARGIN,
        bottom: selectionRect.bottom + tooltipRect.height + TOOLTIP_SELECTION_GAP <= viewport.bottom - TOOLTIP_VIEWPORT_MARGIN,
        left: selectionRect.left - tooltipRect.width - TOOLTIP_SELECTION_GAP >= viewport.left + TOOLTIP_VIEWPORT_MARGIN,
        right: selectionRect.right + tooltipRect.width + TOOLTIP_SELECTION_GAP <= viewport.right - TOOLTIP_VIEWPORT_MARGIN,
      };
      const opposite: Record<TooltipSettings['position'], TooltipSettings['position']> = {
        top: 'bottom',
        bottom: 'top',
        left: 'right',
        right: 'left',
      };
      const fallbackOrder: TooltipSettings['position'][] = preferredPosition === 'left' || preferredPosition === 'right'
        ? [preferredPosition, opposite[preferredPosition], 'top', 'bottom']
        : [preferredPosition, opposite[preferredPosition], 'right', 'left'];
      const position = fallbackOrder.find((candidate) => fits[candidate]) ?? preferredPosition;
      const selectionCenterX = selectionRect.left + selectionRect.width / 2;
      const selectionCenterY = selectionRect.top + selectionRect.height / 2;

      let left = selectionCenterX - tooltipRect.width / 2;
      let top = selectionRect.top - tooltipRect.height - TOOLTIP_SELECTION_GAP;

      if (position === 'bottom') {
        top = selectionRect.bottom + TOOLTIP_SELECTION_GAP;
      } else if (position === 'left') {
        left = selectionRect.left - tooltipRect.width - TOOLTIP_SELECTION_GAP;
        top = selectionCenterY - tooltipRect.height / 2;
      } else if (position === 'right') {
        left = selectionRect.right + TOOLTIP_SELECTION_GAP;
        top = selectionCenterY - tooltipRect.height / 2;
      }

      setOverlayScreenPosition(left, top);
    };

    const buildCardHeader = (badge: string, rubyHtml = '') => {
      const pinIcon = isPinned ? audioIcons.pinOff : audioIcons.pin;
      const pinLabel = isPinned ? '解除固定' : '固定卡片';

      return `
        <div class="oye-card-header">
          <div class="oye-card-header-main">
            <strong class="oye-card-title">划词日语注音</strong>
            <div class="oye-card-badges">
              <span class="oye-card-badge">${badge}</span>
              ${buildReadingTagBadges(rubyHtml)}
            </div>
          </div>
          <button aria-label="${pinLabel}" class="word-card-btn icon-btn oye-pin-btn ${isPinned ? 'is-pinned' : ''}" title="${pinLabel}" type="button">
            ${buildButtonContent(pinIcon, '')}
          </button>
        </div>
      `;
    };

    const buildReadingTagBadges = (rubyHtml: string) => {
      const tags = extractReadingTags(rubyHtml);
      if (!tags.length) return '';

      return tags.map((tag) => `<span class="oye-card-badge oye-reading-tag">${READING_TAG_LABELS[tag]}</span>`).join('');
    };

    const buildPolyphonicNotice = (rubyHtml: string) => {
      const notices = extractPolyphonicNotices(rubyHtml);
      if (!notices.length) return '';

      return `
        <div class="oye-reading-notices" aria-label="多音字候选">
          ${notices.map(({ index, text, alternatives }) => {
            return `
              <div class="oye-reading-notice" data-reading-index="${index}" data-reading-text="${escapeHtml(text)}">
                <span class="oye-reading-notice-label">其他读音</span>
                <div class="oye-reading-options">
                  ${alternatives.map((reading) => `
                    <button class="oye-reading-option-btn" data-reading-index="${index}" data-reading-text="${escapeHtml(text)}" data-reading-value="${escapeHtml(reading)}" type="button">${escapeHtml(text)}「${escapeHtml(reading)}」</button>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    };

    const attachPolyphonicNoticeActions = () => {
      overlay.querySelectorAll<HTMLButtonElement>('.oye-reading-option-btn').forEach((button) => {
        button.addEventListener('click', () => {
          const index = Number.parseInt(button.dataset.readingIndex ?? '', 10);
          const text = button.dataset.readingText ?? '';
          const reading = button.dataset.readingValue ?? '';
          if (Number.isNaN(index) || !text || !reading) return;

          const ruby = overlay.querySelectorAll<HTMLElement>('ruby[data-reading-alternatives]')[index];
          const rt = ruby?.querySelector('rt');
          if (!rt) return;

          const currentReading = rt.textContent ?? '';
          rt.textContent = reading;
          button.dataset.readingValue = currentReading;
          button.textContent = `${text}「${currentReading}」`;
        });
      });
    };

    const updatePinButtonState = () => {
      const button = overlay.querySelector<HTMLButtonElement>('.oye-pin-btn');
      if (!button) return;

      const label = isPinned ? '解除固定' : '固定卡片';
      button.classList.toggle('is-pinned', isPinned);
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.innerHTML = buildButtonContent(isPinned ? audioIcons.pinOff : audioIcons.pin, '');
    };

    const togglePinnedState = () => {
      const rect = overlay.getBoundingClientRect();
      isPinned = !isPinned;

      if (isPinned) {
        overlay.style.position = 'fixed';
        overlay.style.transform = 'none';
        setOverlayScreenPosition(rect.left, rect.top);
      } else {
        overlay.style.position = 'fixed';
        overlay.style.transform = 'none';
        setOverlayScreenPosition(rect.left, rect.top);
      }

      updatePinButtonState();
    };

    const attachOverlayChrome = () => {
      overlay.querySelector<HTMLButtonElement>('.oye-pin-btn')?.addEventListener('click', (event) => {
        event.preventDefault();
        togglePinnedState();
      });

      const header = overlay.querySelector<HTMLElement>('.oye-card-header');
      header?.addEventListener('pointerdown', (event) => {
        const target = event.target as HTMLElement | null;
        if (!target || target.closest('button')) return;

        if (isPinned) {
          return;
        }

        const rect = overlay.getBoundingClientRect();
        isDragging = true;
        dragOffsetX = event.clientX - rect.left;
        dragOffsetY = event.clientY - rect.top;

        overlay.style.position = 'fixed';
        overlay.style.transform = 'none';
        setOverlayScreenPosition(rect.left, rect.top);
        overlay.classList.add('is-dragging');
        header.setPointerCapture(event.pointerId);
        event.preventDefault();
      });

      header?.addEventListener('pointermove', (event) => {
        if (!isDragging || isPinned) return;
        setOverlayScreenPosition(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
      });

      const endDragging = () => {
        if (!isDragging) return;
        isDragging = false;
        overlay.classList.remove('is-dragging');
      };

      header?.addEventListener('pointerup', endDragging);
      header?.addEventListener('pointercancel', endDragging);
    };

    const renderTooltipWithAudio = async (text: string, context: SelectionContext) => {
      const html = await furiganaService.convert(text, context);
      const polyphonicNotice = buildPolyphonicNotice(html);

      overlay.innerHTML = `
        <div class="tooltip-panel">
          ${buildCardHeader('句子', html)}
          <div class="tooltip-body content">${html}</div>
          ${polyphonicNotice}
          <div class="tooltip-footer-actions">
            <button aria-label="翻译" class="word-card-btn icon-btn translate-btn" title="翻译" type="button">${buildButtonContent(audioIcons.translate, '')}</button>
            <button aria-label="播放音频" class="word-card-btn icon-btn audio-btn" title="播放音频" type="button">${buildButtonContent(audioIcons.play, '')}</button>
            <button aria-label="错误反馈" class="word-card-btn icon-btn report-btn" title="错误反馈" type="button">${buildButtonContent(audioIcons.report, '')}</button>
          </div>
        </div>
      `;

      attachOverlayChrome();
      attachPolyphonicNoticeActions();

      overlay.querySelector<HTMLButtonElement>('.audio-btn')?.addEventListener('click', (event) => {
        playAudio(text, event.currentTarget as HTMLButtonElement);
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

      if (extensionSettings.autoPlayAudio) {
        playAudio(text);
      }
    };

    const renderWordCard = async (text: string, context: SelectionContext) => {
      const rubyHtml = await furiganaService.convert(text, context);
      const polyphonicNotice = buildPolyphonicNotice(rubyHtml);
      const entityType = furiganaService.getEntityType(text);
      const mimeticEntry = furiganaService.getMimeticEntry(text);
      const fav = await isFavorite(text);
      const favoriteItems = await getFavorites();
      const inboxFull = !fav && favoriteItems.length >= FAVORITES_LIMIT;
      const mimeticNote = mimeticEntry ? buildMimeticNote(mimeticEntry) : '';
      const tagLabel = mimeticEntry
        ? '拟态词'
        : entityType === 'place'
        ? '地名'
        : entityType === 'person'
          ? '人名'
          : entityType === 'place-or-person'
            ? '地名/人名'
            : '词卡';

      overlay.innerHTML = `
        <div class="word-card">
          ${buildCardHeader(tagLabel, mimeticEntry ? '' : rubyHtml)}
          <div class="card-furigana-row">
            <div class="card-furigana">
            ${rubyHtml}
            </div>
          </div>
          ${mimeticNote}
          ${polyphonicNotice}
          <div class="word-card-bottom-actions">
            <button aria-label="翻译" class="word-card-btn icon-btn translate-btn" title="翻译" type="button">${buildButtonContent(audioIcons.translate, '')}</button>
            <button aria-label="${fav ? '取消收藏' : inboxFull ? '收藏已满' : '添加收藏'}" class="word-card-btn icon-btn favorite-btn ${fav ? 'is-active' : ''}" title="${fav ? '取消收藏' : inboxFull ? '收藏已满，请先清理 Inbox' : '添加收藏'}" type="button" ${inboxFull ? 'data-full="true"' : ''}>${buildButtonContent(audioIcons.favorite, '')}</button>
            <button aria-label="播放音频" class="word-card-btn icon-btn audio-btn" title="播放音频" type="button">${buildButtonContent(audioIcons.play, '')}</button>
            <button aria-label="错误反馈" class="word-card-btn icon-btn report-btn" title="错误反馈" type="button">${buildButtonContent(audioIcons.report, '')}</button>
          </div>
        </div>
      `;

      attachOverlayChrome();
      attachPolyphonicNoticeActions();

      overlay.querySelector<HTMLButtonElement>('.audio-btn')?.addEventListener('click', (event) => {
        playAudio(text, event.currentTarget as HTMLButtonElement);
      });

      overlay.querySelector<HTMLButtonElement>('.translate-btn')?.addEventListener('click', () => {
        openTranslator(text, extensionSettings.translatorEngine);
      });

      overlay.querySelector<HTMLButtonElement>('.favorite-btn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const result = await toggleFavorite(text, context);
        if (result.full) {
          return;
        }
        const btn = overlay.querySelector<HTMLButtonElement>('.favorite-btn');
        if (btn) {
          btn.classList.toggle('is-active', result.active);
          btn.setAttribute('aria-label', result.active ? '取消收藏' : '添加收藏');
          btn.setAttribute('title', result.active ? '取消收藏' : '添加收藏');
        }
      });

      overlay.querySelector<HTMLButtonElement>('.report-btn')?.addEventListener('click', () => {
        renderReportModal({
          word: text,
          reportContext: formatReportContext(text, context),
          currentFurigana: rubyHtml,
        });
      });

      if (extensionSettings.autoPlayAudio) {
        playAudio(text);
      }
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

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const safeHex = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  const red = Number.parseInt(safeHex.slice(0, 2), 16);
  const green = Number.parseInt(safeHex.slice(2, 4), 16);
  const blue = Number.parseInt(safeHex.slice(4, 6), 16);

  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function createIconMarkup(Icon: typeof Volume2, className = '') {
  return renderToStaticMarkup(
    React.createElement(Icon, {
      className,
      size: LUCIDE_ICON_SIZE,
      strokeWidth: LUCIDE_ICON_STROKE,
    }),
  );
}

function buildButtonContent(iconMarkup: string, label: string) {
  return `
    <span class="oye-btn-inner">
      <span class="oye-btn-icon">${iconMarkup}</span>
      ${label ? `<span class="oye-btn-label">${label}</span>` : ''}
    </span>
  `;
}

function extractReadingTags(rubyHtml: string): ReadingTag[] {
  const tags = new Set<ReadingTag>();
  const matches = rubyHtml.matchAll(/data-reading-tags="([^"]+)"/g);

  for (const match of matches) {
    const values = (match[1] ?? '').split(/\s+/);
    for (const value of values) {
      if (isReadingTag(value)) {
        tags.add(value);
      }
    }
  }

  return [...tags];
}

function extractPolyphonicNotices(rubyHtml: string): Array<{ index: number; text: string; alternatives: string[] }> {
  const template = document.createElement('template');
  template.innerHTML = rubyHtml;

  return [...template.content.querySelectorAll('ruby[data-reading-alternatives]')]
    .map((ruby, index) => {
      const alternatives = (ruby.getAttribute('data-reading-alternatives') ?? '')
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean);
      if (!alternatives.length) return null;

      const clone = ruby.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('rt').forEach((rt) => rt.remove());
      const text = clone.textContent?.trim() ?? '';
      if (!text) return null;

      return {
        index,
        text,
        alternatives: [...new Set(alternatives)],
      };
    })
    .filter((notice): notice is { index: number; text: string; alternatives: string[] } => Boolean(notice));
}

function isReadingTag(value: string): value is ReadingTag {
  return value === 'possible_sokuon' || value === 'possible_polyphonic' || value === 'mimetic';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMimeticNote(entry: MimeticWordEntry) {
  const reading = entry.reading ? `<span class="oye-mimetic-reading">${escapeHtml(entry.reading)}</span>` : '';
  const tags = entry.tags?.length
    ? `<div class="oye-mimetic-tags">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';
  const example = entry.example ? `<p class="oye-mimetic-example">${escapeHtml(entry.example)}</p>` : '';

  return `
    <div class="oye-mimetic-note">
      <div class="oye-mimetic-note-head">
        <span class="oye-mimetic-label">释义</span>
        ${reading}
      </div>
      <p class="oye-mimetic-meaning">${escapeHtml(entry.meaning)}</p>
      ${tags}
      ${example}
    </div>
  `;
}

function setAudioButtonState(button: HTMLButtonElement | null | undefined, loading: boolean) {
  if (!button) return;

  button.disabled = loading;
  button.innerHTML = loading
    ? buildButtonContent(createIconMarkup(LoaderCircle, 'oye-icon-spin'), '')
    : buildButtonContent(createIconMarkup(Volume2), '');
}

function primeSpeechSynthesis() {
  if (!window.speechSynthesis) return;

  window.speechSynthesis.getVoices();
  const handleVoicesChanged = () => {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
  };

  window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
}

function extractReadablePageBlocks(): ExtractedPageBlock[] {
  const root = pickReadableRoot();
  const elements = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, p, li, blockquote, figcaption'));
  const seen = new Set<string>();
  const blocks = elements
    .filter((element) => isReadableElement(element))
    .map((element, index) => {
      const text = collapseWhitespace(element.innerText || element.textContent || '');
      if (!text || seen.has(text)) return null;
      seen.add(text);

      return {
        id: `block-${index}`,
        kind: mapElementToBlockKind(element.tagName.toLowerCase()),
        text,
      } satisfies ExtractedPageBlock;
    })
    .filter((item): item is ExtractedPageBlock => item !== null);

  if (blocks.length) {
    return blocks;
  }

  console.log(blocks)
  return collapseWhitespace(root.innerText)
    .split(/\n+/)
    .map((text) => text.trim())
    .filter((text) => text.length > 15 && JAPANESE_TEXT_PATTERN.test(text))
    .slice(0, 40)
    .map((text, index) => ({
      id: `fallback-${index}`,
      kind: index === 0 ? 'title' : 'paragraph',
      text,
    }));
}

function pickReadableRoot() {
  const prioritySelectors = [
    'main',
    'article',
    '[role="main"]',
    '#main',
    '#content',
    '.main',
    '.content',
    '.article',
    '.post-content',
    '.entry-content',
  ];

  for (const selector of prioritySelectors) {
    const matched = document.querySelector<HTMLElement>(selector);
    if (matched && collapseWhitespace(matched.innerText).length > 80) {
      return matched;
    }
  }

  const candidates = Array.from(document.body.querySelectorAll<HTMLElement>('section, div, article'));
  const scored = candidates
    .filter((element) => isReadableElement(element))
    .map((element) => ({
      element,
      score: countJapaneseChars(element.innerText) + element.querySelectorAll('p').length * 24,
    }))
    .sort((left, right) => right.score - left.score);

  return scored[0]?.element ?? document.body;
}

function isReadableElement(element: HTMLElement) {
  if (!element.isConnected) return false;
  if (element.closest('header, footer, nav, aside, form, dialog, [aria-hidden="true"]')) return false;
  if (element.closest('#my-floating-popup, #oye-report-root')) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  const text = collapseWhitespace(element.innerText || element.textContent || '');
  if (text.length < 8 || !JAPANESE_TEXT_PATTERN.test(text)) return false;

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function mapElementToBlockKind(tagName: string): ExtractedPageBlock['kind'] {
  if (tagName === 'h1') return 'title';
  if (tagName === 'h2' || tagName === 'h3' || tagName === 'h4') return 'subtitle';
  if (tagName === 'blockquote') return 'quote';
  if (tagName === 'li') return 'list-item';
  return 'paragraph';
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function countJapaneseChars(value: string) {
  return Array.from(value).filter((char) => JAPANESE_TEXT_PATTERN.test(char)).length;
}
