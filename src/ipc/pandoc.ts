import { invoke } from './invoke';

/**
 * 文件导出 pandoc 通道。全项目唯一接触 pandoc command 的前端文件（ipc/ 收口立约）。
 * pandoc 不打包，仅检测系统 PATH 上的 pandoc（零信任，同 git/gh CLI）。
 */

/** 系统是否装有 pandoc（启动时探测一次，门控 pandoc 格式入口的显隐）。 */
export function pandocAvailable(): Promise<boolean> {
  return invoke('pandoc_available', undefined);
}

/** 经 pandoc 把 gfm markdown 转为 toFormat 写到 outPath（绝对路径，原生保存对话框授权边界）。 */
export function pandocConvert(markdown: string, outPath: string, toFormat: string): Promise<null> {
  return invoke('pandoc_convert', { markdown, outPath, toFormat });
}
