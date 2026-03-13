# Current Onchain Reference

This directory is the canonical place to point future prompts and agents when
they need the latest contract integration surface.

Use these paths:

- `contracts/current/src/`
  Current Solidity sources for the active contract suite.
- `contracts/current/abi/`
  ABI JSON files for the deployed contracts.
- `contracts/current/deployments/base.json`
  Deployed addresses, chain metadata, and token addresses for Base.
- `contracts/current/SIGNATURES.md`
  Backend-signature matrix and EIP-712 notes.
- `backend/.env.local`
  Real backend-only secrets and non-public runtime config. Never commit.
- `island/.env`
  Real frontend runtime env for local/prod builds. Never commit.
- `backend/.env.local.example`
  Example shape for backend env.
- `island/.env.example`
  Example shape for frontend env.

Recommended prompt line:

> Read `contracts/current/README.md`, `contracts/current/src/`,
> `contracts/current/abi/`, `contracts/current/deployments/base.json`,
> `contracts/current/SIGNATURES.md`, `backend/.env.local`, and `island/.env`
> before making any contract integration changes.

Notes:

- The files in `contracts/current/src/` are the snapshot to treat as canonical.
- The root-level `.sol` files are legacy working copies and can be removed later
  once all tooling points here.
- Actual secrets belong only in `backend/.env.local` and `island/.env`.
- Public deployment data like addresses and ABI JSONs can be committed.
