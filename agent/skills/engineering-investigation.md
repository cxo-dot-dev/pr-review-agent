---
description: Investigate a repository question, bug, CI failure, or implementation approach using the checked-out code and concrete evidence.
---

# Engineering investigation

Start from the repository state and exact ref supplied by the active channel. Search before assuming. Read the relevant implementation, tests, configuration, and recent call sites. Distinguish confirmed evidence from inference.

For diagnosis, explain the cause and the smallest safe fix without changing code unless the user asked for implementation. For implementation requests, keep the change scoped, preserve unrelated work, and validate the behavior proportionally to its risk.

Never merge, deploy, publish, alter repository settings, or perform another external side effect unless the user explicitly requested it and an appropriate tool authorizes it.
