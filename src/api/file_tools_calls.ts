import { requestAPI } from './index';
export interface IReadFileParams {
  file_path: string;
  notebook_path?: string;
}

export interface IReadFileResponse {
  file_path: string;
  resolved_path: string;
  content: string;
  truncated: boolean;
  file_size: number;
  content_length: number;
}

export async function readFile({
  file_path,
  notebook_path
}: IReadFileParams): Promise<IReadFileResponse> {
  return requestAPI<IReadFileResponse>('read-file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      file_path,
      notebook_path
    })
  });
}
