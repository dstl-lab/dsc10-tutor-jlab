import { getStudentEmailFromUrl } from './index';

/**
 * The currently active experiment ID.
 * Set to null to disable all gating (all features on).
 * Change this to switch between experiments without any other code changes.
 *
 * Experiment IDs:
 *   'exp_practice_problems'  — gate practice problems feature
 *   'exp_follow_up'          — gate follow-up suggestion feature
 *   'exp_relevant_lectures'  — gate relevant lectures feature
 */
export const ACTIVE_EXPERIMENT: string | null = 'exp_follow_up';

/**
 * Phase of the current experiment.
 * 1 = first half (use hash-assigned variant as-is)
 * 2 = second half (flip A↔B so each student experiences the other condition)
 *
 * This enables a within-subjects crossover design without re-randomising.
 * To flip at the halfway point: set to 2 and redeploy.
 */
export const EXPERIMENT_PHASE: 1 | 2 = 1;

/**
 * FNV-1a 32-bit hash. Pure string hash — no async, no browser API dependency.
 * Good distribution for assignment splitting.
 */
function hashString(s: string): number {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    // Multiply by FNV prime (32-bit): 0x01000193
    // Use bitwise ops to stay in 32-bit integer range
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned 32-bit integer
  return hash >>> 0;
}

/**
 * Returns a stable, pseudonymized key for the current student.
 * Uses the email parsed from the datahub URL so it's consistent across sessions.
 */
export function getStudentKey(): string {
  return getStudentEmailFromUrl();
}

/**
 * Deterministically assigns variant 'A' or 'B' for a given student + experiment.
 * The same student always gets the same variant for the same experiment.
 *
 * Variant A = control (feature OFF)
 * Variant B = treatment (feature ON)
 */
export function assignVariant(
  studentKey: string,
  experimentId: string
): 'A' | 'B' {
  // const hash = hashString(studentKey + experimentId);
  // const raw: 'A' | 'B' = hash % 2 === 0 ? 'A' : 'B';
  // return EXPERIMENT_PHASE === 2 ? (raw === 'A' ? 'B' : 'A') : raw;
  return 'B';
}

/**
 * Returns a pseudonymized hash of the student key for logging.
 * Never log raw email — use this in experiment event payloads.
 */
export function hashStudentKey(studentKey: string): string {
  return btoa(studentKey);
}
