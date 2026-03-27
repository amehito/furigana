import '../assets/content.css';
import { furiganaService } from '../util/common';



export default defineContentScript({
  matches: ['<all_urls>'], // 允许在所有网页运行
  main(ctx) {
    console.log('🚀 WXT Content Script 已加载！');
    // 1. 创建浮层元素
    const overlay = document.createElement('div');
    overlay.id = 'my-floating-popup';
    overlay.style.display = 'none';
    overlay.innerText = '捕捉成功！';
    document.body.appendChild(overlay);

    // 2. 监听鼠标抬起
    document.addEventListener('mouseup', async (e) => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0) {
        // 3. 获取选中文字的矩形区域
        const range = selection!.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // 4. 计算并设置浮层位置 (在选中文字上方)
        overlay.style.left = `${rect.left + rect.width / 2}px`;
        overlay.style.top = `${rect.top + window.scrollY - 40}px`; // 向上偏移 40px
        overlay.style.display = 'block';
        
        console.log('选中的文字是:', selectedText);


        try {
              const html = await furiganaService.convert(selectedText);
              console.log(html)
              overlay.innerHTML = `<div class="content">${html}</div>`;
            } catch (e) {
              overlay.innerHTML = `<div class="error">转换失败</div>`;
            }
      } else {
        overlay.style.display = 'none';
      }
    });

    // 点击其他地方隐藏
    document.addEventListener('mousedown', (e) => {
      if (!(e.target as HTMLElement).closest('#my-floating-popup')) {
        overlay.style.display = 'none';
      }
    });
  },
});