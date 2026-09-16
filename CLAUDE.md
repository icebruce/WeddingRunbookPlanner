# Working rules

## Design docs

Before implementing any change, check the specs and flag anything unclear or conflicting instead of guessing:

- Behaviour → `docs/FUNCTIONAL_SPEC.md` (wins on behaviour)
- Architecture / implementation → `docs/TECHNICAL_SPEC.md`
- Look and feel → `docs/DESIGN_GUIDE.md` + `docs/mockups/mobile.html`, `docs/mockups/desktop.html` (win on look)
- Stage plan / gates → `docs/IMPLEMENTATION_PLAN.md`
- Regression baseline → `docs/RELEASE_CHECK.md`

Only update a spec when the change is an important design decision (new behaviour, contract, or visual rule) — not for implementation detail. Keep spec edits brief: state the decision, not the reasoning trail.

## Coding standards

Smallest maintainable implementation that fully preserves current functionality and UX. No bloat, no duplication, no speculative abstraction.

- **Backend:** no dependencies beyond what's already approved (see TECHNICAL_SPEC §1). Validate only at real boundaries. Extend existing modules before adding new ones.
- **Frontend:** vanilla JS/ES modules, no framework or build step. Reuse existing components/helpers before writing new ones.
- **UI/UX:** match DESIGN_GUIDE.md and the mockups exactly; don't introduce new patterns without flagging it first.
