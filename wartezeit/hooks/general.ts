import type { WzCard, WzDeck } from '../types'

const noun = (article: WzCard['article'], de: string, en: string, example_de: string, example_en: string): WzCard => ({
  type: 'noun',
  article,
  de,
  en,
  example_de,
  example_en,
  cloze: example_de.replace(de, '___'),
})

const word = (type: 'verb' | 'adjective', de: string, en: string, example_de: string, example_en: string): WzCard => ({
  type,
  de,
  en,
  example_de,
  example_en,
  cloze: example_de.replace(de, '___'),
})

// Everyday words around working at a computer, A1–A2: the deck a session starts with, until
// words from its own topic arrive. A verb's gap takes the infinitive (after a modal), an
// adjective's the base form (after "ist"), so the answer is exactly the dictionary form.
export const GENERAL_DECK: WzDeck = {
  key: 'general',
  topic: 'Everyday German',
  cards: [
    noun('die', 'Arbeit', 'work', 'Die Arbeit macht heute Spaß.', 'Work is fun today.'),
    noun('der', 'Kaffee', 'coffee', 'Der Kaffee ist noch heiß.', 'The coffee is still hot.'),
    noun('die', 'Zeit', 'time', 'Die Zeit vergeht schnell.', 'Time flies.'),
    noun('das', 'Wochenende', 'weekend', 'Das Wochenende war sehr ruhig.', 'The weekend was very quiet.'),
    noun('die', 'Pause', 'break', 'Die Pause dauert zehn Minuten.', 'The break lasts ten minutes.'),
    noun('der', 'Bildschirm', 'screen', 'Der Bildschirm ist zu hell.', 'The screen is too bright.'),
    noun('die', 'Nachricht', 'message', 'Die Nachricht ist gerade angekommen.', 'The message has just arrived.'),
    noun('das', 'Ergebnis', 'result', 'Das Ergebnis sieht gut aus.', 'The result looks good.'),
    noun('der', 'Fehler', 'mistake, error', 'Der Fehler tritt nur manchmal auf.', 'The error only happens sometimes.'),
    noun('die', 'Aufgabe', 'task', 'Die Aufgabe ist schon erledigt.', 'The task is already done.'),
    noun('der', 'Termin', 'appointment', 'Der Termin ist morgen um neun.', 'The appointment is tomorrow at nine.'),
    noun('das', 'Problem', 'problem', 'Das Problem ist jetzt gelöst.', 'The problem is solved now.'),
    noun('das', 'Fenster', 'window', 'Das Fenster ist offen.', 'The window is open.'),
    noun('die', 'Tastatur', 'keyboard', 'Die Tastatur ist ganz neu.', 'The keyboard is brand new.'),
    word('verb', 'warten', 'to wait', 'Ich muss kurz warten.', 'I have to wait a moment.'),
    word('verb', 'arbeiten', 'to work', 'Wir wollen heute lange arbeiten.', 'We want to work late today.'),
    word('verb', 'lernen', 'to learn', 'Ich möchte Deutsch lernen.', 'I would like to learn German.'),
    word('verb', 'beginnen', 'to begin', 'Wir können jetzt beginnen.', 'We can begin now.'),
    word('verb', 'schreiben', 'to write', 'Ich muss eine E-Mail schreiben.', 'I have to write an email.'),
    word('verb', 'finden', 'to find', 'Ich kann den Schlüssel nicht finden.', "I can't find the key."),
    word('verb', 'speichern', 'to save', 'Du solltest die Datei speichern.', 'You should save the file.'),
    word('adjective', 'schnell', 'fast', 'Der Computer ist sehr schnell.', 'The computer is very fast.'),
    word('adjective', 'fertig', 'finished, ready', 'Das Projekt ist fast fertig.', 'The project is almost finished.'),
    word('adjective', 'wichtig', 'important', 'Diese Frage ist wichtig.', 'This question is important.'),
    word('adjective', 'einfach', 'simple, easy', 'Die Lösung ist ganz einfach.', 'The solution is quite simple.'),
    word('adjective', 'müde', 'tired', 'Ich bin heute müde.', 'I am tired today.'),
    word('adjective', 'bereit', 'ready', 'Alles ist bereit.', 'Everything is ready.'),
    word('adjective', 'langsam', 'slow', 'Das Internet ist heute langsam.', 'The internet is slow today.'),
  ],
}
