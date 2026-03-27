import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    web_accessible_resources: [{
      resources: ["json/kanji-jouyou.json"],
      matches: ["<all_urls>"]
    }],
    permissions: ['tabs', 'activeTab','storage'], // activeTab 允许你在点击插件图标时获取当前页信息
    name: '漢字furigana',
  },
  runner:{
// 1. 设置自动打开的网站 (例如 NHK 新闻，方便测试日语注音)
    startUrls: ['https://note.com/kashimura_pr/n/n4c2e1c0e5ccb#4f162dc3-21f8-45d5-80e9-7e003bae578e'],
    
    // 2. 传递给 Chrome 的启动参数
    binaries: {
      // 如果你想指定特定浏览器路径可以写在这里，通常不需要
    },
    args: [
      '--start-maximized',       // 窗口启动时最大化 (类似全屏)
      '--auto-open-devtools-for-tabs', // 自动为每个标签页打开控制台
      // '--window-size=1920,1080',   // 或者指定精确的分辨率
    ],
  },
  imports: {
    addons: {
      webextensionPolyfill: true,
    },
  },
});
