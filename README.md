# Herdr-Template2.0

En färdig arbetsmiljö för Claude Code i terminalen. Den bygger på [herdr](https://herdr.dev), som håller flera
chattar med Claude igång bredvid varandra, och lägger till det som gör dem lätta att jobba med:

- **Fyra chattar** i samma mapp: `Main Building`, `Interface`, `Questions` och `Side Quests`. Ge varje chatt sin sorts
  uppdrag, så slipper de trampa på varandra.
- **To Do List**, en egen flik med en lista som både du och chattarna kan använda. Skriv `to do ...` i en chatt så hamnar
  det på listan, och färga punkter lila för att låta en chatt göra dem.
- **En räknare för tokens och dollar** i statusraden: hur mycket den här chatten, den här månaden och allt sedan
  installationen har använt, plus hur mycket av ditt Claude-abonnemang som är kvar.
- **Knappar under skrivrutan**: `/compact`, hur mycket Opus ska tänka (`low` till `max`) och `månad`, som visar
  tokens och dollar för varje månad.
- **Paus vid 95 %**: när nästan hela sessionen (5-timmarsfönstret) är använd stannar chattarna, så att det sista räcker
  till småsaker. Du väljer själv vilken chatt som får fortsätta.
- **Kommandona** `info`, `to do`, `do list`, `gör punkt N`, `agent`, `time` och `pause`. Skriv `info` i en chatt för att
  se alla.

Allt börjar tomt: listan, räknaren och månaderna fylls när du använder mallen.

---

## Det här behöver du

- **Ett Claude-konto med Claude Code**: Pro, Max, Team eller Enterprise, eller en API-nyckel. Raderna `Session` och
  `Vecka` i statusraden syns bara med ett abonnemang (Pro, Max och liknande).
- **En dator med Windows 10/11 eller Linux.** På Mac fungerar det mesta, men installationsskriptet är gjort för Ubuntu.
- **Ungefär 15 minuter** första gången.

---

## Installera

Det enklaste är att du gör tre saker själv och låter Claude göra resten. Varje rad nedan kopierar du och klistrar in. I
Ubuntu klistrar du in med **högerklick** eller **Ctrl+Shift+V**, och kör raden med **Enter**.

### Steg 1: skaffa Ubuntu (bara Windows)

Mallen körs i Ubuntu, som körs inuti Windows. Du behöver ingen ny dator.

1. Tryck på **Start**, skriv `PowerShell`, högerklicka på det och välj **Kör som administratör**.
2. Klistra in och tryck Enter:
   ```powershell
   wsl --install -d Ubuntu
   ```
3. **Starta om datorn** när den ber om det.
4. Ubuntu öppnas av sig själv efter omstarten (gör den inte det: Start → skriv `Ubuntu` → öppna). Den ber dig välja ett
   **användarnamn** (små bokstäver, inga mellanslag) och ett **lösenord**. Lösenordet syns inte medan du skriver, det
   är normalt. Skriv upp det, du behöver det i nästa steg.
5. Har du inte **Windows Terminal**: hämta den gratis från Microsoft Store. Ubuntu finns sedan som en flik där (pilen
   **˅** bredvid flikarna), och mallen ser bäst ut där.

På Linux hoppar du över det här steget och öppnar en terminal.

### Steg 2: förbered Ubuntu

Klistra in i Ubuntu och tryck Enter. Den frågar efter lösenordet från steg 1:

```bash
sudo apt update && sudo apt install -y git curl xz-utils python3 libatomic1
```

Det tar en eller ett par minuter. Den är klar när du kan skriva igen.

### Steg 3: installera Claude Code

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Stäng sedan Ubuntu och öppna den igen**, så att kommandot `claude` hittas.

### Steg 4: starta Claude och logga in

```bash
claude
```

Första gången väljer du utseende och loggar in: Claude visar en länk, du öppnar den i webbläsaren, loggar in med ditt
Claude-konto och klistrar in koden du får tillbaka. Svara **ja** när den frågar om du litar på mappen.

### Steg 5: be Claude installera mallen

Klistra in den här meningen i Claude och tryck Enter:

```
Installera Herdr-Template2.0 åt mig. Följ instruktionerna i https://raw.githubusercontent.com/perstorpen/Herdr-Template2.0/main/CLAUDE-INSTALL.md
```

Claude hämtar mallen, installerar resten (Node, herdr, inställningarna och teckensnittet för ikonerna) och berättar vad
den gör. Ibland frågar den om den får köra ett kommando: svara **ja**. Till sist säger den vad du ska göra, och det är
steg 6.

### Steg 6: starta mallen

1. Stäng Windows Terminal **helt** (alla fönster) och öppna Ubuntu igen.
2. Skriv, med valfritt namn på mappen:
   ```bash
   herdr-template ~/mitt-projekt
   ```

Mappen skapas om den inte finns. herdr öppnas med flikarna:

**Main Building · Interface · Questions · Side Quests · To Do List**

- **Svara ja** när en chatt frågar om du litar på mappen. Det gör varje chatt en gång per mapp.
- Skriv **`info`** i en chatt för att se alla kommandon.

Nästa gång skriver du samma rad igen. Sessionen öppnas som du lämnade den, och det som har stängts startas igen. Utan
mapp (`herdr-template`) används mappen du står i. Ett eget namn på sessionen: `herdr-template ~/mitt-projekt projektet`.

### Installera utan Claude

Vill du hellre köra installationen själv, efter steg 2:

```bash
git clone https://github.com/perstorpen/Herdr-Template2.0.git ~/Herdr-Template2.0
~/Herdr-Template2.0/install.sh
```

Skriptet hoppar över det som redan finns och kan köras igen när som helst. Det gör det här:

1. Installerar `curl`, `git`, `python3`, `xz-utils` och `libatomic1` om de saknas (frågar efter lösenordet).
2. Installerar **Node** (i `~/.local`, inget i systemet), **Claude Code** och **herdr**.
3. Lägger in mallens inställningar i Claude Code (`~/.claude/settings.json`): statusraden, kommandona och knapparna.
   Har du egna inställningar finns de kvar, och mallen läggs till.
4. Ger herdr mallens utseende (`~/.config/herdr/config.toml`).
5. Skapar kommandot `herdr-template`.
6. På Windows: installerar teckensnittet **CaskaydiaMono Nerd Font** och väljer det i Windows Terminal, så att ikonerna i
   statusraden syns.

En fil som skriptet ersätter sparas först i `~/.herdr-template-backups/<tid>/`. Vill du hoppa över teckensnittet:
`install.sh --no-windows`. Fortsätt sedan med steg 6.

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

Alla fyra är vanliga Claude Code-chattar. Namnen är bara ett förslag på hur du delar upp arbetet. Byt flik med musen
eller **Tab**.

### Kommandon

Skriv dem som ett eget meddelande i en chatt.

| Skriv | Vad som händer |
|---|---|
| `info` | Visar vad mallen är och alla kommandon. Kostar inga tokens. |
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

### Knapparna under skrivrutan

| Knapp | Vad den gör |
|---|---|
| `/compact` | Gör chattens historik kortare, så att den får plats och kostar mindre. |
| `low` `medium` `high` `xhigh` `max` | Hur mycket Opus tänker, bara i den här chatten och också efter en omstart. Syns bara när chatten kör Opus. |
| `månad` | Fäller ut tokens och dollar för varje månad, den nyaste först. Tryck igen för att stänga. |

Mallen färgar också dina egna meddelanden gröna och skriver **✔ KLAR** när en chatt är helt färdig med sitt svar.

### Statusraden

```
 Claude │ mitt-projekt main │ 12m │ +40 −3
 Kontext ██░░░░░░░░ 21% 210k/1.0M │ Månad nov 41.2M ≈ $18.40
 Session ███████░░░ 70% 14:20 │ Vecka ███░░░░░░░ 31% fre 09:00 · prognos 72%
 Totalt 41.2M ≈ $18.40 288 L (↑2.1M ↓0.4M cache 38.7M) │ Chatt 3.4M ≈ $1.90 24 L │ 6 chattar
```

| Rad | Visar |
|---|---|
| 1 | Modellen och effort, mappen och git-grenen, hur länge chatten har pågått, och rader som lagts till och tagits bort. |
| 2 | **Kontext**: hur full chatten är. Blir den full, tryck `/compact`. **Månad**: tokens och dollar den här kalendermånaden. |
| 3 | **Session** (5 timmar) och **Vecka**: hur mycket av abonnemanget som är använt och när det fylls på. `prognos` är var veckan landar i nuvarande takt. |
| 4 | **Totalt**: alla tokens sedan installationen, i dollar och i kylvatten för datahallen. **Chatt**: bara den här chatten. |

**Dollarn är en uppskattning till API-listpris.** Den visar vad samma användning skulle kosta med en API-nyckel, inte
vad ditt abonnemang kostar. Räknaren läser chattarnas egna loggar på den här datorn; den skickar inget någonstans.

---

## Uppdatera

```bash
cd ~/Herdr-Template2.0 && git pull && ./install.sh
```

Stäng sedan herdr (eller starta om terminalen) och starta mallen igen. Din lista och räknaren påverkas inte.

## Ta bort

1. Ta bort raderna med `Herdr-Template2.0` i `~/.claude/settings.json`, eller lägg tillbaka säkerhetskopian från
   `~/.herdr-template-backups/`.
2. `rm ~/.local/bin/herdr-template`
3. `rm -rf ~/Herdr-Template2.0`
4. Vill du också ta bort listan, räknaren och pausens inställning: `rm -rf ~/.claude/herdr-template`

Claude Code, herdr och Node finns kvar. De tas bort på sina egna sätt.

---

## Om något inte fungerar

| Problem | Gör så här |
|---|---|
| Ikonerna i statusraden är rutor eller frågetecken | Teckensnittet saknas. Kör `install.sh` igen, starta om Windows Terminal, och kontrollera under Inställningar → Ubuntu → Utseende att teckensnittet är *CaskaydiaMono NF*. På Linux: installera en [Nerd Font](https://www.nerdfonts.com) och välj den i terminalen. |
| `herdr-template: command not found` | Starta om terminalen. Hjälper det inte: `source ~/.bashrc`. |
| Statusraden visar `väntar på data` vid Session och Vecka | Det visas tills chatten har fått sitt första svar. Med en API-nyckel i stället för ett abonnemang kommer de raderna aldrig. |
| Knapparna under skrivrutan syns inte | Starta en ny chatt (`/exit` och sedan `claude`, eller starta om mallen). Kontrollera att `CLAUDE_CODE_PLUGIN_DIRS` i `~/.claude/settings.json` pekar på `~/Herdr-Template2.0/mod`. |
| `to do` lägger inget på listan | Det tar några sekunder, eftersom Claude Haiku skriver punkterna. Fliken To Do List öppnas av sig själv om den saknas. |
| En chatt säger att den är pausad | Över 95 % av sessionen är använd. Skriv `fortsätt` för att låta den jobba ändå, eller `pause off` för att stänga av pausen. |
| `Could not resolve host: github.com` | Ubuntu har tappat nätverket, vanligt i en nyinstallerad WSL. Skriv `wsl --shutdown` i PowerShell, öppna Ubuntu igen och prova på nytt. |
| `claude: command not found` efter steg 3 | Stäng Ubuntu och öppna den igen. |
| Något annat | Kör `install.sh` igen. Det rättar det som saknas och skriver inte över dina data. |

## Var allt ligger

| Vad | Var |
|---|---|
| Mallen själv | `~/Herdr-Template2.0` |
| Listan, räknaren, månaderna, pausens inställning, effort per chatt | `~/.claude/herdr-template/` |
| Claude Codes inställningar, som mallen lagt till i | `~/.claude/settings.json` |
| herdrs utseende | `~/.config/herdr/config.toml` |
| Säkerhetskopior från installationen | `~/.herdr-template-backups/` |

Mallen kan hämtas och användas av vem som helst. Ändringar i själva repot på GitHub görs bara av ägaren, men du kan
ändra din egen kopia på datorn hur du vill. `git pull` säger till om en uppdatering krockar med något du ändrat.

## För den som vill ändra i mallen

| Del | Fil |
|---|---|
| Installationen | `install.sh`, `CLAUDE-INSTALL.md` (instruktionerna Claude följer i steg 5), `lib/merge-settings.js`, `config/settings.template.json` |
| Flikarna | `start.sh` |
| To Do List och kommandot `to do` | `todo/todo.js` |
| Statusraden och räknaren | `statusline/statusline.js` |
| Knapparna under skrivrutan | `mod/` (en mod för Claude Code) |
| `info`, `pause`, `agent`, `time` | `hooks/` |
| herdrs utseende | `config/herdr-config.toml` |

Testerna: `./test.sh`.
