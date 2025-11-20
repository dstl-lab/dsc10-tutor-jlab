import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines all class names into a single string.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns whether the app is running in production mode.
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Parses the student email from the window location URL.
 * Expected format: https://datahub.ucsd.edu/user/<username>/...
 * Returns <username>
 */
export function getStudentUsernameFromUrl(
  defaultUsername: string = 'dsc10-test'
): string {
  try {
    // Parse email from URL: https://datahub.ucsd.edu/user/sel011/lab?
    // We expect the path to be /user/<username>/...
    const match = window.location.pathname.match(/\/user\/([^/]+)/);
    if (match && match[1]) {
      return match[1];
    } else {
      console.error(
        'Could not parse student username from URL:',
        window.location.pathname
      );
    }
  } catch (e) {
    console.error('Error parsing student username from URL:', e);
  }

  return defaultUsername;
}
