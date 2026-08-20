# Risk scoring reference

Score each dimension independently. Use the high end when evidence is incomplete.

| Dimension | Range | Meaning |
| --- | ---: | --- |
| Change surface | 0–20 | Behavioral breadth, coupling, novelty, and affected components; do not score generated or repetitive lines as equivalent to new behavior |
| Blast radius | 0–20 | How many users, tenants, workflows, or systems can be affected; internal-only display errors usually score 0–4 |
| Reversibility | 0–15 | Difficulty of rollback, repair, or recovery; docs, copy, styles, and read-only reports usually score 0–2 |
| Data and security | 0–20 | Trust-boundary or durable-data consequences; merely reading billing/auth data is not a mutation |
| Operational risk | 0–15 | Deployment, migrations, queues, concurrency, external side effects, and availability; bounded fail-soft reads usually score 1–4 |
| Verification gap | 0–10 | Important behavior not convincingly exercised by tests or other evidence |

The raw model score is the sum, from 0 to 100. Code then applies deterministic floors:

- Low: 0–24
- Medium: 25–64
- High: 65–100

Confidence below 0.90 blocks automatic approval but does not change the risk band. Any medium finding cannot remain low. Any high finding cannot remain below high. Deterministic risk floors cover unmistakable mutation and control-plane surfaces. Diff size never sets the risk band; the separate reviewability gate handles changes too large for reliable autonomous inspection.
