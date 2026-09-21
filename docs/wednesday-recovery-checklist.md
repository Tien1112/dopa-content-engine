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
9. Run one Claude/ChatGPT strategy cycle using the learning snapshot and Last30Days evidence; verify it proposes but cannot approve or publish.
10. Record evidence and remaining blockers in `docs/live-readiness.md` before starting Bundle It rollout.

Known prerequisite before step 8: renew the revoked Dopa Etsy OAuth grant and
store its new refresh token in both Railway and the Airbyte source. Etsy remains
blocked until a real receipt reaches BigQuery and the Hub.
