# Categorical risk reference

Rate each area independently as `very_low`, `low`, `medium`, or `high`.

| Area | Very low | Low | Medium | High |
| --- | --- | --- | --- | --- |
| Change complexity | Static or mechanical | Isolated, familiar behavior | Cross-component or novel behavior | Broad architectural/control-plane change |
| Blast radius | No runtime users or systems | Narrow audience or workflow | Meaningful product/team surface | Many tenants, systems, or critical workflows |
| Data and security | No sensitive boundary | Read-only or tightly constrained data | Sensitive handling with bounded consequences | Auth, permissions, privacy breach, corruption, or cross-tenant exposure |
| Operational and recovery | No operational effect; immediate revert | Bounded side effect; straightforward rollback | Production behavior with understood recovery | Migration, destructive action, duplicated side effects, or difficult recovery |
| Verification | Direct, convincing coverage | Small understood gap | Important behavior only partly exercised | Critical behavior unverified or evidence unavailable |

The tool computes overall risk as the highest of the five ratings, deterministic policy floor, and highest finding severity. Never average the ratings: a high consequence in one area cannot be canceled by low ratings elsewhere.

Confidence below 0.90 blocks automatic approval but does not change the risk level. Medium and high findings force at least their own level. Diff size never sets risk; the separate reviewability gate handles changes too large for reliable autonomous inspection.
