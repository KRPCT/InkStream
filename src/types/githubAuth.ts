/** 设备登录的公开 UI 信息；设备码和令牌只在原生端。时间以 Unix 毫秒表示。 */
export interface GithubDeviceConfiguration { clientId: string | null }
export interface GithubDeviceStart {
  requestId: string;
  userCode: string;
  verificationUri: 'https://github.com/login/device';
  expiresAt: number;
  intervalMs: number;
}
export type GithubDevicePoll =
  | { status: 'pending'; retryAfterMs: number }
  | { status: 'authorized'; login: string }
  | { status: 'denied' | 'expired' | 'cancelled' };
