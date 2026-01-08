import { URLExt } from '@jupyterlab/coreutils';

import { ServerConnection } from '@jupyterlab/services';

import { getStudentEmailFromUrl, isProduction } from '@/utils';

/**
 * Modes for how the assistant responds to the user's message.
 *
 * - 'append': Appends custom prompt to DSC10-specific guidance.
 * - 'override': Only uses custom prompt and ignores DSC10-specific guidance.
 * - 'none': Only Tutor's default behavior without any additional prompts.
 */
export type PromptMode = 'append' | 'none' | 'override';

export interface IAskTutorParams {
  student_question: string;
  notebook_json: string;
  prompt?: string;
  prompt_mode?: PromptMode;
  conversation_id?: string;
  reset_conversation?: boolean;
}

export interface ITutorResponse {
  conversation_id: string;
  tutor_response: string;
}

export interface ITutorRequest {
  class_id: string;
  assignment_id: string;
  question_id: string;
  student_email: string;
  student_question: string;
  notebook_json: string;
  prompt: string;
  prompt_mode?: PromptMode;
  conversation_id?: string;
  reset_conversation?: boolean;
}

// curl -X POST https://slh-backend-v2-api-dev.slh.ucsd.edu/api/dsc10/ask \
//   -H "Content-Type: application/json" \
//   -H "Authorization: mock:dsc10:student@university.edu:DSC10 Student" \
//   -d '{
//     "class_id": "ca000000-0000-0000-0001-000000000001",
//     "assignment_id": "ca000000-0000-0000-0002-000000000001",
//     "question_id": "ca000000-0000-0000-0004-000000000001",
//     "student_question": "What is a DataFrame in pandas?",
//     "notebook_json": "",
//     "prompt": ""
//   }'

/**
 * Ask a question to the DSC10 tutor API
 *
 * @param params - The parameters for the tutor request
 * @param params.student_question - The student's question to ask the tutor
 * @param params.notebook_json - Optional notebook JSON context
 * @param params.prompt - Optional system prompt for the LLM
 * @param params.prompt_mode - 'append' | 'none' | 'override' (defaults to 'append')
 * @param params.conversation_id - Optional conversation ID to continue an existing conversation
 * @returns The response from the API
 */
export async function askTutor({
  student_question,
  notebook_json,
  prompt,
  prompt_mode,
  conversation_id,
  reset_conversation
}: IAskTutorParams): Promise<ITutorResponse> {
  const url = 'https://slh-backend-v2-api.slh.ucsd.edu/api/dsc10/ask';
  const studentEmail = getStudentEmailFromUrl();

  // In production (datahub), we DON'T use an authorization token since SLH
  // whitelists all datahub requests. Instead, we need to include a
  // student_email field in the request body.
  //
  // In development (local), we use a mock authorization token instead.
  const headers: Record<string, string> = isProduction()
    ? { 'Content-Type': 'application/json' }
    : {
        'Content-Type': 'application/json',
        Authorization:
          'Bearer mock:dsc10:alice.johnson@example.edu:Alice Johnson'
      };

  const body: ITutorRequest = {
    // get these UUIDs from https://course-assistant-v2.slh.ucsd.edu/
    class_id: '0695ea15-532a-735c-8000-67bc3744d2a4',
    assignment_id: isProduction()
      ? '0695ea16-733f-7bfd-8000-b47e40290ff0' // dsc10-production
      : '0695ea16-df80-7f31-8000-d310f60657a0', // dsc10-development
    question_id: isProduction()
      ? '0695f1ac-7447-7089-8000-f6ae068108d4' // dsc10-production
      : '0695f216-2116-7592-8000-8de58ce2b501', // dsc10-development
    student_email: studentEmail,
    student_question: student_question,
    notebook_json: notebook_json || '',
    prompt: prompt ?? '',
    prompt_mode: prompt_mode ?? 'append'
  };

  if (conversation_id) {
    body.conversation_id = conversation_id;
  }

  // Include reset flag when requested
  if (reset_conversation) {
    body.reset_conversation = true;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
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
