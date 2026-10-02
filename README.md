# 中英双语谷歌搜索 · Bilingual Google Search

一个 Chrome（Manifest V3）浏览器插件：输入中文自动翻译成英文关键词，同页分屏显示中文和英文搜索结果。

A Chrome (Manifest V3) extension that translates your Chinese queries into English keywords and shows Chinese and English search results side by side.

## 支持的搜索引擎

- Google（google.com / google.com.hk / google.com.tw 等）
- 360 搜索（so.com）
- 百度（baidu.com）
- 必应（bing.com / cn.bing.com）

## 功能

- 在上面任一搜索引擎搜索中文关键词时，结果页自动分成左右两栏：左边中文结果、右边英文结果。
- 右侧是完整的英文搜索结果页（内嵌谷歌/必应英文结果页，和正常搜索一样，可继续翻页、筛选、切换图片/视频等）。
- 点击“↗ 新标签打开”可在浏览器新标签页打开英文搜索结果。
- 点击“⛶ 全屏”切回全屏中文结果；此时右下角会出现“⇄ 分屏”按钮，可再次切回分屏。点击“× 关闭”完全隐藏。
- 在搜索引擎首页搜索框输入中文时，实时预览英文翻译。
- 支持多种翻译服务：Google 翻译（免费）、MyMemory（免费）、DeepL、OpenAI（后两者需 API Key）。
- 英文结果来源：Google 页面内嵌谷歌英文结果页；360 搜索 / 百度 / 必应页面内嵌必应英文结果页。

## 安装

1. 解压 `bilingual-google-search.zip`。
2. 打开 Chrome，地址栏输入 `chrome://extensions` 并回车。
3. 打开右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择解压后的文件夹。
5. 打开 `google.com` 即可使用。

## 使用

1. 在 Google / 360 搜索 / 百度 / 必应 搜索框输入中文并搜索。
2. 页面自动分屏：左边是中文结果，右边是完整的英文结果页。
3. “↗ 新标签打开”在新标签打开英文结果；“⛶ 全屏”切回全屏中文；“× 关闭”完全隐藏。
4. 点击浏览器工具栏上的插件图标，可切换翻译服务、开启/关闭自动分屏、填写 API Key。

## 翻译服务说明

| 服务 | 是否免费 | 说明 |
| --- | --- | --- |
| Google 翻译 | 免费 | 默认选项，调用 `translate.googleapis.com` 的非官方接口，仅建议个人学习使用 |
| MyMemory | 免费 | 无需密钥，每天有请求配额限制 |
| DeepL | 需 Key | 翻译质量较高，需在 deepl.com 申请 API Key（免费版接口为 `api-free.deepl.com`） |
| OpenAI | 需 Key | 需 OpenAI API Key，默认使用 `gpt-4o-mini` 模型 |

## 注意事项

- 插件默认匹配 Google、360 搜索、百度、必应。如需支持其他搜索引擎域名，可在 `manifest.json` 的 `content_scripts.matches` 中自行添加。
- 英文结果解析是“尽力而为”：Google 页面结构可能变化，若解析失败，可使用“↗ 新标签打开”直接查看英文搜索页。
- 抓取英文结果优先使用同源请求，复用你的谷歌会话，可有效避免机器人验证。

## 隐私

- 中文关键词仅发送给你选择的翻译服务用于翻译；插件不会上传任何其他数据。
- 全部代码本地运行，可自行审查。
