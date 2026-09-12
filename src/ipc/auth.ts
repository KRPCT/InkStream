import { invoke } from './invoke';

export const githubDeviceConfiguration = () => invoke('git_github_device_configuration', undefined);
export const githubDeviceStart = (requestId: string, clientId: string | null) =>
  invoke('git_github_device_start', { requestId, clientId });
export const githubDevicePoll = (requestId: string) => invoke('git_github_device_poll', { requestId });
export const githubDeviceCancel = (requestId: string) => invoke('git_github_device_cancel', { requestId });
