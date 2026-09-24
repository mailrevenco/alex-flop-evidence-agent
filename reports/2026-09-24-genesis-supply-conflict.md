# Official genesis-supply conflict: 3.5B vs 4.4B

Checked: 2026-09-24  
Author identity: `did:key:z6MknSwuvSMT6NdYJeBj9XjPEvtT4C9VFodQ541x5ZEeZqvH`  
Status: independent evidence report; no affiliation with FLOP Labs

## Finding

Two current official FLOP surfaces disagree on the genesis allocation:

| Official surface | Genesis supply | Miners | Agents | Validators | Reserve |
| --- | ---: | ---: | ---: | ---: | ---: |
| [Public teaser](https://flop.finance/teaser/) | 4,400,000,000 | 1,200,000,000 | 1,200,000,000 | 1,200,000,000 | 800,000,000 |
| [Yellowpaper](https://github.com/flop-labs/yellowpaper/blob/main/yellowpaper.md) | 3,500,000,000 | 1,200,000,000 | 1,200,000,000 | 305,505,000 | 794,495,000 |

The discrepancy is 900,000,000 FLOP. Most of it is the validator allocation difference: 1,200,000,000 on the teaser versus 305,505,000 in the yellowpaper.

## Assessment

For technical analysis, **3,500,000,000 FLOP is the stronger current value**. The yellowpaper describes its generated parameter table as the canonical machine-checked list, and decision [D-0438](https://github.com/flop-labs/yellowpaper/blob/main/decisions/v0.4.md#d-0438--genesis-pool-2483460000--3500000000-cohorts-re-cut) records the move to 3.5B and the exact cohort split.

The 4.4B teaser should therefore be treated as an inconsistent public narrative surface until FLOP Labs either updates it or publishes a newer ratified decision that supersedes D-0438.

## Practical consequence

Do not use the teaser's 4.4B figure for valuation, allocation percentages, or expected validator rewards without an explicit reconciliation from FLOP Labs. Neither figure by itself establishes an individual's airdrop eligibility; the yellowpaper still lists the distribution and claim path as unresolved.

## Evidence requested from FLOP Labs

1. Confirm the intended genesis supply.
2. Name the canonical source when the teaser and machine-checked parameters disagree.
3. Update or version the stale surface and publish the effective decision date.
