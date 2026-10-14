/* ============================================================
   WORTFUCHS · game.js
   ------------------------------------------------------------
   So funktioniert dieses Spiel
   1. Das Lösungswort wird zufällig aus LOESUNGEN (woerter.js) gezogen.
      Als Eingabe gelten LOESUNGEN + ZUSATZ (seltenere Wörter, Plurale),
      abschaltbar über den Schalter "Nur Wörterbuch-Wörter zulassen".
   2. Das Herz ist die reine Funktion bewerteTipp(): Sie vergleicht Tipp und
      Lösung und liefert pro Buchstabe "richtig" / "falscheStelle" /
      "nichtEnthalten". Sie kennt weder DOM noch Speicher und ist deshalb
      mit Node testbar (Testfälle direkt bei der Funktion).
   3. Das DOM bildet den Zustand nur ab: JavaScript setzt data-status an
      Kacheln und Tasten, das CSS (spiel.css) macht daraus Farben und die
      3D-Flip-Animation.
   4. Eingabe: physische Tastatur (document-Listener, nur A–Z) und
      Bildschirmtastatur (ein Listener für alle Tasten) führen in dieselben
      Funktionen: buchstabeEingeben / loeschen / tippAbschicken.
   5. Ablauf einer Runde: laeuft → (Tipp abschicken) auswertung → laeuft ...
      bis gewonnen oder verloren. Während der Flip-Animation ("auswertung")
      ist die Eingabe gesperrt.
   6. Statistik (gespielt, gewonnen, Serie, Rekord-Serie) liegt über storage.js
      im localStorage. Highscore = Siegesserie (Top 3, mehr ist besser).
   7. Arcade-Prinzip: Ein "Run" ist eine ganze Siegesserie und ergibt genau
      EINEN Topliste-Eintrag, und zwar erst, wenn die Serie reißt. Siege zeigen
      nur den schlanken Dialog. Würde man schon nach jedem Sieg eintragen,
      stünde dieselbe laufende Serie als 1, 2, 3 … gleich mehrfach in der Liste.
   ============================================================ */

import { lade, speichere, spielZuruecksetzen } from "./assets/storage.js";
import { bewegungReduziert, toplisteAnzeigen, gameOverDialog, zahlHochzaehlen } from "./assets/ui.js";
import { LOESUNGEN, ZUSATZ, HAEUFIGE } from "./woerter.js";

/* ------------------------------------------------------------
   Konstanten
   ------------------------------------------------------------ */
const SPIEL = "wortfuchs";           // Speicher-Schlüssel (siehe storage.js)
const LAENGE = 5;                    // Buchstaben pro Wort
const VERSUCHE = 6;                  // Zeilen im Raster

// Flip-Animation: JS und CSS teilen sich diese Werte (init() schreibt sie
// als CSS-Variablen), damit sie nie auseinanderlaufen.
const FLIP_DAUER_MS = 500;           // eine Kachel braucht 0,5 s zum Umklappen
const FLIP_VERSATZ_MS = 100;         // jede weitere Kachel startet 0,1 s später

/** Die drei möglichen Auswertungen eines Buchstabens. */
export const RICHTIG = "richtig";
export const FALSCHE_STELLE = "falscheStelle";
export const NICHT_ENTHALTEN = "nichtEnthalten";

// Rangfolge für die Tastatur: höherer Wert = bessere (wertvollere) Information
const RANG = { [NICHT_ENTHALTEN]: 1, [FALSCHE_STELLE]: 2, [RICHTIG]: 3 };

const STATUS_TEXT = {
  [RICHTIG]: "richtig",
  [FALSCHE_STELLE]: "falsche Stelle",
  [NICHT_ENTHALTEN]: "nicht enthalten",
};

// Bildschirmtastatur (QWERTZ). Sonderwerte: "ENTER" und "RUECK".
const TASTEN_REIHEN = [
  ["Q", "W", "E", "R", "T", "Z", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Y", "X", "C", "V", "B", "N", "M", "RUECK"],
];

const SIEG_TEXTE = ["Genial!", "Großartig!", "Stark!", "Gut gemacht!", "Geschafft!", "Puh, knapp!"];

// Ein Set (Menge) statt Array: has() antwortet in praktisch konstanter Zeit,
// ein Array müsste bei includes() die Liste jedes Mal von vorn durchsuchen.
// Ein Set prüft Eingaben in O(1) – bei ~12.500 gültigen Wörtern wichtig.
const GUELTIGE_WOERTER = new Set([...LOESUNGEN, ...ZUSATZ, ...HAEUFIGE]);

/* ============================================================
   TEIL 1 · Reine Funktionen (kein DOM, kein Speicher)
   ============================================================ */

/**
 * Wertet einen Tipp gegen die Lösung aus.
 * Rückgabe: Array mit 5 Einträgen (RICHTIG / FALSCHE_STELLE / NICHT_ENTHALTEN).
 *
 * DAS PROBLEM MIT DOPPELTEN BUCHSTABEN
 * Kommt ein Buchstabe im Tipp öfter vor als in der Lösung, darf nicht jeder
 * davon gelb werden. Gelb gibt es nur so oft, wie der Buchstabe in der
 * Lösung "noch übrig" ist. Und Volltreffer haben Vorrang vor gelben Treffern.
 * Darum arbeitet der Algorithmus in zwei Durchgängen:
 *
 *   Schritt 1: Alle Felder auf "nichtEnthalten" setzen (Ausgangslage).
 *   Schritt 2 (Durchgang 1, Volltreffer): Jede Position vergleichen.
 *              Gleicher Buchstabe an gleicher Stelle → "richtig".
 *              Ist es KEIN Volltreffer, legen wir den Lösungsbuchstaben
 *              dieser Position in einen Vorrat (Zähler pro Buchstabe).
 *              Buchstaben, die schon als Volltreffer vergeben sind, landen
 *              also NICHT im Vorrat – sie sind "verbraucht".
 *   Schritt 3 (Durchgang 2, falsche Stelle): Jede Position, die nicht
 *              richtig ist, schaut in den Vorrat. Ist dort noch ein solcher
 *              Buchstabe → "falscheStelle" und Vorrat um 1 verringern,
 *              sonst bleibt es "nichtEnthalten".
 *
 * TESTFÄLLE (mit Node geprüft, Handrechnung = Ergebnis der Funktion)
 *  1) Lösung OTTER, Tipp TOAST
 *     Durchgang 1: kein Volltreffer. Vorrat: O1, T2, E1, R1.
 *     Durchgang 2: T → gelb (T:1), O → gelb, A → grau, S → grau,
 *                  T → gelb (T:0).
 *     Ergebnis: gelb, gelb, grau, grau, gelb
 *  2) Lösung SONNE, Tipp NENNT
 *     Durchgang 1: Position 2 (N) und 3 (N) sind Volltreffer. Vorrat: S1, O1, E1
 *                  (beide N der Lösung sind verbraucht).
 *     Durchgang 2: N (vorn) → kein N mehr im Vorrat → grau, E → gelb, T → grau.
 *     Ergebnis: grau, gelb, GRÜN, GRÜN, grau
 *     (Ein naiver Ein-Durchgang-Algorithmus würde das erste N fälschlich
 *      gelb machen.)
 *  3) Lösung ANKER, Tipp EIFER
 *     Durchgang 1: E (Pos. 3) und R (Pos. 4) sind Volltreffer. Vorrat: A1, N1, K1.
 *     Durchgang 2: E (vorn) → kein E mehr im Vorrat → grau, I → grau, F → grau.
 *     Ergebnis: grau, grau, grau, GRÜN, GRÜN
 *     (Das zweite E im Tipp bekommt kein Gelb, weil ANKER nur ein E hat.)
 */
export function bewerteTipp(loesung, tipp) {
  // Schritt 1: Ausgangslage – alles "nicht enthalten"
  const ergebnis = new Array(LAENGE).fill(NICHT_ENTHALTEN);
  const vorrat = {};                         // z. B. { O: 1, T: 2 }

  // Schritt 2 / Durchgang 1: Volltreffer und Vorrat füllen
  for (let i = 0; i < LAENGE; i++) {
    if (tipp[i] === loesung[i]) {
      ergebnis[i] = RICHTIG;                 // gleicher Buchstabe, gleiche Stelle
    } else {
      // Nicht verbraucht → steht für gelbe Treffer zur Verfügung
      vorrat[loesung[i]] = (vorrat[loesung[i]] || 0) + 1;
    }
  }

  // Schritt 3 / Durchgang 2: gelbe Treffer aus dem Vorrat bedienen
  for (let i = 0; i < LAENGE; i++) {
    if (ergebnis[i] === RICHTIG) continue;   // schon vergeben
    if (vorrat[tipp[i]] > 0) {               // undefined > 0 ist false → sicher
      ergebnis[i] = FALSCHE_STELLE;
      vorrat[tipp[i]]--;                     // einen Buchstaben "verbrauchen"
    }
  }
  return ergebnis;
}

/**
 * Führt die Tastenfarben mit einem neuen Ergebnis zusammen: Pro Buchstabe
 * bleibt die BESTE bekannte Information (richtig > falsche Stelle > nicht
 * enthalten). Ein später entdecktes "grau" darf ein früheres "grün" also
 * nie überschreiben. Gibt ein neues Objekt zurück (das alte bleibt unverändert).
 */
export function tastenStatusAktualisieren(alt, tipp, status) {
  const neu = { ...alt };
  for (let i = 0; i < tipp.length; i++) {
    const buchstabe = tipp[i];
    const bisher = RANG[neu[buchstabe]] || 0;
    if (RANG[status[i]] > bisher) neu[buchstabe] = status[i];
  }
  return neu;
}

/** Wählt ein zufälliges Lösungswort, nach Möglichkeit nicht das zuletzt gespielte. */
export function waehleLoesung(liste, zufall = Math.random, ausser = null) {
  let index = Math.floor(zufall() * liste.length);
  if (liste[index] === ausser && liste.length > 1) index = (index + 1) % liste.length;
  return liste[index];
}

/** Statistik nach einer beendeten Runde. Gibt ein NEUES Objekt zurück. */
export function statistikNachRunde(stat, gewonnen) {
  const neu = { ...stat, gespielt: stat.gespielt + 1 };
  if (gewonnen) {
    neu.gewonnen = stat.gewonnen + 1;
    neu.serie = stat.serie + 1;
    neu.besteSerie = Math.max(stat.besteSerie, neu.serie);
  } else {
    neu.serie = 0;                           // Niederlage: Serie reißt
  }
  return neu;
}

/** Siegquote in ganzen Prozent, oder null, wenn noch nie gespielt wurde. */
export function quoteProzent(stat) {
  return stat.gespielt === 0 ? null : Math.round((stat.gewonnen / stat.gespielt) * 100);
}

/** Macht aus beliebigem gespeichertem Inhalt eine gültige Statistik (Schutz vor kaputten Daten). */
export function statistikSauber(roh) {
  const zahl = (wert) => (Number.isFinite(wert) && wert >= 0 ? Math.floor(wert) : 0);
  const r = roh && typeof roh === "object" ? roh : {};
  return {
    gespielt: zahl(r.gespielt),
    gewonnen: zahl(r.gewonnen),
    serie: zahl(r.serie),
    besteSerie: zahl(r.besteSerie),
  };
}

/* ============================================================
   TEIL 2 · Zustand und DOM
   ============================================================ */

let z = null;                 // Zustand der laufenden Runde (wird pro Runde neu angelegt)
let statistik = statistikSauber(null);
let nurWoerterbuch = true;    // Schalter "Nur Wörterbuch-Wörter zulassen"
let letztesWort = null;       // damit nicht zweimal hintereinander dasselbe kommt
let toastTimer = null;
const el = {};                // DOM-Elemente (init() füllt das)

/** Startet eine neue Runde. */
function neueRunde() {
  clearTimeout(toastTimer);
  el.toast.classList.remove("sichtbar");
  const loesung = waehleLoesung(LOESUNGEN, Math.random, letztesWort);
  letztesWort = loesung;
  z = {
    loesung,
    versuche: [],               // abgeschickte Tipps: [{ tipp, status }]
    zeile: 0,                   // Index der aktuellen Zeile (0–5)
    aktuell: "",                // gerade getippter Text
    phase: "laeuft",            // "laeuft" | "auswertung" | "gewonnen" | "verloren"
    tastenStatus: {},           // { A: "richtig", B: "nichtEnthalten", … }
    aufgabeBestaetigung: false, // siehe neueRundeAngefordert()
    endeAusstehend: false,      // true, solange der Niederlage-Dialog noch aussteht (Serie gerissen, Eintrag offen)
  };
  el.loesungHinweis.hidden = true;   // Lösungswort der vorigen Runde ausblenden
  rasterBauen();
  tastaturZeichnen();
  statusSagen("Neue Runde. Fünf Buchstaben gesucht.");
}

/** Baut das 6×5-Raster. Wird bei jeder Runde frisch aufgebaut (30 Kacheln sind billig). */
function rasterBauen() {
  el.raster.replaceChildren();
  el.zeilen = [];
  el.kacheln = [];
  for (let r = 0; r < VERSUCHE; r++) {
    const zeile = document.createElement("div");
    zeile.className = "wf-zeile";
    zeile.setAttribute("role", "row");
    const reihe = [];
    for (let s = 0; s < LAENGE; s++) {
      const kachel = document.createElement("div");
      kachel.className = "kachel";
      kachel.setAttribute("role", "gridcell");
      kachel.style.setProperty("--i", String(s));   // Position in der Zeile → Flip-Verzögerung
      reihe.push(kachel);
      zeile.append(kachel);
      kachelBeschriften(r, s, kachel);
    }
    el.zeilen.push(zeile);
    el.kacheln.push(reihe);
    el.raster.append(zeile);
  }
}

/** Screenreader-Text einer Kachel, z. B. "Zeile 2, Buchstabe 3: R, richtig". */
function kachelBeschriften(zeile, spalte, kachel, buchstabe = "", status = "") {
  const inhalt = buchstabe || "leer";
  const zusatz = status ? `, ${STATUS_TEXT[status]}` : "";
  kachel.setAttribute("aria-label", `Zeile ${zeile + 1}, Buchstabe ${spalte + 1}: ${inhalt}${zusatz}`);
}

/** Baut die Bildschirmtastatur. Ein Listener am Container für alle Tasten (Event Delegation). */
function tastaturBauen() {
  for (const reihe of TASTEN_REIHEN) {
    const div = document.createElement("div");
    div.className = "wf-reihe";
    for (const taste of reihe) {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.className = "wf-taste";
      knopf.dataset.taste = taste;
      // tabindex -1: Per Tab wären es 28 Stopps. Wer eine Tastatur hat, tippt
      // direkt (die Seite hört auf die physische Tastatur); Maus und Touch
      // erreichen die Tasten weiterhin ganz normal.
      knopf.tabIndex = -1;
      if (taste === "ENTER") {
        knopf.textContent = "Enter";
        knopf.classList.add("breit");
      } else if (taste === "RUECK") {
        knopf.textContent = "⌫";
        knopf.setAttribute("aria-label", "Letzten Buchstaben löschen");
        knopf.classList.add("breit");
      } else {
        knopf.textContent = taste;
      }
      div.append(knopf);
    }
    el.tastatur.append(div);
  }

  el.tastatur.addEventListener("click", (e) => {
    const knopf = e.target.closest("button[data-taste]");
    if (!knopf) return;
    const taste = knopf.dataset.taste;
    knopf.blur();   // Fokus abgeben, sonst würde ein späteres Enter DIESE Taste erneut drücken
    if (taste === "ENTER") tippAbschicken();
    else if (taste === "RUECK") loeschen();
    else buchstabeEingeben(taste);
  });
}

/** Färbt die Bildschirmtastatur nach z.tastenStatus. */
function tastaturZeichnen() {
  for (const knopf of el.tastatur.querySelectorAll("button[data-taste]")) {
    const status = z.tastenStatus[knopf.dataset.taste];
    if (status) knopf.dataset.status = status;
    else delete knopf.dataset.status;
  }
}

/* ------------------------------------------------------------
   Eingabe: Buchstaben tippen, löschen
   ------------------------------------------------------------ */

function buchstabeEingeben(buchstabe) {
  if (z.phase !== "laeuft" || z.aktuell.length >= LAENGE) return;
  const spalte = z.aktuell.length;
  z.aktuell += buchstabe;
  const kachel = el.kacheln[z.zeile][spalte];
  kachel.textContent = buchstabe;               // textContent: nie innerHTML
  kachel.classList.add("gefuellt");             // löst das kleine "Plopp" aus
  kachelBeschriften(z.zeile, spalte, kachel, buchstabe);
}

function loeschen() {
  if (z.phase !== "laeuft" || z.aktuell.length === 0) return;
  const spalte = z.aktuell.length - 1;
  z.aktuell = z.aktuell.slice(0, -1);
  const kachel = el.kacheln[z.zeile][spalte];
  kachel.textContent = "";
  kachel.classList.remove("gefuellt");
  kachelBeschriften(z.zeile, spalte, kachel);
}

/* ------------------------------------------------------------
   Hinweise: Toast und Schütteln
   ------------------------------------------------------------ */

function toastZeigen(text, dauerMs = 1600) {
  el.toast.textContent = text;
  el.toast.classList.add("sichtbar");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("sichtbar"), dauerMs);
}

function statusSagen(text) {
  el.status.textContent = text;
}

/** Lässt die aktuelle Zeile schütteln (Klasse .schuettel aus style.css). */
function zeileSchuetteln(zeile) {
  const element = el.zeilen[zeile];
  // Klasse entfernen, Layout erzwingen (offsetWidth lesen), neu setzen:
  // nur so startet die Animation auch bei schnellem Mehrfach-Drücken von vorn.
  element.classList.remove("schuettel");
  void element.offsetWidth;
  element.classList.add("schuettel");
  element.addEventListener("animationend", () => element.classList.remove("schuettel"), { once: true });
}

function ungueltig(hinweis) {
  zeileSchuetteln(z.zeile);
  toastZeigen(hinweis);
}

/* ------------------------------------------------------------
   Tipp abschicken und auswerten
   ------------------------------------------------------------ */

function tippAbschicken() {
  if (z.phase !== "laeuft") return;
  const tipp = z.aktuell;

  if (tipp.length < LAENGE) {
    ungueltig("Zu wenige Buchstaben");
    return;
  }
  if (nurWoerterbuch && !GUELTIGE_WOERTER.has(tipp)) {
    ungueltig("Nicht im Wörterbuch");
    return;
  }

  const status = bewerteTipp(z.loesung, tipp);
  const zeile = z.zeile;
  z.versuche.push({ tipp, status });
  z.phase = "auswertung";                       // Eingabe sperren, bis der Flip fertig ist
  zeileAuswerten(zeile, tipp, status);

  // Erst NACH der Animation geht es weiter (sonst würde man das Ergebnis
  // schon über die Tastaturfarben oder den Dialog vorher erfahren).
  const dauer = bewegungReduziert() ? 0 : FLIP_DAUER_MS + (LAENGE - 1) * FLIP_VERSATZ_MS;
  const meineRunde = z;
  setTimeout(() => {
    if (z !== meineRunde) return;               // inzwischen neue Runde → nichts mehr tun
    nachAuswertung(tipp, status);
  }, dauer);
}

/**
 * Setzt data-status an die Kacheln der Zeile. Das CSS kennt dadurch die
 * Zielfarbe. Mit Flip: Klasse .flip startet die Animation (Details und
 * die Begründung für "Farbwechsel bei 50 %" stehen in spiel.css).
 * Bei reduzierter Bewegung wird einfach direkt gefärbt, ohne .flip.
 */
function zeileAuswerten(zeile, tipp, status) {
  const mitFlip = !bewegungReduziert();
  status.forEach((s, spalte) => {
    const kachel = el.kacheln[zeile][spalte];
    kachel.dataset.status = s;
    if (mitFlip) kachel.classList.add("flip");   // Verzögerung kommt aus --i (Spalte)
    kachelBeschriften(zeile, spalte, kachel, tipp[spalte], s);
  });

  const beschreibung = status.map((s, i) => `${tipp[i]} ${STATUS_TEXT[s]}`).join(", ");
  statusSagen(`Versuch ${zeile + 1}: ${beschreibung}.`);
}

/** Läuft, wenn die Flip-Animation durch ist. */
function nachAuswertung(tipp, status) {
  z.tastenStatus = tastenStatusAktualisieren(z.tastenStatus, tipp, status);
  tastaturZeichnen();

  if (tipp === z.loesung) {
    siegBehandeln();
  } else if (z.zeile + 1 >= VERSUCHE) {
    niederlageBehandeln();
  } else {
    z.zeile++;                                  // nächste Zeile freigeben
    z.aktuell = "";
    z.phase = "laeuft";
  }
}

/* ------------------------------------------------------------
   Sieg und Niederlage
   ------------------------------------------------------------ */

function siegBehandeln() {
  z.phase = "gewonnen";
  const anzahlVersuche = z.versuche.length;
  statistik = statistikNachRunde(statistik, true);
  statistikSpeichern();
  hudZeichnen();
  toastZeigen(SIEG_TEXTE[anzahlVersuche - 1] ?? "Geschafft!", 2200);

  // Gewinnerzeile hüpft (nur ohne reduzierte Bewegung)
  const hatBewegung = !bewegungReduziert();
  if (hatBewegung) {
    el.kacheln[z.zeile].forEach((kachel) => {
      kachel.classList.remove("flip");
      kachel.classList.add("huepf");
    });
  }

  const serie = statistik.serie;
  const meineRunde = z;
  setTimeout(() => {
    if (z !== meineRunde) return;
    // Sieg = immer nur der schlanke Dialog, NIE ein Topliste-Eintrag.
    // Die Serie läuft ja noch: Sie wird erst eingetragen, wenn sie reißt
    // (siehe niederlageBehandeln). So steht ein Run genau einmal in der Liste.
    const dialog = schlankerDialog({
      titel: "GEWONNEN!",
      gross: `Serie: ${serie}`,
      text: `Richtig in ${anzahlVersuche} ${anzahlVersuche === 1 ? "Versuch" : "Versuchen"}. Die Serie kommt in die Topliste, sobald sie reißt.`,
      neustartText: "Nächste Runde",
      neustart: neueRunde,
    });
    beiDialogEnde(dialog, hudZeichnen);   // Topliste ändert sich beim Sieg nicht
  }, hatBewegung ? 1300 : 500);
}

/**
 * Runde verloren (6 Versuche aufgebraucht oder bestätigtes Aufgeben).
 *
 * WARUM DER TOPLISTE-EINTRAG HIER PASSIERT: Der Score eines Runs ist die Serie,
 * die JETZT gerissen ist. Erst jetzt steht sie fest. Darum merken wir sie uns
 * VOR dem Zurücksetzen auf 0 (statistikNachRunde setzt serie = 0).
 * - gerisseneSerie > 0: gameOverDialog fragt nach Initialen und trägt ein
 *   (ui.js prüft selbst, ob es für die Top 3 reicht).
 * - gerisseneSerie = 0: nichts zu werten, nur der schlanke Dialog.
 *
 * Das Lösungswort muss in beiden Fällen sichtbar sein. Der gameOverDialog
 * kennt es nicht und die Seite dahinter ist per Backdrop abgedunkelt und
 * verwischt. Darum steht es (1) dauerhaft als Hinweiszeile unter dem Raster
 * (bleibt auch nach Esc stehen, verschwindet bei neuer Runde) und (2) zusätzlich
 * als Zeile im Dialog.
 */
function niederlageBehandeln(aufgegeben = false) {
  z.phase = "verloren";
  z.endeAusstehend = true;                      // "Neue Runde" wartet, bis der Dialog da war
  const gerisseneSerie = statistik.serie;       // VOR dem Zurücksetzen merken
  statistik = statistikNachRunde(statistik, false);   // Serie reißt → 0
  statistikSpeichern();
  hudZeichnen();
  loesungZeigen();
  statusSagen(`Verloren. Das gesuchte Wort war ${z.loesung}.`);

  const meineRunde = z;
  const verzoegerung = aufgegeben ? 0 : bewegungReduziert() ? 400 : 700;
  setTimeout(() => {
    if (z !== meineRunde) return;
    meineRunde.endeAusstehend = false;

    let dialog;
    if (gerisseneSerie > 0) {
      dialog = gameOverDialog({
        spiel: SPIEL,
        titel: "SERIE GERISSEN",
        punkte: gerisseneSerie,
        punkteText: `Serie: ${gerisseneSerie}`,
        richtung: "hoch",                       // längere Serie = besser
        format: (p) => `Serie: ${p}`,
        neustart: neueRunde,
      });
      // Lösungswort unter der Überschrift einfügen (ui.js kennt es nicht)
      dialog.querySelector("h2")?.after(loesungZeile(meineRunde.loesung));
    } else {
      // Erste Runde direkt verloren: es gab keine Serie, also keinen Eintrag
      dialog = schlankerDialog({
        titel: "VERLOREN",
        vorText: "Das gesuchte Wort war:",
        gross: meineRunde.loesung,
        text: "Diesmal hat es nicht geklappt.",
        neustartText: "Nochmal",
        neustart: neueRunde,
      });
    }
    // Endet der Dialog (Knopf oder Esc), zeigt die Seite die aktuelle Topliste
    beiDialogEnde(dialog, () => {
      hudZeichnen();
      toplisteAktualisieren();
    });
  }, verzoegerung);
}

/** Zeigt das Lösungswort dauerhaft unter dem Raster (bis zur nächsten Runde). */
function loesungZeigen() {
  el.loesungHinweis.replaceChildren(...loesungZeile(z.loesung).childNodes);
  el.loesungHinweis.hidden = false;
}

/** Baut "Das gesuchte Wort war: XYZ" (per textContent, nie innerHTML). */
function loesungZeile(wort) {
  const p = document.createElement("p");
  p.className = "wf-loesung";
  const stark = document.createElement("strong");
  stark.textContent = wort;
  p.append("Das gesuchte Wort war: ", stark);
  return p;
}

/**
 * Führt `aktion` aus, sobald ein Dialog endet.
 * Zwei Ereignisse sind nötig: "close" (Dialog wurde geschlossen) und
 * "cancel" (Esc gedrückt). Bei Esc entfernt der Dialog sich selbst aus der
 * Seite, bevor "close" ausgelöst werden könnte, darum lauschen wir auf beide.
 * `aktion` darf deshalb auch zweimal laufen und muss harmlos sein.
 */
function beiDialogEnde(dialog, aktion) {
  dialog.addEventListener("close", aktion);
  dialog.addEventListener("cancel", aktion);
}

/**
 * Schlanker Dialog im gleichen Look wie gameOverDialog (.spiel-dialog),
 * aber ohne Topliste und Initialen. Alle Texte per textContent.
 * (Absichtlich in jeder game.js selbst: so bleibt jedes Spiel in sich
 * verständlich und die gemeinsame ui.js unverändert.)
 */
function schlankerDialog({ titel, vorText, gross, text, neustartText = "Nochmal", neustart }) {
  document.getElementById("spiel-dialog")?.remove();   // evtl. alten Dialog entfernen

  const dialog = document.createElement("dialog");
  dialog.className = "spiel-dialog";
  dialog.id = "spiel-dialog";

  const h2 = document.createElement("h2");
  h2.textContent = titel;
  dialog.append(h2);

  if (vorText) {
    const vor = document.createElement("p");
    vor.textContent = vorText;
    dialog.append(vor);
  }
  const grossText = document.createElement("p");
  grossText.className = "gross";
  grossText.textContent = gross;
  const absatz = document.createElement("p");
  absatz.textContent = text;

  const aktionen = document.createElement("div");
  aktionen.className = "aktionen";
  const nochmal = document.createElement("button");
  nochmal.type = "button";
  nochmal.className = "knopf primaer";
  nochmal.textContent = neustartText;
  const uebersicht = document.createElement("a");
  uebersicht.className = "knopf";
  uebersicht.href = "./";
  uebersicht.style.display = "none";   // Einzel-Repo: keine Spieleübersicht
  uebersicht.textContent = "Zur Übersicht";
  aktionen.append(nochmal, uebersicht);
  dialog.append(grossText, absatz, aktionen);

  nochmal.addEventListener("click", () => {
    dialog.close();
    dialog.remove();
    neustart?.();
  });
  dialog.addEventListener("cancel", () => dialog.remove()); // Esc

  document.body.append(dialog);
  dialog.showModal();
  nochmal.focus();
  return dialog;
}

/* ------------------------------------------------------------
   "Neue Runde"-Knopf
   Bei einem Streak-Highscore wäre "einfach überspringen" ein Schlupfloch:
   Man könnte jedes schwere Wort wegklicken und die Serie behalten. Darum
   zählt das Abbrechen einer angefangenen Runde als Niederlage (inklusive
   Topliste-Eintrag der gerissenen Serie). Damit das
   nicht aus Versehen passiert, braucht es einen zweiten Klick binnen 3 s.
   ------------------------------------------------------------ */
function neueRundeAngefordert() {
  if (z.phase === "auswertung") return;          // mitten im Flip: ignorieren
  if (z.endeAusstehend) return;                  // Niederlage-Dialog kommt gleich: Eintrag nicht verlieren
  const angefangen = z.phase === "laeuft" && z.versuche.length > 0;

  if (angefangen) {
    if (!z.aufgabeBestaetigung) {
      z.aufgabeBestaetigung = true;
      toastZeigen("Aufgeben? Nochmal drücken – die Serie reißt.", 3000);
      const diese = z;
      setTimeout(() => { diese.aufgabeBestaetigung = false; }, 3000);
      return;
    }
    // Aufgeben = Niederlage wie jede andere: Die gerissene Serie kommt über
    // den Dialog in die Topliste, das Lösungswort wird gezeigt. Die neue
    // Runde startet dann über den Dialog-Knopf (oder erneut "Neue Runde").
    clearTimeout(toastTimer);
    el.toast.classList.remove("sichtbar");
    niederlageBehandeln(true);
    return;
  }
  neueRunde();
}

/* ------------------------------------------------------------
   HUD, Statistik, Topliste
   ------------------------------------------------------------ */

function statistikSpeichern() {
  speichere(SPIEL, "statistik", statistik);
}

function hudZeichnen() {
  zahlHochzaehlen(el.hudSerie, statistik.serie);
  zahlHochzaehlen(el.hudRekord, statistik.besteSerie);
  const quote = quoteProzent(statistik);
  if (quote === null) el.hudQuote.textContent = "–";   // noch nie gespielt
  else zahlHochzaehlen(el.hudQuote, quote);
}

function toplisteAktualisieren() {
  toplisteAnzeigen(el.topliste, SPIEL, (punkte) => `Serie ${punkte}`);
}

/* ============================================================
   TEIL 3 · Start
   ============================================================ */

function init() {
  el.raster = document.getElementById("raster");
  el.tastatur = document.getElementById("tastatur");
  el.toast = document.getElementById("toast");
  el.status = document.getElementById("status");
  el.hudSerie = document.getElementById("hud-serie");
  el.hudRekord = document.getElementById("hud-rekord");
  el.hudQuote = document.getElementById("hud-quote");
  el.topliste = document.getElementById("topliste");
  el.schalter = document.getElementById("nur-woerterbuch");
  el.loesungHinweis = document.getElementById("loesung-hinweis");

  // Flip-Zeiten aus den JS-Konstanten ins CSS geben (eine Wahrheit)
  el.raster.style.setProperty("--flip-dauer", `${FLIP_DAUER_MS}ms`);
  el.raster.style.setProperty("--flip-versatz", `${FLIP_VERSATZ_MS}ms`);

  // Gespeichertes laden (statistikSauber schützt vor kaputten Daten)
  statistik = statistikSauber(lade(SPIEL, "statistik", null));
  nurWoerterbuch = lade(SPIEL, "nurWoerterbuch", true) !== false;
  el.schalter.checked = nurWoerterbuch;

  tastaturBauen();
  neueRunde();
  hudZeichnen();
  toplisteAktualisieren();

  // Schalter: Wert merken und kurz bestätigen
  el.schalter.addEventListener("change", () => {
    nurWoerterbuch = el.schalter.checked;
    speichere(SPIEL, "nurWoerterbuch", nurWoerterbuch);
    toastZeigen(nurWoerterbuch ? "Nur Wörterbuch-Wörter" : "Jede Buchstabenfolge erlaubt");
  });

  document.getElementById("neue-runde").addEventListener("click", (e) => {
    e.currentTarget.blur();   // sonst würde ein späteres Enter wieder "Neue Runde" auslösen
    neueRundeAngefordert();
  });

  // Reset: Statistik, Topliste und Schalter zurück auf Standard; laufende Runde bleibt
  document.getElementById("reset").addEventListener("click", () => {
    spielZuruecksetzen(SPIEL);
    statistik = statistikSauber(null);
    nurWoerterbuch = true;
    el.schalter.checked = true;
    hudZeichnen();
    toplisteAktualisieren();
  });

  // Physische Tastatur: Ein Listener für die ganze Seite
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;            // Browser-Kürzel nicht stören
    if (document.querySelector("dialog[open]")) return;        // Dialog hat Vorrang

    if (e.key === "Enter") {
      // Auf Knöpfen, Links und der Lernbox-Überschrift soll Enter weiterhin
      // deren eigene Aktion auslösen (z. B. "Neue Runde", "Zur Übersicht").
      if (e.target.closest?.("button, a, summary")) return;
      e.preventDefault();
      tippAbschicken();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      loeschen();
    } else if (/^[a-zA-Z]$/.test(e.key)) {
      // Nur A–Z (keine Umlaute/ß – die Wortlisten kommen ohne aus)
      buchstabeEingeben(e.key.toUpperCase());
    }
  });
}

// In Node (Tests) gibt es kein `document` – dort werden nur die reinen
// Funktionen oben importiert, das Spiel startet nicht.
if (typeof document !== "undefined") init();
