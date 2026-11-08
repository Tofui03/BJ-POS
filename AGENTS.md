# Borneo Jasa POS — Agent Guidelines

Operational guidelines, conventions, and configuration for autonomous and assistive AI agents working in this repository.

## Architecture & Codebase Design
- Design **deep modules**: narrow interfaces hiding rich implementations.
- Respect domain seams. Never allow UI components or Pinia stores to handle database persistence or transactional business logic.
- Domain terminology strictly follows [GLOSSARY.md](./GLOSSARY.md).
- Follow Architecture Decision Records in `docs/adr/`.

## Agent skills

### Issue tracker
GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels
Canonical five roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs
Single-context domain model (`GLOSSARY.md` and `docs/adr/`). See `docs/agents/domain.md`.
