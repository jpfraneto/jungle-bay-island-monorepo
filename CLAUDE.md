# MEMETICS Collaboration Notes

## Core Product Shape
- A bungalow is the project.
- An asset is an official component inside that project (token, NFT collection, and later other artifacts).
- A deployment is the chain-specific contract or mint for that asset.

## Required Documentation Workflow
- Whenever a major change lands, update `island/src/pages/ChangelogPage.tsx` during the same work session.
- If the change affects how the product should be explained publicly, update `island/src/pages/AboutPage.tsx` as well.
- Keep changelog copy concise, concrete, and suitable for stakeholder review.

## Modeling Guidance
- Use manual canonical mappings for project and asset grouping unless there is a vetted reason to automate.
- Share the wall and project identity at the bungalow level.
- Keep claims, liquidity, market data, and other chain-bound mechanics attached to the relevant deployment or asset panel.
