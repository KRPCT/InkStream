import { useEffect } from 'react';
import AboutDialog from './components/common/AboutDialog';
import ChoiceDialog from './components/common/ChoiceDialog';
import ConfirmDialog from './components/common/ConfirmDialog';
import PromptDialog from './components/common/PromptDialog';
import Toast from './components/common/Toast';
import UpdateDialog from './components/common/UpdateDialog';
import WhatsNewDialog from './components/common/WhatsNewDialog';
import WritingHud from './components/common/WritingHud';
import ImeProbe from './components/dev/ImeProbe';
import HelpModal from './components/help/HelpModal';
import OnboardingOverlay from './components/onboarding/OnboardingOverlay';
import CommandPalette from './components/palette/CommandPalette';
import SettingsModal from './components/settings/SettingsModal';
import WorkbenchLayout from './components/workbench/WorkbenchLayout';
import { initExternalChangeArbiter, stopExternalChangeArbiter } from './editor/externalChange';
import { initExitGuard, stopExitGuard } from './editor/exitGuard';
import { initOsFileOpen, stopOsFileOpen } from './editor/osFileOpen';
import { restoreLastVault } from './editor/startupFlow';
import { windowControls } from './ipc/window';
import { initOnboarding } from './stores/useOnboardingStore';
import { usePandocStore } from './stores/usePandocStore';
import { useUpdaterStore } from './stores/useUpdaterStore';
import { useWhatsNewStore } from './stores/useWhatsNewStore';
import { getAppVersion } from './ipc/app';
import { loadLastSeenVersion } from './ipc/settings';
import { initPersistence } from './stores/persistSettings';
import { initVaultPersistence } from './stores/persistVault';

export default function App() {
  useEffect(() => {
    // 持久化 hydrate 先于 show() 发起、不阻塞首帧：首帧由 boot.js 镜像保证，
    // settings.json 到达后校正（Pattern 6 第 3 步）。initPersistence 幂等。
    // 持久化 hydrate（幂等，不阻塞首帧）。restoreLastVault 须等 settings（含 simpleMode）已 apply，
    // 否则可能在 simpleMode 生效前触发索引重建、在用户库建出 .inkstream（D-08 + 简易模式约束）。
    void Promise.all([initPersistence(), initVaultPersistence()]).then(() => restoreLastVault());
    // 外部变更冲突仲裁订阅（D-04，FILE-02）：watcher 事件经此按 isDirty 双路径仲裁。
    initExternalChangeArbiter();
    // 未提交退出提醒（簇①）：关窗时若 git 有未提交改动则确认。
    initExitGuard();
    // #6：OS 文件接入（拖拽 + 「打开方式」冷启动/热转发）→ openExternalFile。
    initOsFileOpen();
    // 文件导出：探测一次系统是否装 pandoc，决定「导出为」是否显示 odt/rtf/latex/epub/typst/org。
    void usePandocStore.getState().detect();
    // 自动更新：启动静默检查（dev / 无网 / 无更新一律静默；有更新弹非侵入对话框）。模块级 checking 守 StrictMode。
    void useUpdaterStore.getState().checkSilent();
    // 更新公告（What's New）：当前版本 !== 已见版本时展示本版公告——覆盖「发版后首启」与「更新重启后首启」。
    // dev 不弹；落盘已见版本在 showFor 内幂等完成。StrictMode 双执行无害（同版只展示一次）。
    void (async () => {
      const version = await getAppVersion();
      if (version === 'dev') return;
      useWhatsNewStore.getState().showFor(version, await loadLastSeenVersion());
    })();
    // FOUC 契约第 1 步收尾：首帧渲染后显示窗口（show 幂等，StrictMode 双执行无害）
    void windowControls.show();
    // 首次引导（簇③）：延迟到布局渲染后再开，spotlight 才能命中侧栏/状态栏元素。seen 标记防重复弹。
    const onboardingTimer = setTimeout(() => initOnboarding(), 1000);
    return () => {
      clearTimeout(onboardingTimer);
      stopExternalChangeArbiter();
      stopExitGuard();
      stopOsFileOpen();
    };
  }, []);

  return (
    <>
      <WorkbenchLayout />
      {/* 统一弹层：永挂载，显隐由 usePaletteStore.open 控制 */}
      <CommandPalette />
      {/* 设置模态（簇②）：view.settings 命令 / Ctrl+, 打开（useSettingsUiStore） */}
      <SettingsModal />
      {/* 帮助/教程模态（簇③）：help.guide 命令打开（useHelpStore） */}
      <HelpModal />
      {/* 首次引导 spotlight（簇③）：首次启动自动弹，help.onboarding 重开（useOnboardingStore） */}
      <OnboardingOverlay />
      {/* 关于对话框：app.about 命令打开（useAboutStore） */}
      <AboutDialog />
      {/* 破坏性确认模态：删除 / 覆盖磁盘二次确认（useConfirmStore，confirmDestructive 弹出） */}
      <ConfirmDialog />
      {/* 多选确认模态：≥3 路出口（如切库提示提交并切换/直接切换/取消，useChoiceStore，chooseAction 弹出） */}
      <ChoiceDialog />
      {/* 文本输入模态：git 分支/tag 名、提交信息（usePromptStore，promptInput 弹出） */}
      <PromptDialog />
      {/* Toast 通知宿主：错误/警告（useToastStore，持久化读写失败路径消费） */}
      <Toast />
      {/* 写作 HUD（写作模式升级）：码字速度/时间/番茄钟，默认关闭，writing.toggle-hud 开启 */}
      <WritingHud />
      {/* 自动更新对话框（FEAT-UPDATER）：有更新 / 手动检查时弹出，useUpdaterStore.dialogOpen 控制 */}
      <UpdateDialog />
      {/* 更新公告（What's New）：发版/更新后首启展示本版要点，重大更新附恭喜动效，useWhatsNewStore.open 控制 */}
      <WhatsNewDialog />
      {/* DEV-only：IME 输入探针（R2 实验，dev.ime-probe 命令打开）。生产构建摇树移除。 */}
      {import.meta.env.DEV && <ImeProbe />}
    </>
  );
}
