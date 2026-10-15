// Pure: no Node imports. Not exported from the @devhub/shared barrel.

// Characters with a meaning in rg's gitignore-style --glob syntax (wildcards,
// classes, alternation, negation, comments, escapes; spaces because trailing
// ones are stripped). A backslash makes each of them literal.
const GLOB_METACHARACTERS = /[\\*?[\]{}!#, ]/g;

export function escapeGlobLiteral(text: string): string {
  return text.replace(GLOB_METACHARACTERS, (character) => `\\${character}`);
}
