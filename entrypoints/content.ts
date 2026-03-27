import '../assets/content.css';
import { furiganaService } from '../util/common';
import { browser } from 'wxt/browser';

const divName = 'my-floating-popup';
const styleId = 'furigana-dynamic-style';

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

    // --- 核心：应用样式的函数 ---
    const applyStyles = (settings: any) => {
      if (!settings) return;

      // A. 设置外层浮层基础样式
      overlay.style.backgroundColor = settings.backgroundColor;
      overlay.style.fontSize = `${settings.fontSize}px`;
      overlay.style.color = settings.textColor;
      
      // 使用 opacity 会让整个插件变透明（包括文字）
      // 如果你只想背景透明，建议在 Popup 用 rgba，这里暂用整体透明度
      overlay.style.opacity = (settings.bgOpacity / 100).toString();

      // B. 动态注入 CSS 来控制 ruby 和 rt 标签
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

    // 2. 初始化：立即从 storage 读取一次配置
    const data = await browser.storage.local.get('tooltipSettings');
    applyStyles(data.tooltipSettings);

    // 3. 监听：实时更新样式
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.tooltipSettings) {
        applyStyles(changes.tooltipSettings.newValue);
      }
    });

    // 4. 监听鼠标抬起
    document.addEventListener('mouseup', async (e) => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0) {
        const range = selection!.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        const data = await browser.storage.local.get('tooltipSettings');
        const settings = data.tooltipSettings;
        
        // 确保显示时样式是最新的
        applyStyles(settings);

        // 位置计算逻辑
        let top = rect.top + window.scrollY - 50; // 稍微多偏移一点
        let left = rect.left + window.scrollX + rect.width / 2;

        if (settings?.position === 'bottom') {
          top = rect.bottom + window.scrollY + 10;
        }

        overlay.style.left = `${left}px`;
        overlay.style.top = `${top}px`;
        // 添加水平居中对齐，防止边缘切断
        overlay.style.transform = 'translateX(-50%)';
        overlay.style.display = 'block';

        try {
          const html = await furiganaService.convert(selectedText);
          overlay.innerHTML = `<div class="content">${html}</div>`;
        } catch (err) {
          overlay.innerHTML = `<div class="error">转换失败</div>`;
        }
      }
    });

    // 点击其他地方隐藏
    document.addEventListener('mousedown', (e) => {
      // 避免点击浮层内部时消失
      if (!(e.target as HTMLElement).closest(`#${divName}`)) {
        overlay.style.display = 'none';
      }
    });
  },
});