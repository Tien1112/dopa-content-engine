# Dopa content plannen vanuit Claude Desktop

## Wat Margot straks in Claude kan doen

Margot blijft in één Claude Chat. Ze kan een campagne bespreken, teksten laten herschrijven, hashtags kiezen, verschillende tijden vergelijken en daarna één exacte revisie goedkeuren. De Dopa-connector bewaart de planning lokaal en voorkomt dat een concept per ongeluk wordt ingepland.

Ze kan vóór goedkeuring ook zeggen:

> Maak een visuele preview van Instagram en Facebook voor deze revisie.

De reviewpagina toont Instagram als een raster en Facebook als een tijdlijn. Margot sleept de Instagram-tegels naar de gewenste eindstand, met de nieuwste post linksboven, en kiest daarna **Kopieer voor Claude**. Ze plakt die ene zin terug in dezelfde chat. Claude maakt daarmee een nieuwe revisie en genereert opnieuw een preview. De engine zet de gekozen eindstand automatisch om naar de omgekeerde volgorde waarin de posts daadwerkelijk moeten worden gepubliceerd.

Voorbeeld:

> Gebruik de goedgekeurde Dopa-assets voor volgende week. Maak voorstellen voor Pinterest, Instagram en Facebook. Schrijf per kanaal een eigen caption, hashtags en alt-tekst. Gebruik Europe/Amsterdam en sla alleen een concept op.

Na controle:

> Laat mij eerst de complete revisie zien. IK KEUR DEZE EXACTE PLANNING GOED.

Inplannen is bewust een tweede opdracht:

> PLAN NU DEZE EXACTE VERSIE IN. Geef per kanaal aan wat is klaargezet en wat nog een accountkoppeling nodig heeft.

De twee bevestigingen zijn hoofdlettergevoelig in de tool-input. Claude mag ze alleen gebruiken nadat Margot de bijbehorende bedoeling expliciet heeft uitgesproken.

## Wat de connector nu werkelijk doet

- Maakt en bewaart volledige conceptplanningen.
- Maakt bij iedere wijziging een nieuwe revisie.
- Valideert kanaal, contenttype, accountreferentie, tijdzone, media-QA, caption, hashtags en links.
- Vergrendelt de exacte revisie na goedkeuring met een inhoudshash.
- Zet goedgekeurde items idempotent in een kanaal-outbox.
- Laat Claude het exacte Pinterest-outbox-item aan Tailwind doorgeven en Tailwinds echte platform-ID als ontvangstbewijs opslaan.
- Meldt eerlijk dat een outbox-item nog geen bewijs van live publicatie is.
- Geeft Claude per kanaal de volgende dispatch-stap.
- Maakt een visuele Instagram-rasterpreview en Facebook-tijdlijnpreview.
- Zet een door Margot gekozen Instagram-eindstand om naar veilige publicatietijden in een nieuwe conceptrevisie.

## Kanaalroute

| Kanaal | Vanuit Claude | Laatste publicatiestap |
| --- | --- | --- |
| Pinterest | Dopa-plan + bestaande Tailwind-connector | Claude roept Tailwind MCP aan met het goedgekeurde Pin-item |
| Instagram | Dopa-plan + visuele rastercontrole | Dopa Meta Graph-adapter na accountkoppeling |
| Facebook | Dopa-plan + visuele tijdlijncontrole | Dopa Meta Graph-adapter na accountkoppeling |
| Google Business Profile | Dopa-plan | Google Local Posts-adapter na OAuth en locatiekeuze |
| Google Merchant Center | Dopa-promotieplan | Merchant Promotions-adapter; Google beoordeelt de promotie |

Tailwind MCP is een aparte connector in dezelfde Claude-conversatie. Volgens Tailwind moet de connector per chat worden aangezet en moeten de individuele Pinterest-tools onder de connectorinstellingen zijn ingeschakeld.

## Eenmalige installatie op Margots computer

1. Installeer Node.js LTS en haal deze repository lokaal op.
2. Voer in de repository `npm install` en `npm run build` uit.
3. Open Claude Desktop → Settings → Developer → Edit Config.
4. Voeg de inhoud van `config/claude-desktop.mcp.example.json` samen met de bestaande `mcpServers`-configuratie.
5. Vervang alle drie de voorbeeldpaden door absolute paden op Margots computer.
6. Sluit Claude Desktop volledig af en start opnieuw.
7. Open Connectors in een chat en controleer of `dopa-content-planner` en Tailwind aanstaan.

Op de computer waarop Claude Desktop draait kan het juiste configuratieblok automatisch worden gemaakt met:

```bash
npm run config:claude-desktop
```

Het resultaat staat standaard in `work/dopa-claude-desktop-mcp.json`. Voeg het `dopa-content-planner`-blok samen met eventueel bestaande `mcpServers`; overschrijf andere connectors niet.

Claude Desktop start de lokale MCP-server zelf. Start `npm run mcp:content-planner` daarom niet daarnaast in een tweede terminal.

## Wat nog nodig is voor live publicatie

### Tailwind / Pinterest

- Tailwind-account met het juiste Pinterest-profiel.
- Custom connector `https://mcp.tailwind.ai` geautoriseerd in Claude.
- Pinterest-tools per chat ingeschakeld.
- Definitieve lijst met Pinterest-borden.

### Instagram en Facebook

- Meta Business Portfolio.
- Facebook Page en gekoppeld professioneel Instagram-account.
- Meta OAuth-app met de benodigde publicatierechten.
- Veilige accountreferenties voor Dopa; tokens komen nooit in een contentplan.
- Publiek bereikbare media-URL’s op het moment van dispatch.

De eerste bewezen Meta-adapter ondersteunt Instagram-afbeeldingsposts, carrousels met 2–10 afbeeldingen en MP4 Reels. Voor Facebook ondersteunt hij Page-berichten met tekst/link of één PNG/JPEG. Nog niet bewezen plaatsingen, waaronder Stories en Facebook-carrousels/Reels, stoppen zichtbaar in plaats van stil iets anders te posten.

Kopieer `config/meta-adapter.example.json` naar een privéconfiguratie buiten GitHub. Vul de Instagram User ID en Facebook Page ID in, zet het access token uitsluitend in de genoemde omgevingsvariabele en wijs `DOPA_META_CONFIG` naar het privébestand. Elk Meta-mediabestand heeft daarnaast een tijdelijke of permanente publieke HTTPS-URL nodig in `public_url`; Meta kan een lokaal laptopbestand niet ophalen.

De dispatch-worker voert één controle uit met:

```bash
npm run publish:meta-due
```

Voor automatisch publiceren moet deze opdracht op een altijd actieve computer of hostingdienst volgens een tijdschema draaien. Claude Desktop hoeft daarvoor niet open te blijven. Tot die hosting en de echte Meta-accountgegevens zijn aangesloten, is de adapter lokaal gebouwd en mock-getest maar publiceert hij nog niet naar Dopa's echte accounts.

De preview toont nu de geplande campagne. Om ook de reeds bestaande live Instagram-feed boven of onder de nieuwe tegels te tonen, wordt in de accountfase de read-koppeling toegevoegd; de pagina meldt dit nu expliciet en doet niet alsof hij de huidige live feed al kent.

### Google Business Profile

- Google Cloud-project en OAuth-client.
- Toegang tot de Business Profile APIs.
- Dopa-account- en locatie-ID.
- Definitieve call-to-actionregels en bestemmingslinks.

### Google Merchant Center

- Merchant Center-account-ID.
- Promotions-programma actief.
- Promotions data source.
- Doelland, taal en redemption channel.
- Productfeed en eventueel gekoppeld Google Ads-account.

## Opslag en privacy

Standaard schrijft de server plannen, previews en outbox-items onder `work/content-planner`. Met `DOPA_MEDIA_ROOT` wordt vastgelegd uit welke lokale map de preview goedgekeurde media mag kopiëren; paden daarbuiten worden geweigerd. Voor Claude Desktop wordt een expliciete privémap ingesteld met `DOPA_CONTENT_PLANNER_ROOT`. Tokens en wachtwoorden horen nooit in die map of in GitHub; adapters lossen alleen een ondoorzichtige `account_ref` op naar beveiligde credentials.
