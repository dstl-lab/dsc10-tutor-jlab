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



export interface IListFilesResponse {
  files: {
    path: string;
  }[];
  }
  
  export async function listFiles(
    path = '.',
    recursive = true
  ): Promise<IListFilesResponse> {
    return requestAPI<IListFilesResponse>('list-files', {
      method: 'GET'
    });
  }



export interface ISearchFilesParams {
  query: string;
  scope?: string;
  }
  
  export interface ISearchFilesResponse {
    files: string[];
  }
  
  export async function searchFiles({
    query,
    scope = '.'
  }: ISearchFilesParams): Promise<ISearchFilesResponse> {
    return requestAPI<ISearchFilesResponse>('search-files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, scope })
    });
  }

