import { type ILectureCell } from '@/api';

export interface IMessage {
  author: 'user' | 'tutor' | 'system';
  text: string;
  relevantLectures?: ILectureCell[];
  isStreaming?: boolean;
}
