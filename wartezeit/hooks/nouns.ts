import type { WzArticle } from '../types'

// German noun genders the decks are checked against: everyday A1–B1 nouns and the nouns of
// work and software. A noun the model writes with another article, or one the list cannot
// place, is dropped from the deck, so a card never teaches a wrong article. Nouns whose
// gender depends on the meaning (der/die See, der/das Teil) are left out on purpose.
const DER = `
Abend Abfall Ablauf Absatz Abschluss Abschnitt Absender Abstand Akku Alarm Algorithmus
Alltag Anbieter Anfang Anhang Anruf Anschluss Ansatz Antrag Anwalt Apfel April Arm Arzt Ast
Aufbau Aufruf Aufwand Augenblick August Ausdruck Ausgang Ausweis Auszug Autor Bahnhof Ball
Bauch Baum Baustein Bedarf Befehl Beitrag Benutzer Bereich Berg Bericht Beruf Besuch Betrieb
Beweis Bezug Bildschirm Bleistift Blick Block Boden Branch Brief Browser Bruder Buchstabe Bug
Bus Button Cache Chef Code Compiler Computer Container Cursor Dank Datensatz Deckel
Dezember Dialog Dienst Dienstag Donnerstag Drucker Durst Eimer Eindruck Eingang Eintrag
Einfluss Empfänger Entwickler Entwurf Erfolg Export Fahrer Fahrplan Fall Februar Fehler
Feierabend Feiertag Feind Fernseher Film Filter Finger Fisch Flughafen Fluss Fokus Fortschritt
Freitag Freund Frühling Fuß Gang Garten Gast Gedanke Geburtstag Gegenstand Geldbeutel Gewinn
Gipfel Glaube Gott Grund Gruß Hacker Hafen Haken Hals Hammer Handel Herbst Herr
Hintergrund Himmel Hinweis Hof Hund Hunger Hut Import Inhaber Inhalt Januar Job Juli Junge
Juni Kaffee Kalender Kampf Kanal Käse Kauf Kellner Kern Knopf Koch Koffer Kollege Kommentar
Kompromiss Kontakt Kopf Kopfhörer Körper Kreis Krieg Kuchen Kühlschrank Kunde Kurs Kuss Laden
 Lauf Lehrer Leser Link Löffel Lohn Löwe Mai Mann Mantel Markt März Mittag Mittwoch Modus
Monat Mond Monitor Montag Morgen Motor Mund Nachbar Nachteil Name Nebel November Nutzer Ofen
Oktober Onkel Ordner Ort Osten Park Partner Pass Pfad Pfeil Pilot Plan Planet Platz Port
Preis Prompt Prototyp Prozess Prozessor Puffer Pullover Punkt Quellcode Rahmen Rand Raum
Rechner Regen Reis Rest Rhythmus Ring Rock Rücken Ruf Saft Salat Samstag Sand Satz Schaden
Schalter Schatten Schein Schirm Schlaf Schlüssel Schmerz Schnee Schrank Schreibtisch Schritt
Schuh Schüler Schutz Schwerpunkt September Server Sessel Sieg Sinn Sohn Sommer Sonntag Spaß
Speicher Spiegel Spieler Sport Sprung Staat Stand Stapel Start Stecker Stein Stern Stift Stil
Stock Strand Streit Strom Student Stuhl Sturm Tag Tanz Tarif Tee Teller Termin Test Text
Thread Tisch Titel Tod Ton Topf Traum Treffer Trend Tropfen Turm Typ Unterricht Unterschied
Urlaub Vater Verein Verkehr Verlauf Verlust Versuch Vertrag Vogel Vorgang Vorschlag Vorteil
Wagen Wald Wechsel Weg Wein Wert Westen Wettbewerb Widerspruch Wind Winter Wunsch Wurm Zahn
Zähler Zaun Zeiger Zeitpunkt Zeitraum Zettel Zucker Zufall Zug Zugang Zugriff Zusammenhang
Zustand Zweck Zweifel
`

const DIE = `
Abfrage Abhängigkeit Ablage Absicht Abteilung Adresse Agentur Aktion Ampel Analyse Änderung
Anforderung Anfrage Angst Anlage Anleitung Anmeldung Anpassung Anrede Anschrift Ansicht Antwort
Anwendung Anzahl Anzeige Apotheke App Arbeit Art Aufgabe Aufmerksamkeit Ausbildung Ausgabe
Ausnahme Auswahl Authentifizierung Bahn Banane Bank Batterie Bearbeitung Bedeutung Bedingung
Behörde Berechtigung Beschreibung Bestätigung Bestellung Betreuung Bewerbung Bezahlung
Beziehung Bibliothek Bildung Birne Bitte Blume Bluse Brille Brücke Butter Cloud Datei
Datenbank Deadline Decke Dokumentation Domain Dose Dusche Ebene Ecke Ehe Eigenschaft
Einführung Eingabe Einladung Einstellung Empfehlung Energie Ente Entscheidung Entwicklung
Erfahrung Erinnerung Erklärung Erlaubnis Ernährung Erweiterung Familie Farbe Fassung Firma
Flasche Form Formel Frage Frau Freigabe Freiheit Freude Freundin Funktion Gabel Garage Gebühr
Geduld Gefahr Gegend Geschichte Gesellschaft Gesundheit Gewohnheit Gitarre Grafik Grenze Größe
Gruppe Haltestelle Hand Handlung Hardware Hilfe Hitze Hochzeit Hoffnung Hose Hütte Idee
Information Insel Instanz Jacke Jugend Kamera Kantine Karte Kartoffel Kasse Kategorie Katze
Kennung Kerze Kette Kirche Kirsche Kiste Klasse Kleidung Komponente Konferenz Konfiguration
Konsole Kontrolle Kopie Kraft Krankheit Kritik Küche Kugel Kuh Kultur Lampe Landschaft Länge
Leiste Leistung Leitung Lieferung Linie Liste Lizenz Lösung Luft Lust Macht Mahlzeit Mail E-Mail
Mannschaft Marke Mauer Maus Medizin Meinung Meldung Melone Menge Methode Miete Milch Minute
Mitte Mitteilung Mode Möglichkeit Mücke Muschel Musik Mutter Nachricht Nacht Nadel Nase Natur
Notiz Nudel Nummer Nutzung Oberfläche Optimierung Ordnung Packung Pause Person Pfanne Pflanze
Pflicht Pipeline Pizza Planung Plattform Politik Polizei Post Praxis Presse Programmierung
Prüfsumme Prüfung Puppe Qualität Rechnung Regel Reihe Reihenfolge Reise Richtung Rolle Rose
Rückgabe Rückmeldung Sache Säge Sahne Schachtel Schaltfläche Schere Schicht Schlange Schleife
Schnittstelle Schnur Schokolade Schrift Schule Schulter Schwester Seife Seite Sekunde
Sicherheit Sicherung Sitzung Socke Software Sonne Sorge Spalte Speisekarte Spitze Sprache
Sprechstunde Stadt Stelle Steuerung Stimme Stimmung Störung Strafe Straße Strecke
Struktur Stufe Stunde Suche Suchmaschine Suppe Tabelle Tafel Tante Tasche Taste Tastatur
Tasse Tat Technik Teilnahme Temperatur Tochter Toilette Tomate Torte Treppe Tür Tüte Übersicht
Übersetzung Überweisung Übung Uhr Umfrage Umgebung Umsetzung Universität Unterhaltung
Unterlage Unterstützung Ursache Variable Vase Veränderung Verantwortung Verbindung Vereinbarung
Verfügung Verschlüsselung Version Verwaltung Verwendung Verzögerung Voraussetzung
Vorbereitung Vorlage Vorschau Wahl Wahrheit Wand Wanne Ware Wärme Warnung Warteschlange
Wartung Wäsche Webseite Weiterleitung Welt Werbung Werkstatt Wiederherstellung Wiederholung
Wiese Wirkung Wirtschaft Wissenschaft Woche Wohnung Wolke Wurst Zahl Zahnbürste Zeile Zeit
Zeitung Zentrale Ziege Zitrone Zukunft Zunge Zusammenarbeit Zustimmung Zwiebel
`

const DAS = `
Abendessen Abenteuer Abo Abonnement Alter Amt Angebot Archiv Argument Array Atom Attribut Auge
Ausland Auto Backend Bad Beispiel Bein Bett Bier Bild Blatt Blut Boot Brett Brot Buch
Budget Büro Café Dach Dashboard Datum Design Display Ding Dokument Dorf Duplikat Ei Eis
Element Ende Ereignis Ergebnis Erlebnis Essen Etikett Event Exemplar Fach Fahrrad Feature
Feedback Fenster Fest Feuer Fleisch Flugzeug Format Formular Foto Framework Frontend Frühstück
Fundament Gebäude Gebiet Gefühl Geheimnis Gehirn Gelände Geld Gemüse Gepäck Gerät
Gericht Gerücht Gesetz Gesicht Gespräch Getränk Gewicht Gewissen Gewitter Glas Gleis Glück
Gold Gras Guthaben Haar Handy Haus Hemd Herz Hindernis Hotel Icon Instrument Interesse
Interface Internet Inventar Jahr Kabel Kapitel Kennwort Kind Kino Kissen Kleid Klima
Konto Kontingent Konzept Konzert Krankenhaus Kriterium Lager Land Laufwerk Layout Leben
Licht Lied Limit Lob Loch Mädchen Medikament Meer Meeting Menü Merkmal Messer Mittagessen
Mittel Modell Modul Museum Muster Netz Netzwerk Objekt Obst Ohr Öl Opfer Paar Paket Papier
Passwort Pferd Pflaster Plugin Prinzip Problem Produkt Profil Programm Projekt Protokoll
Publikum Rad Rathaus Rätsel Recht Regal Register Repository Rezept Rind Risiko Salz
Schema Schicksal Schiff Schild Schloss Schwein Semester Setup Signal Skript Sofa Spiel
Spielzeug Stück Studium Symbol System Tablett Talent Taxi Team Telefon Thema Thermometer
Ticket Tier Tool Training Tuch Unternehmen Unwetter Update Verb Verbot Verfahren Verhalten
Verhältnis Vermögen Verständnis Verzeichnis Video Volk Vorbild Vorhaben Wachstum Wasser
Werkzeug Wetter Wissen Wochenende Wort Wörterbuch Zeichen Zelt Zentrum Zertifikat Zeugnis
Ziel Zimmer Zitat Zubehör Zuhause
`

const GENDERS = new Map<string, WzArticle>()
for (const [article, words] of [['der', DER], ['die', DIE], ['das', DAS]] as const) {
  for (const word of words.split(/\s+/).filter(Boolean)) GENDERS.set(word.toLowerCase(), article)
}

// A compound's gender is its last noun's (die Datenbankverbindung: die Verbindung), so a noun
// not in the list takes the gender of the longest listed noun it ends with. Listed nouns
// shorter than four letters never stand for a compound's head (Ei, Tag, Uhr would match far
// too much); compounds of those are listed whole.
const MIN_HEAD = 4

export const genderOf = (noun: string): WzArticle | undefined => {
  const word = noun.trim().toLowerCase()
  const exact = GENDERS.get(word)
  if (exact) return exact
  for (let start = 1; start <= word.length - MIN_HEAD; start++) {
    const head = GENDERS.get(word.slice(start))
    if (head) return head
  }
  return undefined
}

export const knownNounCount = (): number => GENDERS.size
