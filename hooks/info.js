#!/usr/bin/env node
'use strict';
// The "info" command. A UserPromptSubmit hook: when a message is only "info", the chat answers at once with what
// the template is and every command it has, without going to Claude, so it costs no tokens.
const fs = require('fs');

const INFO = `HERDR-TEMPLATE 2.0

En mall för herdr och Claude Code: fyra chattar som jobbar i samma mapp, en To do-lista, en räknare för tokens och
dollar, och knappar under skrivrutan. Starta den med  herdr-template <mapp>  i Ubuntu.

FLIKARNA
  Main Building, Interface, Questions, Side Quests   Fyra chattar med Claude Code i mappen. Ge dem olika sorters uppdrag.
  To Do List                                         Listan. Klicka på en punkt för att se förklaringen och välja färg.

TO DO LIST
  Färgerna   Vit: inte påbörjad.  Lila: görs vid nästa "do list".  Gul: en chatt jobbar på den.
             Blå: chatten är klar och väntar på att du kollar.  Grön: du har godkänt den (bara du sätter grönt).
  Tangenter  Pil upp och ner väljer, mellanslag eller Enter öppnar, pil vänster och höger byter färg, Esc stänger.
             Ctrl+Z ångrar. "Rensa klara" tar bort de gröna. Mushjulet skrollar.

SKRIV I EN CHATT
  info                     Visar den här texten. Kostar inga tokens.
  to do <vad som ska göras>
                           Lägger det på To do-listan i stället för att skicka det till chatten. Flera saker i samma
                           meddelande blir flera punkter.
  do list                  Chatten gör alla punkter du har gjort lila på listan.
  gör punkt 3              Chatten gör punkt 3 på listan (vilket nummer som helst).
  agent 2 <uppgift>        Uppgiften körs med 2 extra agenter. agent 0 betyder inga, agent rec låter chatten välja.
                           Utan kommandot väljer chatten själv och skriver först en rad som "Agenter: +1 – ...".
  time                     Chatten uppskattar hur länge de andra chattarna som jobbar har kvar.
  pause                    Visar pausen: chattarna stannar när 95 % av sessionens tokens är använda.
  pause 90                 Flyttar gränsen till 90 % (vilket tal som helst). pause off stänger av, pause on sätter 95 igen.
  fortsätt                 I en chatt som pausats: den jobbar vidare till sessionen fylls på. Vad som helst du skriver
                           i en pausad chatt gör samma sak.

KNAPPARNA UNDER SKRIVRUTAN
  /compact                 Gör chattens historik kortare, så att den får plats och kostar mindre.
  low medium high xhigh max
                           Hur mycket Opus tänker, bara i den här chatten. Syns bara när chatten kör Opus.
  månad                    Fäller ut tokens och dollar för varje månad. Tryck igen för att stänga.

STATUSRADEN
  Rad 1   Modellen, mappen, git-grenen, tiden och raderna som ändrats.
  Rad 2   Kontext: hur full chatten är.  Månad: tokens och dollar den här månaden.
  Rad 3   Session (5 timmar) och Vecka: hur mycket av ditt Claude-abonnemang som är använt, och när det fylls på.
  Rad 4   Totalt: alla tokens sedan mallen installerades, i dollar och kylvatten.  Chatt: bara den här chatten.
          Dollarn är ett värde till API-listpris, inte vad abonnemanget kostar.

Mer finns i README.md i mallens mapp.`;

const isInfo = prompt => /^\s*info\s*[.!?]?\s*$/i.test(prompt);

function main() {
  let prompt = '';
  try { prompt = JSON.parse(fs.readFileSync(0, 'utf8')).prompt ?? ''; } catch { return; }
  if (isInfo(prompt)) process.stdout.write(JSON.stringify({ continue: false, stopReason: INFO }));
}

if (require.main === module) main();

module.exports = { INFO, isInfo };
