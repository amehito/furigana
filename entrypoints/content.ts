import '../assets/content.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Flag, Languages, LoaderCircle, Pin, PinOff, Star, Volume2 } from 'lucide-react';
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
const LUCIDE_ICON_SIZE = 16;
const LUCIDE_ICON_STROKE = 1.5;
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
    const audioIcons = {
      play: createIconMarkup(Volume2),
      loading: createIconMarkup(LoaderCircle, 'weicheng-icon-spin'),
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
      overlay.style.setProperty('--weicheng-tooltip-font', `${settings.fontSize}px`);
      overlay.style.setProperty('--weicheng-tooltip-content-font', `${settings.fontSize + 4}px`);
      overlay.style.setProperty('--weicheng-tooltip-bg', hexToRgba(settings.backgroundColor, settings.bgOpacity / 100));
      overlay.style.setProperty('--weicheng-tooltip-text', settings.textColor);
      overlay.style.setProperty('--weicheng-tooltip-radius', `${settings.borderRadius}px`);
      overlay.style.setProperty('--weicheng-tooltip-padding', `${settings.padding}px`);
      overlay.style.setProperty('--weicheng-tooltip-shadow', '0 10px 25px -5px rgba(0,0,0,0.1)');

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
          letter-spacing: 0.01em;
        }
        #${divName} ruby {
          ruby-align: center;
          ruby-position: over;
          line-height: 1.95;
        }
      `;
    };

    applyStyles(await loadTooltipSettings());
    await loadExtensionSettings();
    primeSpeechSynthesis();

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

      if (!isPinned) {
        overlay.style.left = `${left}px`;
        overlay.style.top = `${top}px`;
        overlay.style.transform = 'translateX(-50%)';
        overlay.style.position = 'absolute';
        overlay.style.display = 'block';
      } else {
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
      const safeLeft = Math.max(12, Math.min(left, window.innerWidth - 24));
      const safeTop = Math.max(12, Math.min(top, window.innerHeight - 24));
      overlay.style.left = `${safeLeft}px`;
      overlay.style.top = `${safeTop}px`;
    };

    const buildCardHeader = (badge: string) => {
      const pinIcon = isPinned ? audioIcons.pinOff : audioIcons.pin;
      const pinLabel = isPinned ? '解除固定' : '固定卡片';

      return `
        <div class="weicheng-card-header">
          <div class="weicheng-card-header-main">
            <strong class="weicheng-card-title">划词日语</strong>
            <span class="weicheng-card-badge">${badge}</span>
          </div>
          <button aria-label="${pinLabel}" class="word-card-btn icon-btn weicheng-pin-btn ${isPinned ? 'is-pinned' : ''}" title="${pinLabel}" type="button">
            ${buildButtonContent(pinIcon, '')}
          </button>
        </div>
      `;
    };

    const updatePinButtonState = () => {
      const button = overlay.querySelector<HTMLButtonElement>('.weicheng-pin-btn');
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
      overlay.querySelector<HTMLButtonElement>('.weicheng-pin-btn')?.addEventListener('click', (event) => {
        event.preventDefault();
        togglePinnedState();
      });

      const header = overlay.querySelector<HTMLElement>('.weicheng-card-header');
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

      overlay.innerHTML = `
        <div class="tooltip-panel">
          ${buildCardHeader('句子')}
          <div class="tooltip-body content">${html}</div>
          <div class="tooltip-footer-actions">
            <button aria-label="翻译" class="word-card-btn icon-btn translate-btn" title="翻译" type="button">${buildButtonContent(audioIcons.translate, '')}</button>
            <button aria-label="播放音频" class="word-card-btn icon-btn audio-btn" title="播放音频" type="button">${buildButtonContent(audioIcons.play, '')}</button>
            <button aria-label="错误反馈" class="word-card-btn icon-btn report-btn" title="错误反馈" type="button">${buildButtonContent(audioIcons.report, '')}</button>
          </div>
        </div>
      `;

      attachOverlayChrome();

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
          ${buildCardHeader(tagLabel)}
          <div class="card-furigana-row">
            <div class="card-furigana">
            ${rubyHtml}
            </div>
          </div>
          <div class="word-card-bottom-actions">
            <button aria-label="翻译" class="word-card-btn icon-btn translate-btn" title="翻译" type="button">${buildButtonContent(audioIcons.translate, '')}</button>
            <button aria-label="${fav ? '取消收藏' : '添加收藏'}" class="word-card-btn icon-btn favorite-btn ${fav ? 'is-active' : ''}" title="${fav ? '取消收藏' : '添加收藏'}" type="button">${buildButtonContent(audioIcons.favorite, '')}</button>
            <button aria-label="播放音频" class="word-card-btn icon-btn audio-btn" title="播放音频" type="button">${buildButtonContent(audioIcons.play, '')}</button>
            <button aria-label="错误反馈" class="word-card-btn icon-btn report-btn" title="错误反馈" type="button">${buildButtonContent(audioIcons.report, '')}</button>
          </div>
        </div>
      `;

      attachOverlayChrome();

      overlay.querySelector<HTMLButtonElement>('.audio-btn')?.addEventListener('click', (event) => {
        playAudio(text, event.currentTarget as HTMLButtonElement);
      });

      overlay.querySelector<HTMLButtonElement>('.translate-btn')?.addEventListener('click', () => {
        openTranslator(text, extensionSettings.translatorEngine);
      });

      overlay.querySelector<HTMLButtonElement>('.favorite-btn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const nowFav = await toggleFavorite(text);
        const btn = overlay.querySelector<HTMLButtonElement>('.favorite-btn');
        if (btn) {
          btn.classList.toggle('is-active', nowFav);
          btn.setAttribute('aria-label', nowFav ? '取消收藏' : '添加收藏');
          btn.setAttribute('title', nowFav ? '取消收藏' : '添加收藏');
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
    <span class="weicheng-btn-inner">
      <span class="weicheng-btn-icon">${iconMarkup}</span>
      ${label ? `<span class="weicheng-btn-label">${label}</span>` : ''}
    </span>
  `;
}

function setAudioButtonState(button: HTMLButtonElement | null | undefined, loading: boolean) {
  if (!button) return;

  button.disabled = loading;
  button.innerHTML = loading
    ? buildButtonContent(createIconMarkup(LoaderCircle, 'weicheng-icon-spin'), '')
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
