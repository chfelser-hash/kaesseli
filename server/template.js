// Leere Vorlage für einen neuen Datenstand. Enthält bewusst KEINE persönlichen Beträge.
import crypto from 'node:crypto';

const id = () => crypto.randomBytes(6).toString('base64url');
const line = (name, freq = 12) => ({ id: id(), name, expr: '0', freq });

export function createYearTemplate(year) {
  return {
    year,
    income: [line('Lohn Person 1', 13), line('Lohn Person 2', 13)],
    pots: [
      {
        key: 'fix', name: 'Fixkosten', account: 'Rechnungskonto', color: '#64748b', tracked: false, kind: 'expense', carryover: 0,
        lines: [line('Miete'), line('Internet'), line('Handy'), line('Krankenkasse Zusatz'), line('Säule 3a', 1)],
      },
      { key: 'haushalt', name: 'Haushalt', account: 'Rechnungskonto', color: '#0e7490', tracked: true, kind: 'expense', carryover: 0, lines: [line('Haushalt, Essen, Benzin, Ausgang')] },
      { key: 'steuern', name: 'Steuern', account: 'Steuerkonto', color: '#7c3aed', tracked: true, kind: 'expense', carryover: 0, lines: [line('Steuern', 1)] },
      {
        key: 'sporadisch', name: 'Sporadisch', account: 'Rückstellung', color: '#c2410c', tracked: true, kind: 'expense', carryover: 0,
        lines: [line('Strom'), line('Serafe', 1), line('Versicherungen', 1), line('Geschenke', 1), line('Auto', 1), line('Arzt & Anschaffungen', 1)],
      },
      { key: 'sparen', name: 'Sparen', account: 'Sparkonto', color: '#15803d', tracked: true, kind: 'saving', carryover: 0, lines: [line('Sparen')] },
      { key: 'ferien', name: 'Ferien', account: 'Ferienkonto', color: '#0369a1', tracked: true, kind: 'expense', carryover: 0, lines: [line('Ferien')] },
      { key: 'spassgeld', name: 'Spassgeld', account: 'Privat', color: '#be185d', tracked: false, kind: 'expense', carryover: 0, lines: [line('Person 1'), line('Person 2')] },
    ],
  };
}

export function createTemplate(year) {
  return {
    schema: 1,
    rev: 1,
    years: { [year]: createYearTemplate(year) },
    transactions: [],
    settlements: [],
    settings: { accounts: ['Kreditkarte', 'Postkonto', 'Bar'], rules: [], importProfiles: [] },
  };
}
