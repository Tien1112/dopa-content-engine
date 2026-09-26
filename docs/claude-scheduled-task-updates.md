# Claude scheduled tasks aansluiten op de Dopa Content Engine

De bestaande maandtaken blijven in Claude. Airbyte en BigQuery blijven de
bronroutes voor ruwe GA4- en Search Console-data. De scheduled tasks slaan
alleen het afgeleide rapport en de aanbevelingen op in de Dopa-workspace.

Voor beide taken moet in het Claude-account de persoonlijke connector
`Dopa Content Engine` beschikbaar zijn.

## Search Console en GA4

Laat meet-ID `G-HW7K5HC6R4` in de bestaande taak staan. Dit is het ID dat de
publieke productie-storefront daadwerkelijk laadt. Airbyte leest op dit moment
nog property `553701814`; die property hoort bij de oude Shopify-stream
`G-66V2CK347E` en moet afzonderlijk naar de property van de live storefront
worden omgezet voordat GA4-data in de Content Engine volledig betrouwbaar is.

Voeg vlak voor het onderdeel `Versturen per e-mail` dit blok toe:

```text
Dopa Content Engine:

- Gebruik aan het begin de connector Dopa Content Engine en roep
  dopa_get_learning_snapshot aan met days: 30. Gebruik dit als aanvullende
  campagnecontext. GA4 en Search Console blijven via Airbyte en BigQuery de
  bron van ruwe meetdata; schrijf die ruwe data niet nogmaals weg.
- Nadat het rapport definitief is, maar voordat je de e-mail verstuurt, roep
  dopa_record_user_input aan met:
  - input_type: other
  - title: Maandrapport Search Console en GA4 JJJJ-MM
  - content: het volledige definitieve rapport. Is het rapport langer dan
    45.000 tekens, bewaar dan de samenvatting, kerncijfers, de vier bakken,
    trechter en maximaal vijf acties.
  - occurred_at: de huidige datum als JJJJ-MM-DD
- Roep daarna opnieuw dopa_get_learning_snapshot aan met days: 30 en controleer
  of de zojuist opgeslagen titel bij de strategie-input staat.
- Is de connector niet beschikbaar of mislukt het opslaan, voer de analyse en
  e-mail verder normaal uit. Noteer in het laatste bericht letterlijk:
  "Niet opgeslagen in Dopa Content Engine". Probeer het rapport niet via een
  andere database of connector op te slaan.
```

## AI-zichtbaarheid

Voeg vlak voor het onderdeel `Versturen per e-mail` dit blok toe:

```text
Dopa Content Engine:

- Gebruik aan het begin de connector Dopa Content Engine en roep
  dopa_get_learning_snapshot aan met days: 30. Gebruik de gemeten winnaars en
  actuele Dopa-strategie alleen als context; verander nooit de vaste set van
  twintig zichtbaarheidstests.
- Nadat het rapport definitief is, maar voordat je de e-mail verstuurt, roep
  dopa_record_user_input aan met:
  - input_type: other
  - title: Maandrapport AI-zichtbaarheid JJJJ-MM
  - content: het volledige definitieve rapport. Is het rapport langer dan
    45.000 tekens, bewaar dan de samenvatting, scoretabel, belangrijkste
    concurrenten en maximaal drie aanbevelingen.
  - occurred_at: de huidige datum als JJJJ-MM-DD
- Roep daarna opnieuw dopa_get_learning_snapshot aan met days: 30 en controleer
  of de zojuist opgeslagen titel bij de strategie-input staat.
- Is de connector niet beschikbaar of mislukt het opslaan, voer de analyse en
  e-mail verder normaal uit. Noteer in het laatste bericht letterlijk:
  "Niet opgeslagen in Dopa Content Engine". Probeer het rapport niet via een
  andere database of connector op te slaan.
```

## Bewijs dat de koppeling werkt

Een aangepaste taak geldt pas als aangesloten wanneer een echte run:

1. het maandrapport heeft gemaakt;
2. `dopa_record_user_input` succesvol heeft uitgevoerd;
3. de titel in een daaropvolgende `dopa_get_learning_snapshot` zichtbaar is;
4. het rapport naar uitsluitend de twee vooraf goedgekeurde adressen is
   verzonden.
