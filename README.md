# Furigana Extension

<img width="906" height="1228" alt="image" src="https://github.com/user-attachments/assets/49a109b2-d305-4ae1-982a-6f2066ef2c70" />

---

## English

Furigana Extension is a browser extension for Japanese learners. It lets users select Japanese text on any webpage and instantly view furigana readings in a floating card, with extra learning tools for pronunciation, vocabulary review, translation, and reading practice.

### Features

- Select Japanese text on a webpage to show furigana readings.
- Smart reading conversion for kanji, okurigana, numeric counters, fixed readings, names, places, and mimetic words.
- Floating word cards with pronunciation playback, pinning, favorites, translation links, and reading issue reporting.
- Customizable tooltip appearance, including position, font size, ruby style, colors, padding, opacity, and presets.
- Global enable/disable controls and per-site blacklist/whitelist policies.
- Text-to-speech options for Japanese playback, including volume, speed, and auto-play settings.
- Favorite word management for repeated review.
- Export workspace for extracting readable page text and printing or reviewing it with furigana.
- Beginner learning dashboard covering kana, basic grammar, reading basics, conjugation, and mimetic words.

### Tech Stack

- WXT for browser extension development.
- React 19 and React DOM for popup, dashboard, and extension UI.
- TypeScript for type-safe application code.
- WebExtension APIs via `wxt/browser` for tabs, storage, content scripts, and runtime messaging.
- `wanakana` for Japanese kana conversion utilities.
- `kuroshiro-analyzer-kuromoji` and custom dictionary data for Japanese reading support.
- Lucide React for UI icons.
- Vitest for furigana conversion tests.
- pnpm for package management.

### Download

Install the extension from the Chrome Web Store:

[Install from Chrome Web Store](https://chromewebstore.google.com/detail/%E6%97%A5%E8%AF%AD%E5%88%92%E8%AF%8D%E6%B3%A8%E9%9F%B3/mojjdkehfhaaeinnbajdbjdeopkeecdg)

Packaged builds are also available from the **Releases** section of this repository:

[Download from Releases](https://github.com/amehito/furigana/releases)

### Local Installation

For Chrome, install directly from the Chrome Web Store link above.

If you download a zip package from Releases:

1. Extract the downloaded package.
2. Open your browser extension management page, such as `chrome://extensions/` or `edge://extensions/`.
3. Enable developer mode.
4. Choose "Load unpacked" and select the extracted extension folder.

### Development

```bash
pnpm install
pnpm dev
```

Other useful commands:

```bash
pnpm build
pnpm test
pnpm compile
pnpm zip
```

---

## 日本語

Furigana Extension は、日本語学習者向けのブラウザ拡張機能です。Web ページ上の日本語テキストを選択すると、ふりがな付きの読みをフローティングカードで表示し、発音確認、単語保存、翻訳、読解練習までサポートします。

### 主な機能

- Web ページ上で選択した日本語テキストにふりがなを表示。
- 漢字、送り仮名、数字と助数詞、固定読み、人名、地名、擬声語・擬態語などに対応した読み変換。
- 発音再生、カード固定、お気に入り登録、翻訳リンク、読み間違い報告に対応したフローティングカード。
- 表示位置、文字サイズ、ルビのスタイル、色、余白、透明度、プリセットを含むツールチップのカスタマイズ。
- 拡張機能全体のオン/オフと、サイトごとのブラックリスト・ホワイトリスト管理。
- 音量、速度、自動再生を含む日本語 Text-to-Speech 設定。
- 復習用のお気に入り単語管理。
- Web ページ本文を抽出し、ふりがな付きで確認・印刷できるエクスポートワークスペース。
- 五十音、基礎文法、数字・単位・記号、活用、擬態語を学べる初心者向けダッシュボード。

### 技術スタック

- ブラウザ拡張開発フレームワークとして WXT を使用。
- Popup、Dashboard、拡張 UI に React 19 と React DOM を使用。
- 型安全な実装のために TypeScript を使用。
- `wxt/browser` 経由で tabs、storage、content scripts、runtime messaging などの WebExtension API を利用。
- 日本語かな変換ユーティリティとして `wanakana` を使用。
- 日本語の読み推定のために `kuroshiro-analyzer-kuromoji` と独自辞書データを使用。
- UI アイコンに Lucide React を使用。
- ふりがな変換ロジックのテストに Vitest を使用。
- パッケージ管理に pnpm を使用。

### ダウンロード

Chrome Web Store からインストールできます。

[Chrome Web Store からインストール](https://chromewebstore.google.com/detail/%E6%97%A5%E8%AF%AD%E5%88%92%E8%AF%8D%E6%B3%A8%E9%9F%B3/mojjdkehfhaaeinnbajdbjdeopkeecdg)

ビルド済みパッケージは、本リポジトリの **Releases** からもダウンロードできます。

[Releases からダウンロード](https://github.com/amehito/furigana/releases)

### ローカルインストール

Chrome の場合は、上記の Chrome Web Store リンクから直接インストールできます。

Releases から zip パッケージをダウンロードした場合:

1. ダウンロードしたパッケージを解凍します。
2. `chrome://extensions/` や `edge://extensions/` など、ブラウザの拡張機能管理ページを開きます。
3. デベロッパーモードを有効にします。
4. 「パッケージ化されていない拡張機能を読み込む」を選び、解凍したフォルダを指定します。

### 開発

```bash
pnpm install
pnpm dev
```

その他の便利なコマンド:

```bash
pnpm build
pnpm test
pnpm compile
pnpm zip
```

---

## 中文

Furigana Extension 是一个面向日语学习者的浏览器插件。用户可以在任意网页中划选日语文本，插件会立即显示带假名标注的浮层卡片，并提供朗读、收藏、翻译、阅读练习等辅助学习功能。

### 主要功能

- 在网页中划选日语文本后显示假名标注。
- 支持汉字、送假名、数字量词、固定读法、人名、地名、拟声拟态词等场景的读音处理。
- 浮层单词卡支持朗读、固定、收藏、翻译跳转和读音问题反馈。
- 可自定义提示卡的位置、字号、ruby 样式、颜色、内边距、透明度和预设主题。
- 支持全局启用/暂停，以及按站点设置黑名单或白名单。
- 支持日语文字转语音，可调整音量、语速和自动朗读。
- 收藏单词管理，方便集中复习。
- 可提取网页正文，进入带假名标注的导出工作台进行阅读、整理和打印。
- 内置学习面板，包含五十音图、基础语法、数字单位符号、日语变形和拟态语内容。

### 技术栈

- 使用 WXT 开发浏览器扩展。
- 使用 React 19 和 React DOM 构建 popup、dashboard 和扩展界面。
- 使用 TypeScript 编写类型安全的应用逻辑。
- 通过 `wxt/browser` 使用 tabs、storage、content scripts、runtime messaging 等 WebExtension API。
- 使用 `wanakana` 处理日语假名转换。
- 使用 `kuroshiro-analyzer-kuromoji` 和自定义词典数据辅助日语读音处理。
- 使用 Lucide React 提供界面图标。
- 使用 Vitest 测试假名转换逻辑。
- 使用 pnpm 管理依赖和脚本。

### 下载

可以从 Chrome Web Store 安装插件：

[从 Chrome Web Store 安装](https://chromewebstore.google.com/detail/%E6%97%A5%E8%AF%AD%E5%88%92%E8%AF%8D%E6%B3%A8%E9%9F%B3/mojjdkehfhaaeinnbajdbjdeopkeecdg)

也可以在本仓库的 **Releases** 区域下载打包版本：

[从 Releases 下载](https://github.com/amehito/furigana/releases)

### 安装教程

Chrome 用户可以直接通过上方的 Chrome Web Store 链接安装。

如果需要手动安装，也可以参考对应浏览器的扩展安装教程：

- [Chrome 插件安装教程](https://support.google.com/chrome/answer/2664769?hl=zh-Hans)
- [Microsoft Edge 插件安装教程](https://support.microsoft.com/zh-cn/microsoft-edge/%E5%9C%A8-microsoft-edge-%E4%B8%AD%E6%B7%BB%E5%8A%A0-%E5%85%B3%E9%97%AD%E6%88%96%E5%88%A0%E9%99%A4%E6%89%A9%E5%B1%95-9c0ec68c-2fbc-2f2c-9ff0-bdc76f46b026)
- [QQ 浏览器插件安装教程](https://www.php.cn/faq/1513493.html)
- [Firefox 附加组件安装教程](https://support.mozilla.org/zh-CN/kb/find-and-install-add-ons-add-features-to-firefox)
- [360 浏览器扩展中心](https://ext.chrome.360.cn/)

### 本地安装提示

如果下载的是压缩包形式的安装包，通常可以按下面方式安装：

1. 解压下载的插件压缩包。
2. 打开浏览器的扩展管理页面，例如 `chrome://extensions/` 或 `edge://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择刚才解压后的文件夹。

不同浏览器的菜单名称可能略有差异，请以对应浏览器的安装教程为准。

### 本地开发

```bash
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm build
pnpm test
pnpm compile
pnpm zip
```
