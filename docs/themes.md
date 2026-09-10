# 导入主题

在“设置 → 外观”选择本地 `.css` 主题文件。应用先展示亮色、暗色预览和兼容报告，点击“应用主题”后才保存并改变外观。“取消预览”不改变当前主题；“恢复内置主题”删除导入配置的生效状态。

兼容范围是 `:root`、`body`、`.theme-light`、`.theme-dark` 中的通用颜色、语法颜色和本机字体变量，包括变量引用、优先级及亮暗媒体条件。专用于 Obsidian DOM、插件、外部字体或网络资源的规则不进入 InkStream；报告会列出被跳过的规则。原始主题保存在应用配置目录，项目文件夹不会新增主题配置。

实现参考 [Obsidian 变量说明](https://docs.obsidian.md/Reference/CSS%20variables/About%20styling)。主题由独立、未挂载的 CSSStyleSheet 解析，只有校验后的兼容变量映射到工作台。
