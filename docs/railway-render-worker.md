# Railway render worker

The production worker is a private background service. It polls a narrow,
authenticated Lovable/Supabase gateway, atomically claims one job, downloads the source from the
private `source-packages` bucket, renders with pinned Playwright Chromium, runs
machine-readable QA, and uploads only passing files to `canonical-assets`.

Railway builds `Dockerfile.worker` through `railway.json`. Configure these
service variables in Railway; never commit their values:

- `DOPA_RENDER_GATEWAY_URL` — the deployed server-side `render-worker` gateway URL
- `DOPA_RENDER_WORKER_TOKEN` — a unique random secret of at least 32 characters;
  use the exact same value in Lovable Cloud → Secrets
- `RENDER_POLL_INTERVAL_MS` (optional, defaults to `5000`)

Railway never receives a Supabase service-role key. Database authority stays
inside the server-side gateway. Never expose the worker token in Lovable
frontend code, Claude Chat, browser JavaScript, logs, or GitHub.

For Dopa, the production gateway URL is:

```text
https://dopa-content-hub.lovable.app/api/public/render-worker
```

The gateway is a server-side Lovable route. It accepts POST only and requires
the `x-dopa-worker-token` header. The corresponding secret is configured as
`DOPA_RENDER_WORKER_TOKEN` in Lovable Cloud → Secrets.

The database needs an atomic claim function:

```sql
create or replace function public.claim_render_job()
returns setof public.render_jobs
language sql
security definer
set search_path = public
as $$
  update public.render_jobs
  set status = 'wordt_gerenderd', error_text = null, updated_at = now()
  where id = (
    select id
    from public.render_jobs
    where status in ('aangeleverd', 'wacht_op_render_engine')
    order by created_at asc
    for update skip locked
    limit 1
  )
  returning *;
$$;

revoke all on function public.claim_render_job() from public, anon, authenticated;
grant execute on function public.claim_render_job() to service_role;
```

The worker accepts the approved 1080×1080 Claude Design export and deterministically
reflows its structured page elements into exactly the presets requested by the Hub.
The first-release contract includes Instagram, Facebook, Pinterest, and Etsy images,
plus static H.264 MP4 Reel outputs. It never stretches a bitmap or silently relabels
the square source as another format. Every output must pass exact size, type, asset,
font, and checksum QA before the job can enter review.
