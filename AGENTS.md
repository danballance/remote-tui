# Repository Guidelines

## Tests

- Place new tests in the owning package's dedicated `test/` directory; do not
  colocate test files under `src/`.
- Mirror the source tree beneath `test/`. For example, tests for
  `src/features/catalog.ts` belong in `test/features/catalog.test.ts`.
- Name TypeScript test files `*.test.ts` and keep each package's test directory
  included in its TypeScript checks and test runner.
