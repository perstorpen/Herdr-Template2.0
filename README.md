# Herdr-Template2.0

En färdig arbetsmiljö för Claude Code i terminalen. Den bygger på [herdr](https://herdr.dev), som håller flera
chattar med Claude igång bredvid varandra, och lägger till det som gör dem lätta att jobba med:

- **Fyra chattar** i samma mapp: `Main Building`, `Interface`, `Questions` och `Side Quests`. Ge varje chatt sin sorts
  uppdrag, så slipper de trampa på varandra.
- **To Do List**, en egen flik med en lista som både du och chattarna kan använda. Skriv `to do ...` i en chatt så hamnar
  det på listan, och färga punkter lila för att låta en chatt göra dem.
- **Kontroll**, en flik med punkter att kolla i det du bygger. Varje gång en chatt ändrar något lägger den upp var du
  ska klicka och vad du ska se, och du svarar Bra eller Fel. Det du säger är fel rättas först.
- **En räknare för tokens och dollar** i statusraden: hur mycket den här chatten, den här månaden och allt sedan
  installationen har använt, plus hur mycket av ditt Claude-abonnemang som är kvar.
- **Knappar under skrivrutan**: `/compact`, hur mycket Opus ska tänka (`low` till `max`) och `månad`, som visar
  tokens och dollar för varje månad.
- **Paus vid 95 %**: när nästan hela sessionen (5-timmarsfönstret) är använd stannar chattarna, så att det sista räcker
  till småsaker. Du väljer själv vilken chatt som får fortsätta.
- **Uppdateringar med ett ord**: statusraden säger till när det finns en ny version, och `uppdatera` hämtar den.
- **Kommandona** `info`, `uppdatera`, `kontroll genomgång`, `to do`, `do list`, `gör punkt N`, `agent`, `time` och `pause`. Skriv `info` i en chatt för att
  se alla.

Allt börjar tomt: listan, räknaren och månaderna fylls när du använder mallen.

---

## Det här behöver du

- En dator med **Windows 10 eller 11** (eller Linux).
- Ett **Claude-konto** med Claude Code: Pro, Max, Team eller Enterprise.
- Ungefär **15 minuter**.

---

## Installera

Du gör tre korta steg själv och klistrar sedan in en mening till Claude, som installerar resten åt dig.

Allt i rutorna nedan kopierar du och klistrar in. I Ubuntu klistrar du in med **högerklick**, och kör med **Enter**.

### 1. Skaffa Ubuntu

Mallen körs i Ubuntu, som körs inuti Windows.

1. Tryck på **Start**, skriv `PowerShell`, högerklicka och välj **Kör som administratör**.
2. Klistra in:
   ```powershell
   wsl --install -d Ubuntu
   ```
3. **Starta om datorn** när den ber om det.
4. Ubuntu öppnas efter omstarten (annars: Start → `Ubuntu`). Välj ett **användarnamn** (små bokstäver) och ett
   **lösenord**. Lösenordet syns inte när du skriver, det är normalt. Skriv upp det.

Har du inte **Windows Terminal**, hämta den gratis i Microsoft Store. Där öppnar du Ubuntu med pilen **˅** bredvid
flikarna. På Linux hoppar du över hela steg 1.

### 2. Lägg in Claude

Klistra in i Ubuntu. Den frågar efter lösenordet från steg 1:

```bash
sudo apt update && sudo apt install -y git curl xz-utils python3 libatomic1
```

När du kan skriva igen, klistra in:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Stäng Ubuntu och öppna den igen.**

### 3. Logga in på Claude

```bash
claude
```

Claude visar en länk. Öppna den, logga in med ditt Claude-konto och klistra in koden du får tillbaka. Svara **ja** när
den frågar om du litar på mappen.

### 4. Be Claude installera mallen

Klistra in den här meningen i Claude:

```
Installera Herdr-Template2.0 åt mig. Följ instruktionerna i https://raw.githubusercontent.com/perstorpen/Herdr-Template2.0/main/lib/claude-install.md
```

Claude installerar allt och berättar vad den gör. Svara **ja** när den frågar om den får köra något. När den är klar
säger den åt dig att gå vidare till steg 5.

### 5. Starta mallen

Stäng Windows Terminal **helt**, öppna Ubuntu igen och skriv:

```bash
herdr-template ~/mitt-projekt
```

`mitt-projekt` är mappen chattarna jobbar i. Välj vilket namn du vill; den skapas om den inte finns.

herdr öppnas med flikarna **Main Building · Interface · Questions · Side Quests · To Do List · Kontroll**. Svara **ja** när en
chatt frågar om du litar på mappen, och skriv **`info`** för att se alla kommandon.

Nästa gång skriver du samma rad igen, och allt öppnas som du lämnade det.

---

## Använda mallen

### Flikarna

| Flik | Vad den är till |
|---|---|
| Main Building | Huvudarbetet: det du bygger. |
| Interface | Utseende och gränssnitt. |
| Questions | Frågor och förklaringar, utan att störa de andra. |
| Side Quests | Det som kommer upp på vägen och inte ska blanda sig med huvudarbetet. |
| To Do List | Listan. Klicka på en punkt för att se förklaringen och välja färg. |
| Kontroll | Punkter att kolla i det du bygger. Klicka Bra eller Fel. |

Alla fyra är vanliga Claude Code-chattar. Namnen är bara ett förslag på hur du delar upp arbetet. Byt flik med musen
eller **Tab**.

### Kommandon

Skriv dem som ett eget meddelande i en chatt.

| Skriv | Vad som händer |
|---|---|
| `info` | Visar vad mallen är och alla kommandon. Kostar inga tokens. |
| `uppdatera` | Hämtar den nyaste versionen av mallen och visar vad som är nytt. Kostar inga tokens. |
| `kontroll genomgång` | Chatten går igenom hela systemet du bygger och lägger upp punkter i Kontroll för allt som finns. Gör det en gång, när du börjar använda Kontroll. |
| `to do <vad som ska göras>` | Lägger det på To Do List i stället för att skicka det till chatten. Flera saker i samma meddelande blir flera punkter. Claude Haiku skriver en kort titel och en förklaring till varje punkt. |
| `do list` | Chatten gör alla punkter du har färgat lila. Finns inga lila händer inget. |
| `gör punkt 3` | Chatten gör punkt 3 (vilket nummer som helst). |
| `agent 2 <uppgift>` | Uppgiften körs med 2 extra agenter som jobbar samtidigt. `agent 0` betyder inga, `agent rec` låter chatten välja. |
| `time` | Chatten uppskattar hur länge de andra chattarna som jobbar har kvar. |
| `pause` | Visar pausen och hur mycket av sessionen som är använd. |
| `pause 90` | Chattarna pausar vid 90 % i stället för 95 % (vilket tal som helst). `pause off` stänger av, `pause on` sätter 95 igen. |
| `fortsätt` | I en pausad chatt: den jobbar vidare tills sessionen fylls på. Vad som helst du skriver i en pausad chatt gör samma sak. |

Utan `agent`-kommandot väljer chatten själv om ett uppdrag ska få extra agenter, och den första raden i svaret visar
valet, till exempel `Agenter: +1 – två delar som inte rör samma filer`. Frågor och korta svar får inga extra agenter.
Varje agent drar av din användning.

En chatt säger alltid tydligt hur långt den har kommit. Så länge agenter eller tester arbetar börjar dess meddelande med
en röd rad `PÅGÅENDE` och vad som fortfarande körs. Först när allt är färdigt och inget arbete pågår börjar rapporten med
en grön rad `100 % KLART`. Chatten avslutar inte sitt svar medan dess agenter arbetar.

### To Do List

| Färg | Betyder |
|---|---|
| Vit | Inte påbörjad. |
| Lila | Görs vid nästa `do list`. Bara du sätter lila. |
| Gul | En chatt jobbar på den. |
| Blå | Chatten säger att den är klar, och den väntar på att du kollar. |
| Grön | Du har kollat och godkänt den. Bara du sätter grönt. |

Chattarna sätter gult och blått själva. I fliken: pil upp och ner väljer, mellanslag eller Enter öppnar en punkt, pil
vänster och höger byter färg och Esc stänger. **Ctrl+Z** ångrar, **Rensa klara** tar bort de gröna, och mushjulet
skrollar.

### Kontroll

Kontroll är till för att du ska veta att det chattarna bygger faktiskt fungerar, utan att läsa koden.

1. **Första gången:** skriv `kontroll genomgång` i en chatt. Den läser igenom systemet och lägger upp en punkt för varje
   sak du kan kolla, grupperade efter systemets egna delar (flikar, sidor, menyer). I ett stort system tar det en stund.
2. **Sedan av sig själv:** varje gång en chatt ändrar något du kan se eller göra, lägger den upp nya punkter och räknar
   upp dem i slutet av sitt svar.
3. **Du går igenom dem** i fliken Kontroll: klicka på en grupp för att öppna den, och på en punkt för att svara.
   Varje punkt säger vad som ändrades, var du ska klicka och vad du ska se.

| Färg | Betyder |
|---|---|
| Vit | Inte kollad än. |
| Grön | Du har sagt **Bra**. |
| Röd | Du har sagt **Fel** och skrivit vad som var fel. Chattarna rättar röda punkter innan de bygger något nytt i samma del. |
| Gul | En chatt håller på att rätta det du sa var fel. |
| Blå | En chatt har rättat det du sa var fel. Kolla igen. |

Bara du sätter grönt och rött. En chatt kan också prova en punkt själv och skriva vad den såg, som en anteckning bredvid
punkten. Det är inget svar. Du kan även svara i en chatt, till exempel `K3 är fel, knappen syns inte`.

Listan sparas i projektmappen som `kontroll.jsonl`. Ligger projektet i git följer den med, så alla som jobbar med
projektet ser samma punkter. Punkterna skrivs på samma språk som systemets egna sidor och knappar.

### Knapparna under skrivrutan

| Knapp | Vad den gör |
|---|---|
| `/compact` | Gör chattens historik kortare, så att den får plats och kostar mindre. |
| `low` `medium` `high` `xhigh` `max` | Hur mycket Opus tänker, bara i den här chatten och också efter en omstart. Syns bara när chatten kör Opus. |
| `månad` | Fäller ut tokens och dollar för varje månad, den nyaste först. Tryck igen för att stänga. |

Mallen färgar också dina egna meddelanden gröna och skriver **✔ KLAR** när en chatt är helt färdig med sitt svar.

### Statusraden

```
 Claude │ mitt-projekt main │ Uppdrag 12m │ +40 −3
 Kontext ██░░░░░░░░ 21% 210k/1.0M │ Månad nov 41.2M ≈ $18.40
 Session ███████░░░ 70% 14:20 │ Vecka ███░░░░░░░ 31% fre 09:00 · prognos 72%
 Totalt 41.2M ≈ $18.40 288 L (↑2.1M ↓0.4M cache 38.7M) │ Chatt 3.4M ≈ $1.90 24 L │ 6 chattar
```

| Rad | Visar |
|---|---|
| 1 | Modellen och effort, mappen och git-grenen, **Uppdrag**, och rader som lagts till och tagits bort. Uppdrag är tiden chatten har jobbat med det du senast skrev: den stannar när chatten är färdig och står kvar tills du skriver något nytt. |
| 2 | **Kontext**: hur full chatten är. Blir den full, tryck `/compact`. **Månad**: tokens och dollar den här kalendermånaden. |
| 3 | **Session** (5 timmar) och **Vecka**: hur mycket av abonnemanget som är använt och när det fylls på. `prognos` är var veckan landar i nuvarande takt. |
| 4 | **Totalt**: alla tokens sedan installationen, i dollar och i kylvatten för datahallen. **Chatt**: bara den här chatten. |

Staplarna byter färg gradvis från grönt via gult till rött. Session och Vecka är gröna upp till 50 % och nästan helt röda
vid 80 %. Kontext är grön upp till 250k tokens och helt röd från 400k: då är det dags för `/compact`.

**Dollarn är en uppskattning till API-listpris.** Den visar vad samma användning skulle kosta med en API-nyckel, inte
vad ditt abonnemang kostar. Räknaren läser chattarnas egna loggar på den här datorn; den skickar inget någonstans.

---

## Uppdatera

När det finns en ny version visar statusraden **⬆ Ny version: skriv uppdatera**. Skriv då i en chatt:

```
uppdatera
```

Mallen hämtar den nya versionen, installerar den och visar vad som är nytt. Stäng sedan Windows Terminal och starta
mallen igen. Din lista, Kontroll och räknaren påverkas inte. Allt som har ändrats står i [CHANGELOG.md](CHANGELOG.md).

## Ta bort

Starta `claude` i Ubuntu och klistra in:

```
Ta bort Herdr-Template2.0 åt mig. Följ instruktionerna i https://raw.githubusercontent.com/perstorpen/Herdr-Template2.0/main/lib/claude-install.md
```

---

## Om något inte fungerar

| Problem | Gör så här |
|---|---|
| Ikonerna i statusraden är rutor eller frågetecken | Teckensnittet saknas. Be Claude installera mallen igen (meningen i steg 4), starta om Windows Terminal, och kontrollera under Inställningar → Ubuntu → Utseende att teckensnittet är *CaskaydiaMono NF*. På Linux: installera en [Nerd Font](https://www.nerdfonts.com) och välj den i terminalen. |
| `herdr-template: command not found` | Starta om terminalen. Hjälper det inte: `source ~/.bashrc`. |
| Statusraden visar `väntar på data` vid Session och Vecka | Det visas tills chatten har fått sitt första svar. Med en API-nyckel i stället för ett abonnemang kommer de raderna aldrig. |
| Knapparna under skrivrutan syns inte | Starta en ny chatt (`/exit` och sedan `claude`, eller starta om mallen). Kontrollera att `CLAUDE_CODE_PLUGIN_DIRS` i `~/.claude/settings.json` pekar på `~/Herdr-Template2.0/mod`. |
| `to do` lägger inget på listan | Det tar några sekunder, eftersom Claude Haiku skriver punkterna. Fliken To Do List öppnas av sig själv om den saknas. |
| En chatt säger att den är pausad | Över 95 % av sessionen är använd. Skriv `fortsätt` för att låta den jobba ändå, eller `pause off` för att stänga av pausen. |
| `Could not resolve host: github.com` | Ubuntu har tappat nätverket, vanligt i en nyinstallerad WSL. Skriv `wsl --shutdown` i PowerShell, öppna Ubuntu igen och prova på nytt. |
| `claude: command not found` | Stäng Ubuntu och öppna den igen. |
| Något annat | Be Claude installera mallen igen (meningen i steg 4). Det rättar det som saknas och rör inte dina listor eller räknaren. |

## Var allt ligger

| Vad | Var |
|---|---|
| Mallen själv | `~/Herdr-Template2.0` |
| To Do List, räknaren, månaderna, pausens inställning, effort per chatt | `~/.claude/herdr-template/` |
| Kontroll | `kontroll.jsonl` i projektmappen |
| Claude Codes inställningar, som mallen lagt till i | `~/.claude/settings.json` |
| herdrs utseende | `~/.config/herdr/config.toml` |
| Säkerhetskopior från installationen | `~/.herdr-template-backups/` |

Mallen kan hämtas och användas av vem som helst. Ändringar i själva repot på GitHub görs bara av ägaren, men du kan
ändra din egen kopia på datorn hur du vill. `git pull` säger till om en uppdatering krockar med något du ändrat.

## För den som vill ändra i mallen

| Del | Fil |
|---|---|
| Installationen | `install.sh` (kan också köras för hand), `lib/claude-install.md` (det Claude följer i steg 4), `lib/merge-settings.js`, `config/settings.template.json` |
| Flikarna | `start.sh` |
| To Do List och kommandot `to do` | `todo/todo.js` |
| Statusraden och räknaren | `statusline/statusline.js` |
| Knapparna under skrivrutan | `mod/` (en mod för Claude Code) |
| Kontroll och `kontroll genomgång` | `kontroll/kontroll.js` |
| `info`, `uppdatera`, `pause`, `agent`, `time`, klockan bakom Uppdrag | `hooks/` |
| Versionen och vad som är nytt | `version.txt`, `CHANGELOG.md` |
| herdrs utseende | `config/herdr-config.toml` |

Testerna: `./test.sh`.
