import { H, K, P, Steps, Tip } from './helpPrimitives';

/**
 * 帮助/教程内容（簇③）：快速上手 + git 版本管理 / 分支 / 多设备同步 / 快捷键。
 * 写作辅助、阅读、书架、导出等功能分区见 helpFeatures.tsx。文案非拟人化、贴合 InkStream 实际 UI。
 */

export function StartSection() {
  return (
    <div>
      <H>打开工作区</H>
      <P>InkStream 以「文件夹」为工作区。点侧栏或编辑区的「打开文件夹」选择一个目录，里面的 Markdown 文件即出现在文件树。也可直接「打开文件」，或把文件拖进窗口。</P>
      <H>三种模式</H>
      <P>顶部菜单「视图 ▸ 模式」在 Standard（通用）、Academic（学术）、Creative（长篇创作）间切换。模式只改变布局预设与功能集，文档内容与格式不变。</P>
      <H>写作与保存</H>
      <Steps
        items={[
          <>编辑即写，默认自动保存（可在 <K>Ctrl+,</K> 设置 ▸ 编辑器中关闭）。</>,
          <>关闭自动保存后，标签页显示未保存标记，按 <K>Ctrl+S</K> 手动保存。</>,
          <>任意时刻文档磁盘内容就是真相源，不绑定专有格式。</>,
        ]}
      />
      <H>轻装上阵：简易模式</H>
      <P>只想要一个干净的纯文本编辑器？在 设置 ▸ 通用 ▸「简易模式」一键收起反链 / 知识图谱 / Git / Zotero / 搜索等全部高级功能，也不在工作区建索引文件夹。随时可关，关闭即恢复全部功能。</P>
      <Tip>左侧主题里还有：写作辅助（打字机 / 专注 / 写作 HUD）、阅读模式、书架、文件导出，以及 git 版本管理与多设备同步。把工作区初始化为 git 仓库即可获得版本历史、回滚、分支与多设备同步。</Tip>
    </div>
  );
}

export function VersioningSection() {
  return (
    <div>
      <H>什么是版本管理</H>
      <P>git 把每次「提交（commit）」记成版本历史里的一个快照。你可以随时查看、对比、回到任意历史版本。InkStream 内置 git，无需命令行。</P>
      <H>初始化与查看</H>
      <Steps
        items={[
          <>若工作区不是 git 仓库，侧栏会提示初始化；初始化后，左侧出现「源代码管理」面板。</>,
          <>点左下角状态栏的分支名，进入 <strong>Git Graph</strong> 视图查看完整提交历史（再点退出）。</>,
        ]}
      />
      <H>提交（记录一个版本）</H>
      <Steps
        items={[
          <>在侧栏「源代码管理」面板里看到本次更改的文件列表。</>,
          <>在提交框写一句说明（建议 Conventional Commits，如 <K>feat: 新增章节</K>），点「提交」。</>,
          <>提交会被 SSH 签名（GitHub 上显示 Verified）。</>,
        ]}
      />
      <H>回滚版本</H>
      <P>在 Git Graph 里右键某个历史提交，有两种回退方式：</P>
      <Steps
        items={[
          <><strong>撤销此提交（revert）</strong>：生成一个反向提交来抵消它，<strong>保留历史</strong>。已分享/已推送的提交用这种，安全。</>,
          <><strong>重置当前分支到此（reset）</strong>：把分支指针移回该提交。Soft 保留改动与暂存、Mixed 保留改动、<strong>Hard 丢弃此后所有改动（不可恢复，需确认）</strong>。本地未分享时用。</>,
        ]}
      />
      <Tip>不确定就用 revert——它不改写历史，最安全。reset --hard 会丢未提交改动，三思。</Tip>
    </div>
  );
}

export function BranchingSection() {
  return (
    <div>
      <H>为什么用分支</H>
      <P>分支是一条独立的提交线。在分支上试验或写新章节，不影响主线；满意后再合并回去。</P>
      <H>创建与切换</H>
      <Steps
        items={[
          <>Git Graph 里右键某提交 ▸「在此创建分支…」，输入分支名即创建并切过去。</>,
          <>右键某分支徽章 ▸「切换到此分支」在分支间切换。</>,
          <>切换时若有未提交改动且冲突，会提示先提交/暂存，或明确选择丢弃。</>,
        ]}
      />
      <H>合并分支</H>
      <Steps
        items={[
          <>切到要合入的目标分支（如 main）。</>,
          <>右键来源分支徽章 ▸「合并到当前分支」。</>,
          <>无冲突则生成一个合并提交；有冲突则在文件里出现 <K>{'<<<<<<<'}</K> 标记。</>,
        ]}
      />
      <H>解决冲突</H>
      <Steps
        items={[
          <>打开带冲突标记的文件，手动保留想要的内容、删掉 <K>{'<<<<<<<'}</K> <K>{'======='}</K> <K>{'>>>>>>>'}</K> 标记。</>,
          <>全部解决后在「源代码管理」面板提交，完成合并。</>,
          <>想放弃这次合并：冲突提示里点「撤销」中止，回到合并前。</>,
        ]}
      />
    </div>
  );
}

export function SyncSection() {
  return (
    <div>
      <H>多设备云端同步的原理</H>
      <P>把工作区连到一个云端仓库（GitHub 等），在 A 设备「推送」、在 B 设备「拉取」，即可让多台设备共享同一份版本历史。</P>
      <H>方式一：SSH 密钥（推荐）</H>
      <Steps
        items={[
          <>每台设备生成 SSH 密钥：终端执行 <K>ssh-keygen -t ed25519</K>。</>,
          <>把公钥 <K>~/.ssh/id_ed25519.pub</K> 内容添加到 GitHub ▸ Settings ▸ SSH and GPG keys。</>,
          <>用 SSH 地址连仓库（形如 <K>git@github.com:你/仓库.git</K>）。设置 ▸ Git ▸ 远程方式选「SSH」。</>,
        ]}
      />
      <H>方式二：GitHub 账号登录</H>
      <P>设置 ▸ Git ▸ 远程方式选「GitHub 登录」，再到 设置 ▸ 账户 填入个人访问令牌（PAT）授权后经 HTTPS 同步。</P>
      <H>自定义服务器</H>
      <P>使用自建或第三方 git 服务器时，设置 ▸ Git ▸ 远程方式选「自定义服务器」并填地址。</P>
      <H>日常同步</H>
      <Steps
        items={[
          <>开工前在本设备「拉取（pull）」，取回其它设备的更新。</>,
          <>提交后「推送（push）」，把本设备的版本发到云端。</>,
          <>侧栏「源代码管理」面板与 Git Graph 工具条都有 获取/拉取/推送 按钮。</>,
        ]}
      />
      <Tip>顺序记牢：先拉取、再写作、提交后推送。多设备保持「拉取在前」能减少冲突。</Tip>
    </div>
  );
}

export function ShortcutsSection() {
  const rows: [string, string][] = [
    ['Ctrl+S', '保存当前文件'],
    ['Ctrl+P', '快速打开文件'],
    ['Ctrl+Shift+P', '命令面板'],
    ['Ctrl+,', '设置'],
    ['Ctrl+E', '切换源码 / 实时预览'],
    ['Ctrl+G', '知识图谱'],
    ['Ctrl+Shift+G', '打开 / 关闭 Git Graph'],
    ['Ctrl+O', '打开文件'],
    ['Ctrl+Shift+O', '打开文件夹'],
    ['Ctrl+\\', '切换侧边栏'],
    ['F11', '专注模式'],
  ];
  return (
    <div>
      <H>常用快捷键</H>
      <table className="w-full text-[13px]">
        <tbody>
          {rows.map(([k, d]) => (
            <tr key={k} className="border-b border-[var(--background-modifier-border)]">
              <td className="py-1.5 pr-4">
                <K>{k}</K>
              </td>
              <td className="py-1.5 text-[var(--text-muted)]">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Tip>完整命令与快捷键可在命令面板（<K>Ctrl+Shift+P</K>）中查看与搜索。打字机模式、写作 HUD、阅读模式、文件导出等也都能在命令面板里直接搜到。</Tip>
    </div>
  );
}
