import { systemQuery } from '@glyphor/shared/db';

/** Thin adapter for `toolClassifier` batch jobs — same contract as `pg` `query` rows. */
export const db = {
  query: systemQuery,
};
