# Wednesday Dopa recovery checklist

Use this checklist after Lovable credits are available and the Dopa Cloud
project can be resumed. Do not publish test content without explicit approval.

1. Resume the Dopa Lovable Cloud project and confirm its database/services are active.
2. Run `npm run check:live-readiness`.
3. Verify the three claim RPCs exist and return either one job or an empty set:
   `claim_render_job`, `claim_meta_publish_job`, `claim_channel_publish_job`.
4. Restart or redeploy only Railway services that are not `SUCCESS`.
5. Run `npm run check:live-readiness` again; all five services and five health routes must be green.
6. Upload one approved square PNG in the Hub and verify every requested PNG/MP4 output plus machine-readable QA.
7. Queue one explicitly approved private test per connected publisher and verify the real platform receipt before marking that route live.
8. Trigger each Airbyte route, deploy the normalized BigQuery view when needed, and verify at least one resulting Hub row per provider.
9. Review both existing Dopa Claude scheduled-task prompts. Make each task store
   new dated findings through `dopa_record_research_signals` or supplied context
   through `dopa_record_user_input`, then read `dopa_get_learning_snapshot`.
10. Run one scheduled task and verify its stored result appears in a later
    learning snapshot. The Google Console task must not create a duplicate raw
    Google-data route alongside Airbyte.
11. Run one Claude/ChatGPT strategy cycle using the learning snapshot and Last30Days evidence; verify it proposes but cannot approve or publish.
12. Record evidence and remaining blockers in `docs/live-readiness.md` before starting Bundle It rollout.

External exception to step 8: Etsy temporarily suspended the Dopa shop because
the submitted company details did not exactly match the KvK registration. Dopa
has appealed. Leave Etsy untouched until the shop is restored. Only then renew
OAuth, store the replacement refresh token in Railway and Airbyte, and verify a
real receipt in BigQuery and the Hub. Etsy does not block the Wednesday recovery
of the other channels.
