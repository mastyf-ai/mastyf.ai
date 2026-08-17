/**
 * @deprecated Use package-scorer.ts instead. This file re-exports the real scorer
 * for backward compatibility with any code that still imports from here.
 */
export {
  NpmPackageNotFoundError,
  isValidNpmPackageName,
  scorePackageStatic,
  scorePackageLive,
  scorePackageByName,
} from './package-scorer';
