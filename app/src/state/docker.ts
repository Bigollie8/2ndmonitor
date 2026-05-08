import { isTauri } from './tauri';

export interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
}

export interface DockerListResult {
  containers: DockerContainer[];
  error: string | null;
}

export async function fetchDockerContainers(): Promise<DockerListResult | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<DockerListResult>('docker_list_containers');
  } catch (err) {
    console.warn('docker_list_containers failed', err);
    return null;
  }
}
