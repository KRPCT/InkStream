# InkStream 官网

用户已确认的 A「白昼研究室」方向。此目录为独立的静态站点，不进入桌面应用构建。

在本目录运行 `python -m http.server 8080 --bind 127.0.0.1` 后预览，结束时按 Ctrl+C。无需安装额外前端依赖。`daylight.js` 提供移动导航、应用截图的可访问标签切换，以及公开 GitHub 稳定发行版查询；查询失败、数据不完整或地址不可信时保留内置的 2.1.0 下载链接。

生产文件为 index.html、daylight.css、daylight.js、robots.txt、sitemap.xml 和 assets/。部署到现有站点时保留 Google、百度、Bing 验证文件及原锚点兼容；现有旧资源可保留用于缓存兼容。README 和本地验收、部署资料不作为网站页面发布。

主视觉与亚克力材质图由内置 image_gen 生成，依据用户批准的 A 稿重新制作独立无字素材。应用图标复用原始 SVG；工作台图片为真实 Windows 界面的示例内容。Noto Serif SC 标题字体自托管，按 SIL Open Font License 1.1 提供，许可见 assets/fonts/OFL.txt；其余文字使用系统字体。素材来源与摘要见 assets/SOURCES.json。

本次交互与发布核验围绕站点自身进行：导航、键盘标签、窄屏溢出、减少动效、无 JavaScript 回退、稳定版更新与失败回退、资源和下载地址。它们不替代桌面软件的外部账号、物理输入法或完整平台验收。
