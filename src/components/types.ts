import { type LectureCell } from '@/api';

export interface IMessage {
  author: 'user' | 'tutor' | 'system';
  text: string;
  relevantLectures?: LectureCell[];
}
