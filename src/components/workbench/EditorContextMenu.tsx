import { useEffect, useState } from 'react';
import { getAll, subscribe } from '../../commands/registry';
import { isMarkdownFamily } from '../../editor/markdownCommands';
import Menu from '../common/Menu';
import { buildEditorMenu, buildTableMenuEntries, type TableMenuContext } from './editorMenuConfig';

/** 右键菜单坐标（contextmenu 事件 clientX/clientY，视口固定定位）。 */
export interface MenuPosition {
  x: number;
  y: number;
}

interface Props {
  position: MenuPosition;
  /** 右键命中的表格上下文（命中表格内则追加表格操作子菜单，§5）；非表格右键为 null。 */
  tableContext?: TableMenuContext | null;
  onClose: () => void;
}

/**
 * 编辑器右键上下文菜单（R4 §4.3 + 表格 Wave 2 §5）：复用通用 Menu 组件 + registry 数据驱动。
 *
 * 固定定位到 contextmenu 坐标；段落/格式/插入子菜单仅 markdown 家族文档可用（非 markdown 文档
 * disabled）。剪贴板/查找走 edit.* 命令。右键命中表格内时尾部追加「表格」子菜单（行列操作 + 对齐，
 * 经 applyTableOp 与悬浮工具条同源）。组合期防御在 EditorArea 的 contextmenu handler——
 * 组合中（isComposing）根本不开此菜单（铁律：组合期不 dispatch 破坏性操作）。
 */
export default function EditorContextMenu({ position, tableContext = null, onClose }: Props) {
  const [, setVersion] = useState(0);
  // 注册表变更时刷新（菜单开启期间命令增删的边界情形，与 MenuBar 同纪律）。
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), []);

  const commands = new Map(getAll().map((c) => [c.id, c]));
  const items = [
    ...buildEditorMenu(commands, isMarkdownFamily(), onClose),
    ...buildTableMenuEntries(tableContext, onClose),
  ];

  return (
    // 全屏覆盖层捕获外点/二次右键关闭（Menu 自身的 mousedown 外点也会触发，双保险）。
    <div
      role="presentation"
      className="fixed inset-0 z-50"
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <Menu
        items={items}
        label="编辑器操作"
        onClose={onClose}
        className="fixed"
        style={{ left: position.x, top: position.y }}
      />
    </div>
  );
}
