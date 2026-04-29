import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    web_accessible_resources: [{
      resources: ["json/kanji-jouyou.json","json/fixed-readings.json","json/family-names.json"],
      matches: ["<all_urls>"]
    }],
    host_permissions: ['https://cdn.jsdelivr.net/*'],
    permissions: ['tabs', 'activeTab','storage'], // activeTab 允许你在点击插件图标时获取当前页信息
    name: '日语划词注音',
    version: "1.1.0",
  },
  runner:{
    startUrls: ['https://note.com/kashimura_pr/n/n4c2e1c0e5ccb#4f162dc3-21f8-45d5-80e9-7e003bae578e'],
    chromiumArgs: [
      '--start-maximized',       // 窗口启动时最大化 (类似全屏)
      '--auto-open-devtools-for-tabs', // 自动为每个标签页打开控制台
    ],
  },
});
