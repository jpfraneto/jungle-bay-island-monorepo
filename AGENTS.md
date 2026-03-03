# MEMETICS Project Instructions

## Product Model
- Treat a bungalow as a project-level identity, not a single contract.
- A bungalow can contain multiple official assets.
- Each asset can contain one or many chain-specific deployments.
- Keep project-level identity shared, and keep chain-specific operational behavior attached to the deployment where it actually lives.

## Changelog Discipline
- Any major product, architecture, data-model, claim-flow, or UX change must add a concise entry to the in-app changelog at `island/src/pages/ChangelogPage.tsx`.
- If the conceptual model of the product changes, update `island/src/pages/AboutPage.tsx` in the same turn so the public explanation stays accurate.
- Changelog entries should be sharp, date-stamped, and readable by non-technical stakeholders.

## Implementation Notes
- Prefer explicit manual grouping for related assets and deployments over heuristic auto-matching.
- Do not merge unrelated contracts just because names or symbols look similar.
- When aggregating a bungalow, share identity and wall memory at the project level, but preserve per-asset and per-chain operational panels where the economics differ.
