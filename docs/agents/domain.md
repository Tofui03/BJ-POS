# Domain Docs Configuration

## Layout
The repository uses a single-context domain documentation layout:
- `GLOSSARY.md` at the repo root defines canonical domain terms and ubiquitous language.
- `docs/adr/` records Architecture Decision Records.

## Consumer Rules
1. Always check `GLOSSARY.md` for proper naming of domain concepts and seams.
2. Check `docs/adr/` before proposing changes that could contradict accepted architectural decisions.
