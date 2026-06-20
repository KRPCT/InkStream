import { addFileToShelf, importBookFiles, importBookFolder } from '../bookshelf/importBooks';
import { isPathShelved } from '../stores/useBookshelfStore';
import { useReadingStore } from '../stores/useReadingStore';
import { showToast } from '../stores/useToastStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import type { Command } from '../types/commands';

/**
 * 书架命令（FEAT-SHELF）。全部 bookshelfOnly：bookshelfEnabled 关闭时命令面板 / 菜单隐藏，
 * 经 registry.execute 触发亦 no-op（同 pandocOnly 门控）。从 builtins 展开进注册表。
 */
export const BOOKSHELF_COMMANDS: Command[] = [
  {
    id: 'bookshelf.open',
    title: '书架：打开书架',
    bookshelfOnly: true,
    run: () => useWorkbenchStore.getState().toggleCentralView('bookshelf'),
  },
  {
    id: 'bookshelf.add-current',
    title: '书架：把当前阅读文档加入书架',
    bookshelfOnly: true,
    run: () => {
      const doc = useReadingStore.getState().doc;
      if (!doc) {
        showToast('warning', '请先在阅读模式打开一个文档。');
        return;
      }
      if (isPathShelved(doc.path)) {
        showToast('warning', '该文档已在书架。');
        return;
      }
      void addFileToShelf(doc.path).then((ok) => {
        if (ok) showToast('warning', '已加入书架。');
      });
    },
  },
  {
    id: 'bookshelf.import-files',
    title: '书架：导入书籍文件',
    bookshelfOnly: true,
    run: () => void importBookFiles(),
  },
  {
    id: 'bookshelf.import-folder',
    title: '书架：导入书籍文件夹',
    bookshelfOnly: true,
    run: () => void importBookFolder(),
  },
];
