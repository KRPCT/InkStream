import { create } from 'zustand';
import type { IndexScope, IndexStatus } from '../types/index';

/** 只读呈现镜像。revision 只由实际提交/重建成功推进，不以投递成功冒充更新。 */
export const useIndexStore = create<{
  scope: IndexScope | null;
  status: IndexStatus;
  revision: number;
  error: string | null;
}>(() => ({ scope: null, status: 'disabled', revision: 0, error: null }));
