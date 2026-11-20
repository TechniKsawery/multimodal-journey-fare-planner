# Luki w wycenie odcinków (PL↔DE) — stan na 2026-11-20

Analiza: `core/test/pricing.coverage.test.ts` (tabela 42 odcinków typowych tras: Lublin–Gelsenkirchen, Lublin–Berlin,
Warszawa–Berlin, Kraków–Hamburg, Wrocław–Drezno). **Odcinki są syntetyczne** (nazwy agencji i tryby w formacie
Transitous/MOTIS 2, współrzędne prawdziwych dworców), bo `api.transitous.org` jest niedostępny z chmury; nie ma tu
nagranych odpowiedzi na żywo. Gdy ktoś zapisze prawdziwy JSON z `/plan`, trzeba go dodać jako fixture i porównać nazwy agencji.
Tabela nie jest źródłem cen — to opis tego, który moduł i z jakim statusem wycenia odcinek dziś.

## Naprawione (błąd detekcji, dane były)

- **`LONG_DISTANCE` (IC/EC w MOTIS 2) był traktowany jak autobus.** `"RAIL" in mode` go nie łapało, więc odcinek
  IC/EC/DB-IC tracił taryfę PKP/DB/międzynarodową i wpadał w „nieznany operator lokalny". Teraz jest koleją
  (`RAIL_MODE_NAMES` w `core/src/routing/motis.ts` i w oraclu `routing/motis_client.py`, testy po obu stronach).
  Uwaga: `web/src/search/adapt.ts` ma własny zbiór trybów i ten błąd już omija — ale jego własny adapter cen
  (`web/src/search/pricing.ts`) nie używa jeszcze `core/src/routing/pricing.ts` (PR #26), a ten pokrywa dużo więcej.

## Da się wycenić z danych, które mamy (core/pricing.ts), a UI tego jeszcze nie używa

PKP IC krajowe (pasma TLK/IC), PKP IC/DB PL–DE jednym ciągiem (`international_pl_de`, wraz z zakresem SPI),
regionalne i S-Bahn w NRW (eezy.nrw/VRR), taryfy miejskie (Berlin, Hamburg, Monachium, Kolonia, Lublin, Warszawa, Kraków,
Poznań, Wrocław), POLREGIO/KD/KŚ krajowo, KM/KMŁ/SKM/ŁKA, Zgorzelec–Görlitz, Zasieki–Forst.
Odcinki z `price_verified=false` (zapasowe PLN/km, ryczałt 4 zł) trzeba w UI traktować jak „niepotwierdzone"
i nie wliczać do sumy (`priceVerified` / `priceStatus` w `routing/model.ts`).

## Prawdziwe braki danych (bez zgadywania — co trzeba zweryfikować)

| Przewoźnik / relacja | Dziś | Źródło do zweryfikowania |
|---|---|---|
| DB Fernverkehr (ICE/IC) w DE | model Flexpreis (regresja), zawsze „szacunek" | ceny DB są dynamiczne, bahn.de blokuje boty; potrzebna decyzja: pokazywać „od–do" zamiast kwoty albo zostawić niepotwierdzone |
| PKP IC EC/EIC/EIP krajowe | pasma TLK/IC jako szacunek | cennik PKP IC per relacja (intercity.pl) |
| PKP IC / DB Warszawa–Berlin i inne PL–DE | kategoria wg linii prostej, szacunek | oferty „Bilet międzynarodowy" / SPI PL–DE na intercity.pl i bahn.de, per relacja |
| DB Regio, ODEG, metronom, trilex, Die Länderbahn poza NRW i obszarami miast | brak | taryfy landów: VBB (Berlin-Brandenburg), VVO/Sachsentarif, Niedersachsentarif/HVV-Umland, Deutschlandticket (bilet okresowy, nie cena za przejazd — wymaga flagi „mam D-Ticket" w profilu) |
| Koleje Dolnośląskie Wrocław–Görlitz/Zgorzelec, DB Regio Szczecin–Angermünde/Berlin, ODEG Kostrzyn/Frankfurt(O)–Berlin | brak (odcinek transgraniczny przewoźnika spoza PKP IC/DB) | cenniki KD i POLREGIO dla relacji międzynarodowych, VBB/Brandenburg |
| Koleje Wielkopolskie, Arriva RP, inne spółki samorządowe w PL | brak | cenniki poszczególnych spółek (dziś tylko POLREGIO/KD/KŚ/KM/KMŁ/SKM/ŁKA) |
| „Przewozy Regionalne" (nazwa w niektórych feedach) | brak | potwierdzić, że to ta sama spółka co POLREGIO (zmiana nazwy), dopiero wtedy dopisać do `PL_REGIONAL_RAIL_KEYWORDS` |
| FlixBus | zapasowe 0,27 zł/km, niepotwierdzone | brak legalnego API w kliencie (nieoficjalne usunięte); cenniki FlixBus nie są publiczne |
| FlixTrain, RegioJet, BlaBlaBus | brak | strony przewoźników; ceny dynamiczne |
| Transport miejski poza 5 miastami PL i 4 miastami DE (np. Drezno, Lipsk, Hanower, Frankfurt, Stuttgart, Katowice, Łódź MPK, Szczecin, Gdańsk) | ryczałt 4 zł (niepotwierdzony) albo brak | taryfy VVO, MDV, GVH, RMV, VVS, KZK GOP, MPK Łódź, ZDiTM, ZTM Gdańsk |
| Loty | poza zakresem (Travelpayouts to API afiliacyjne) | decyzja z planu: bez cen lotów na żywo |
