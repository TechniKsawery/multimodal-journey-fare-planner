# Projekt UI PWA (web/)

Cel: przejrzyście i lekko, tak samo dobrze na PC i na telefonie. Nie powielamy
`research/ui-projekt.md` w całości: z niego bierzemy 3 statusy ceny, źródło+datę
i ostrzeżenie o legitymacji; resztę upraszczamy.

## Zasady
1. **Pierwszy ekran = tylko to, co potrzebne**: trasa, data, jeden zwinięty wiersz „Profil", przycisk szukaj. Ulgi i BahnCard są w rozwijanym profilu (zapamiętane w localStorage).
2. **Karta wyniku = 3 informacje**: godziny i czas z przesiadkami, cena (z widełkami), jeden status. Wszystko inne (odcinki, źródła, daty weryfikacji, uwagi) jest za przyciskiem „Szczegóły i źródła".
3. **Status ceny zawsze widoczny**: `✓ Oficjalna taryfa` / `≈ Szacunek` / `? Niepotwierdzona`: ikona + tekst, nie sam kolor. Karta pokazuje najsłabszy status odcinków.
4. **Nie zgadujemy cen**: odcinek bez ceny pokazuje „—", a suma jest oznaczona „Suma częściowa" i w rankingu ceny ląduje na końcu (nie wygrywa jako „najtańsza").
5. **Responsywność**: jedna kolumna do 900 px; od 900 px lewy panel (formularz, przyklejony) + prawa lista wyników. Te same komponenty, bez osobnego widoku mobilnego.
6. **Lekkość**: Preact, zero bibliotek UI, czysty CSS (~2 kB gzip), JS ok. 11 kB gzip. Brak obrazków i fontów zewnętrznych (czcionka systemowa).
7. **Dostępność**: cele dotykowe >= 44 px, link „Przejdź do wyników", `aria-expanded`, widoczny focus, `prefers-reduced-motion`, kontrast w obu motywach.
8. **Motyw**: Auto (systemowy) / jasny / ciemny, tokeny CSS na `:root`.

## Co jest przykładowe
`src/data.ts` to dane przykładowe z widocznym banerem. Podłączenie `core/` (port silnika cen) to osobne zadanie; kontrakt widoku to `src/types.ts` (`Itinerary`, `Leg`, `PriceStatus`).

## Do zrobienia później
Autouzupełnianie miejsc, tłumaczenia DE/ES/FR/NL (teraz PL/EN), sekcja „inny dzień", atrakcje i karty miejskie, manifest i Service Worker (zakres szkieletu PWA).
