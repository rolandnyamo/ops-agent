# Backend Code Linting

This directory has ESLint configured specifically for the backend Node.js code.

## Commands

- `npm run lint` - Check for linting issues
- `npm run lint:fix` - Automatically fix linting issues where possible
- `npm run lint:check` - Check for linting issues with max warnings set to 0 (for CI)

## Configuration

ESLint is configured with:
- Node.js environment settings
- ES2022 syntax support
- Common code quality rules
- 2-space indentation
- Single quotes
- Semicolons required

## Remaining Manual Fixes Needed

Some linting errors require manual intervention:
- Unused variables and functions
- Empty blocks that should have code or comments
- Case block variable declarations that need refactoring
- Redundant `await` statements

Run `npm run lint` to see current issues.
