/**
 * 配置相关 API
 */

import { apiClient } from './client';
import type { Config } from '@/types';
import { isRecord } from '@/utils/helpers';
import { normalizeConfigResponse } from './transformers';

export const configApi = {
  /**
   * 获取配置（会进行字段规范化）
   */
  async getConfig(): Promise<Config> {
    const raw = await apiClient.get('/config');
    if (!isRecord(raw)) {
      throw new Error(
        'The server did not return an API configuration. Check the connection address.'
      );
    }
    return normalizeConfigResponse(raw);
  },

  /**
   * 请求日志开关
   */
  updateRequestLog: (enabled: boolean) =>
    apiClient.put('/config/observability/logs/request-log', enabled),
};
