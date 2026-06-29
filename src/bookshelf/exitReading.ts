import { closeReading, isShelfFormat } from '../editor/reading/openReading';
import { chooseAction } from '../stores/useChoiceStore';
import { isPathShelved } from '../stores/useBookshelfStore';
import { useReadingStore } from '../stores/useReadingStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { showToast } from '../stores/useToastStore';
import { addFileToShelf } from './importBooks';

/**
 * 退出阅读模式编排（FEAT-SHELF，req 3）：退出前若文档未在架且书架已开，问是否加入书架（方便下次快速续读）。
 * 单独成模块以避开 openReading ↔ importBooks 的循环依赖；ReadingView 的关闭按钮走此而非裸 closeReading。
 */
export async function exitReading(): Promise<void> {
  const { doc, bookContext } = useReadingStore.getState();
  // 从书架打开（bookContext 在架）或书架未开 → 直接关；否则未在架且可入架的直接打开文档提示加入。
  // isShelfFormat 排除 md：否则对 md 弹「加入书架？」而点确认会静默失败（addFileToShelf 返 false）。
  if (
    doc &&
    !bookContext &&
    useSettingsStore.getState().bookshelfEnabled &&
    isShelfFormat(doc.path) &&
    !isPathShelved(doc.path)
  ) {
    const pick = await chooseAction({
      title: '加入书架？',
      body: `把《${doc.name}》加入书架，下次可在书架里快速续读。`,
      options: [
        { id: 'add', label: '加入书架', kind: 'primary' },
        { id: 'skip', label: '暂不' },
      ],
    });
    if (pick === 'add') {
      const ok = await addFileToShelf(doc.path);
      if (ok) showToast('warning', '已加入书架。');
    }
  }
  closeReading();
}
