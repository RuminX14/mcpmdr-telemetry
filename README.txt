MCPMDR — System Telemetrii Radiosond

Struktura:
  /index.html
  /assets/style.css
  /assets/app.js
  /api/radiosondy.js

Uruchomienie lokalne:
  - Postaw prosty serwer HTTP (np. npx serve . lub Python: python -m http.server 8080)
  - Wejdź na http://localhost:8080

Wdrażanie na Vercel:
  - Import repozytorium do Vercel (Framework preset: Other)
  - /api/radiosondy.js jako Serverless Function (Node.js 18+)
  - Budowanie: statyczne (brak frameworków), output: root
  - Po wdrożeniu wejdź na / aby zalogować się hasłem MCPMDR

Uwaga TTGO Mixed Content:
  - Jeśli hostujesz stronę po HTTPS, a TTGO podaje HTTP, przeglądarka zablokuje żądanie.
  - Rozwiązanie: uruchom stronę lokalnie po HTTP lub użyj tunelu/zwrotki HTTPS do TTGO.

Checklist:
  - Overlay logowania działa, sesja w sessionStorage
  - Mapa + panel danych bez nakładania, responsywny layout
  - Dane przez /api/radiosondy z cache i timeoutem
  - Wykresy scatter (Chart.js), fullscreen zakrywa wszystko
