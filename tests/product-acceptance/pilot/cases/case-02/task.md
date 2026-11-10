# Slug helper

Existing `slugify(text)` must lowercase, trim, collapse runs of non-alphanumerics to one hyphen and strip edge hyphens. Add `slugifyPath(path)` that slugifies each segment and joins with `/`. Keep the existing tests passing.

Visible tests must keep passing. Implement the requested addition in `src/feature.js`.
