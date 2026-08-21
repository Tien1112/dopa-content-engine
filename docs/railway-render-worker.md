# Railway render worker

The production worker is a private background service. It polls the Supabase
`render_jobs` queue, atomically claims one job, downloads the source from the
private `source-packages` bucket, renders with pinned Playwright Chromium, runs
machine-readable QA, and uploads only passing files to `canonical-assets`.

Railway builds `Dockerfile.worker` through `railway.json`. Configure these
service variables in Railway; never commit their values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RENDER_POLL_INTERVAL_MS` (optional, defaults to `5000`)

The service-role key stays inside Railway. It must never be exposed to Lovable,
Claude Chat, browser JavaScript, logs, or GitHub.

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

The worker does not invent missing layouts. A source canvas is accepted only
when it exactly matches an approved preset. Missing 4:5, 9:16, or Pinterest
compositions remain explicit production gaps for Claude/Margot to supply.
