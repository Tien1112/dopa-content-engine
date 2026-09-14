# Last30Days in the Dopa strategy loop

Last30Days runs in the user's conversation client, not in Lovable, Airbyte or
the renderer. Claude or ChatGPT remains the steering layer. The Hub MCP server
is the bridge to Dopa's measured data and persistent research evidence.

## One-time setup

Install `mvanhorn/last30days-skill` in each supported conversation client using
the installation method documented by that repository. Separately add the
private `Dopa Content Engine` MCP URL described in
`docs/claude-remote-connector.md`.

## One research cycle

1. The user asks Claude or ChatGPT a strategy question.
2. The agent runs Last30Days for current external evidence.
3. It saves only the strongest dated findings through
   `dopa_record_research_signals`; raw credentials and browsing sessions never
   enter the Hub.
4. It reads `dopa_get_learning_snapshot`, which combines those findings with
   performance data and user-supplied thoughts or transcripts.
5. It proposes campaign and content ideas, clearly separating evidence from
   hypotheses.
6. The user creates the chosen assets in Claude Design and uploads them to the
   Hub for deterministic rendering, review, scheduling and publication.

The MCP prompt `dopa_run_30days_research` encodes this route. Research can never
approve a plan, create assets or publish content.
