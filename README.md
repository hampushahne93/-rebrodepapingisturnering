# 🏓 Pingis Cup 2026

Anmälan, slutspelsträd med comeback-slutspel och live-resultat.
Kollegorna lämnar in sina egna resultat på sidan, och trädet uppdateras för alla inom några sekunder.

## Så hänger det ihop

```
Webbsidan (public/)  ⇄  server.js på Render  ⇄  Neon (databas)
```

- **public/index.html**: själva sidan (design och flikar)
- **public/app.js**: hämtar läget från servern var 4:e sekund och skickar in anmälningar och resultat
- **public/bracket.js**: slutspelslogiken (grupper, comeback, semifinal). Både sidan och servern använder den.
- **server.js**: tar emot anmälningar och resultat, kontrollerar poängen och sparar allt i Neon

---

## 1. Skapa databasen i Neon

1. Logga in på [neon.tech](https://neon.tech) och skapa ett nytt projekt, t.ex. `pingis-cup`.
2. Välj en region i Europa, t.ex. Frankfurt.
3. Klicka på **Connect** och kopiera **connection string**. Den ser ut ungefär så här:
   `postgresql://user:lösenord@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`

Du behöver inte skapa några tabeller själv. Servern gör det första gången den startar.

## 2. Lägg upp koden på GitHub

Skapa ett nytt repo och ladda upp hela mappen, med samma struktur:

```
package.json
server.js
README.md
public/index.html
public/app.js
public/bracket.js
```

## 3. Skapa tjänsten på Render

1. På Render: **New → Web Service** och välj ditt GitHub-repo.
2. Inställningar:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
3. Under **Environment** lägger du till:

| Namn | Värde |
|---|---|
| `DATABASE_URL` | connection string från Neon |
| `ADMIN_CODE` | en hemlig kod som bara du vet, t.ex. `pingis-boss-2026` |
| `DEADLINE` | *(valfri)* sista anmälan, t.ex. `2026-11-20T23:59:00+01:00` |
| `LOCK_BRACKET` | *(valfri)* `true` = trädet är hemligt tills deadline. Standard är `false`. |

4. Klicka **Deploy**. När det står *Live* får du en adress, t.ex. `https://pingis-cup.onrender.com`. Det är länken du skickar till kollegorna.

> **Bra att veta om Renders gratisnivå:** tjänsten somnar efter en stunds inaktivitet. Den som öppnar sidan först kan därför få vänta en halv minut innan den laddar. Därefter går allt snabbt. Datan ligger kvar i Neon, så ingenting försvinner.

---

## Admin

Längst ner under fliken **Lämna in resultat** finns **🔑 Admin**. Logga in med din `ADMIN_CODE`. Därefter kan du:

- **Lotta om trädet** (alla resultat nollställs)
- **Nollställa alla resultat**
- **Lägga till testspelare**, för att prova sidan
- **Rensa allt** inför den riktiga turneringen
- **Klicka på en spelare i trädet** för att rätta en vinnare eller ta bort ett felaktigt resultat
- **Ta bort spelare** under Deltagare (✕ på kortet)

## Hur lottningen fungerar

- Trädet lottas automatiskt. Är `LOCK_BRACKET=true` sker det när anmälan stänger, annars direkt.
- Om en ny spelare anmäler sig innan deadline lottas trädet om och resultaten nollställs. Spela alltså inga riktiga matcher förrän anmälan är stängd.

## Testa lokalt (valfritt)

```bash
npm install
ADMIN_CODE=test npm start
```

Öppna sedan http://localhost:3000. Utan `DATABASE_URL` sparas allt bara i minnet tills du stänger servern.
