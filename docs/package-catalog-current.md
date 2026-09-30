# CpIPOS Current Package Catalog

Authoritative commercial baseline as of 2026-09-30.

Only four customer-selectable packages are canonical:

| Package | Monthly | Yearly | Branches | POS devices | Users | Products | Bills/month | Storage | Sales retention | Sales modes | CpiPOS AI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Starter | 350 THB | 3,780 THB | 1 | 1 | 4 | 1,000 | 3,000 | 3 GB | 6 months | up to 1 | not included |
| Growth | 550 THB | 5,940 THB | 1 | 2 | 9 | 2,000 | 5,000 | 5 GB | 12 months | up to 3 | optional add-on 299 THB/month, 500 requests/month |
| Business | 1,500 THB | 16,200 THB | 2 | 4 | 20 | 5,000 | 10,000 | 10 GB | 24 months | all 5 | included, 2,000 requests/month |
| CUSTOM | contract | contract | contract | contract | contract | contract | contract | contract | contract | contract | contract |

The annual fixed-plan price is a 10% discount from twelve monthly payments:
- Starter list 4,200 THB -> 3,780 THB/year.
- Growth list 6,600 THB -> 5,940 THB/year.
- Business list 18,000 THB -> 16,200 THB/year.

## Business

Business is the premium fixed package. It includes the full commercial POS feature bundle, all five supported sales modes (General Sale, Takeaway, Dine-in, Buffet/Table and Delivery), and CpiPOS AI.

The CpiPOS AI package quota is controlled independently from POS transaction quotas. Business includes 2,000 AI requests/month with internal token/cost safety ceilings. Reaching an internal safety ceiling may suspend AI while the rest of POS remains available.

## Growth AI add-on

Growth does not include CpiPOS AI by default. IT may sell the AI add-on for 299 THB/month and enable a tenant-scoped AI override with 500 requests/month. The add-on must never weaken tenant, branch, role, PIN or audit controls.

## CUSTOM

CUSTOM remains negotiated per tenant. Pricing, branches, devices, users, products, bills, storage, retention, feature entitlements, sales modes and AI quota come from the reviewed tenant contract / IT controls rather than fixed public package limits.

## Package enforcement

Package limits are runtime entitlements, not presentation-only labels.

- Package/contract controls branch, device, user and commercial limits.
- POS sales-mode policy applies the package mode ceiling and any reviewed contract override.
- CpiPOS AI access requires Owner/Manager role, IT menu policy and the effective AI package/tenant quota.
- Registered-device policy, tenant isolation, branch isolation, POS session guards, RLS, confirmation/PIN and Audit Log remain mandatory.
- Sales retention workers use the active package retention: Starter 6 months, Growth 12 months, Business 24 months, CUSTOM reviewed terms.

## Trial

Trial is lifecycle-based and is not a paid package row. Trial must fail closed and must not silently fall back to paid Primary access.

## Retired packages

Any package code other than `starter`, `growth`, `business` or `custom` is not customer-selectable. Legacy referenced rows remain retired audit/history records only.
