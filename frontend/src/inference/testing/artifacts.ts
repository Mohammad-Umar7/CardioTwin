/**
 * Test-only access to the published ML artifacts (`public/model/*.json`). Imported with `?raw` so
 * TypeScript does not type-infer megabytes of JSON; never import this from application code.
 */
import type { CohortResponse, FixturesFile } from '@/types/contracts';
import cohortRaw from '../../../public/model/cohort.json?raw';
import fixturesRaw from '../../../public/model/fixtures.json?raw';
import modelRaw from '../../../public/model/model.json?raw';
import type { PortableModelSpec } from '../types';

/** A fresh deep copy on every call, so a test can never mutate another test's model. */
export const loadModelSpec = (): PortableModelSpec => JSON.parse(modelRaw) as PortableModelSpec;
export const loadFixtures = (): FixturesFile => JSON.parse(fixturesRaw) as FixturesFile;
export const loadCohort = (): CohortResponse => JSON.parse(cohortRaw) as CohortResponse;
