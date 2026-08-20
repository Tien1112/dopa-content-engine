# Content planning and publishing

This is a separate layer from Dopa Render. Render produces approved, machine-checked media; publishing consumes only those approved outputs and never changes their composition.

## Channel routing

| Destination | Adapter | Purpose |
| --- | --- | --- |
| Pinterest | Tailwind MCP | Pins, boards and SmartSchedule |
| Instagram | Dopa Meta adapter | Feed posts, carousels, Stories and Reels |
| Facebook | Dopa Meta adapter | Page posts, carousels, Stories and Reels |
| Google Business Profile | Dopa Google adapter | Updates, offers and events |
| Google Merchant Center | Dopa Merchant adapter | Product promotions; this is commerce distribution, not a social post |

Tailwind's dashboard can publish to Instagram and Facebook, but its current MCP surface is Pinterest-only. The Dopa connector therefore orchestrates several platform adapters while Claude remains the single conversational interface.

## Safety and approval flow

1. Claude receives the campaign brief and the approved Dopa Render assets.
2. Claude and Margot discuss channel-specific copy, titles, hashtags, first comments, alt text, destination links and times. They can revise the draft conversationally as often as needed.
3. Dopa saves one content plan with status `draft`. Nothing is sent to a publisher.
4. Margot reviews the calendar and explicitly approves one exact revision. Dopa hashes the complete revision, including copy, media, account and time; any later change requires new approval.
5. Dopa routes each approved item to the adapter for its channel using a stable idempotency key.
6. Each adapter returns a platform ID or a visible failure. One channel failure does not hide or roll back successful items on other channels.
7. Publishing and performance events can later flow into Airbyte for reporting and the learning loop.

Credentials never belong in a content plan. `account_ref` is an opaque reference resolved by the channel adapter's secure account configuration.

## Claude conversation

Draft request:

> Use these approved Dopa designs to propose a two-week content calendar for Pinterest, Instagram, Facebook and Google. Write channel-specific copy, hashtags, alt text and calls to action. Use the correct approved format for each placement. Save everything as a draft and do not schedule or publish anything yet.

Approval request:

> I approve content plan DOPA-WEEK-35. Schedule exactly this version and show a receipt for every item. Do not substitute media or accounts if a channel fails.

Claude should ask for a correction when the account is ambiguous, an asset lacks passed QA, a time has no timezone, or a destination link is missing where the channel requires one.

## Implementation status

The repository now contains the channel-neutral plan, validation, approval and routing contracts. Live Tailwind, Meta and Google adapters still require their respective OAuth account connections and remain outside the rendering core.
