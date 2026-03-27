import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    web_accessible_resources: [{
      resources: ["json/kanji-jouyou.json"],
      matches: ["<all_urls>"]
    }],
    permissions: ['tabs', 'activeTab'], // activeTab 允许你在点击插件图标时获取当前页信息
    name: '漢字furigana',
  },
});
