import { URLExt } from '@jupyterlab/coreutils';

import { ServerConnection } from '@jupyterlab/services';

export interface IAskTutorParams {
  student_question: string;
  notebook_json?: string;
  prompt?: string;
}

export interface ITutorResponse {
  conversation_id: string;
  tutor_response: string;
}

/**
 * Ask a question to the DSC10 tutor API
 *
 * @param params - The parameters for the tutor request
 * @param params.student_question - The student's question to ask the tutor
 * @param params.notebook_json - Optional notebook JSON context
 * @param params.prompt - Optional system prompt for the LLM
 * @returns The response from the API
 */
export async function askTutor({
  student_question,
  notebook_json,
  prompt
}: IAskTutorParams): Promise<ITutorResponse> {
  const url = 'https://slh-backend-v2-api-dev.slh.ucsd.edu/api/dsc10/ask';

  const body = {
    class_id: 'ca000000-0000-0000-0001-000000000001',
    assignment_id: 'ca000000-0000-0000-0002-000000000001',
    question_id: 'ca000000-0000-0000-0004-000000000001',
    student_question: student_question,
    notebook_json: notebook_json || '',
    prompt: prompt || ''
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
}

/**
 * Call the API extension. sam: This was generated from the JupyterLab extension
 * template and i'm just leaving here for reference, in case we need to make a
 * call to the extension backend at some point..
 *
 * @param endPoint API REST end point for the extension
 * @param init Initial values for the request
 * @returns The response body interpreted as JSON
 */
export async function requestAPI<T>(
  endPoint = '',
  init: RequestInit = {}
): Promise<T> {
  // Make request to Jupyter API
  const settings = ServerConnection.makeSettings();
  const requestUrl = URLExt.join(
    settings.baseUrl,
    'dsc10-tutor-jlab-backend', // API Namespace
    endPoint
  );

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(requestUrl, init, settings);
  } catch (error) {
    throw new ServerConnection.NetworkError(error as any);
  }

  let data: any = await response.text();

  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      console.log('Not a JSON response body.', response);
    }
  }

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response, data.message || data);
  }

  return data;
}
