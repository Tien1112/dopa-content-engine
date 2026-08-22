# Dopa online koppelen aan Claude Chat

Deze connector is de online opvolger van de lokale `stdio`-connector. Claude
blijft het startpunt voor overleg en copy. Lovable blijft de vaste visuele
omgeving voor upload, kanaalpreview, downloads en handmatige goedkeuring.

## Wat de connector wel en niet doet

- Leest productiestatussen, QA-metadata en Lovable-reviewlinks.
- Leest en bewaart dezelfde conceptplanning die Lovable toont.
- Rekent de zichtbare Instagram-grid om naar de omgekeerde publicatievolgorde.
- Kan na een handmatige Lovable-goedkeuring en een tweede letterlijke bevestiging
  een interne outboxopdracht aanmaken.
- Uploaden van het volledige Claude Design ZIP-pakket blijft in Lovable, zodat
  Margot het exacte bronpakket zichtbaar kiest.
- `queued` of `dispatched` is geen bewijs van een live platformpublicatie.
- De connector publiceert niet rechtstreeks. Pinterest loopt uiteindelijk via
  Tailwind; Instagram en Facebook via de apart geconfigureerde Meta-adapter.

## Railway-service

Maak naast de render-worker een tweede Railway-service uit dezelfde GitHub-repo.

1. Gebruik branch `codex/claude-zip-ci`.
2. Zet bij **Config as Code** het configuratiepad op `/railway.mcp.json`. Dit
   kiest `Dockerfile.mcp` en de `/health`-controle, zonder de bestaande
   render-workerconfiguratie te veranderen.
3. Voeg deze privévariabelen toe:
   - `DOPA_MCP_URL_TOKEN`: een willekeurig geheim van minimaal 32 tekens. Dit
     komt alleen als onraadbare component in de Claude-connector-URL.
   - `DOPA_CLAUDE_CONNECTOR_TOKEN`: een ander geheim van minimaal 32 tekens.
     Dezelfde waarde moet als Lovable-secret bestaan.
   - `DOPA_CLAUDE_GATEWAY_URL=https://dopa-content-hub.lovable.app/api/public/claude-connector`
4. Deploy en genereer een publiek Railway-domein.
5. De MCP-URL is `https://<railway-domein>/mcp/<DOPA_MCP_URL_TOKEN>`.

De twee geheimen zijn expres verschillend. Een eventueel uitgelekte
connector-URL geeft daardoor geen directe toegang tot de interne Lovable-route.
Zet geen van beide waarden in GitHub, documentatie of chatberichten.

## Lovable

1. Voeg onder Secrets `DOPA_CLAUDE_CONNECTOR_TOKEN` toe met exact dezelfde
   server-to-serverwaarde als in Railway.
2. Publiceer de Lovable-app opnieuw; een nieuw secret geldt pas na publish.
3. De vaste gebruikerslink blijft `https://dopa-content-hub.lovable.app`.

Margot is als reviewer uitgenodigd via `vanderiet.margot@gmail.com`. Ze logt op
de vaste link in met de eenmalige e-maillink en heeft geen Lovable-editoraccount
nodig.

## Claude Desktop

Voeg in Claude bij custom connectors de volledige geheime Railway MCP-URL toe.
Noem de connector `Dopa Content Engine`. Zet daarnaast in dezelfde Claude-chat
de bestaande Tailwind-connector aan voor Pinterest.

Eerste veilige test:

> Gebruik de Dopa Content Engine. Toon de kanaalvereisten en de huidige
> producties. Verander niets.

Daarna:

> Lees het huidige Dopa-contentplan. Bespreek eerst captions, hashtags,
> volgorde en tijden voor Instagram en Facebook. Sla pas na mijn akkoord één
> kanaal als concept op. Publiceer niets.

De definitieve planning wordt eerst kanaal-eigen bekeken en handmatig
goedgekeurd in Lovable. Alleen daarna kan Margot afzonderlijk zeggen:

> PLAN NU DEZE EXACTE VERSIE IN

Totdat Meta en Tailwind echt zijn aangesloten, maakt ook die zin uitsluitend
een interne outboxopdracht aan.
