import { getDb, setSetting } from '../server/db.js';

export const SECTION_DS_G_ROUTINE = [
  // Saturday (Section G Theory)
  {
    id: 'sat-1',
    day: 'Sat',
    startTime: '13:00',
    endTime: '14:30',
    subject: 'Machine Learning Driven Data Applications (DS423)',
    code: 'DS423 - SSI',
    room: '712B',
    group: 'All',
    validUntil: '2026-12-20'
  },
  {
    id: 'sat-2',
    day: 'Sat',
    startTime: '14:30',
    endTime: '16:00',
    subject: 'Machine Learning Driven Data Applications (DS423)',
    code: 'DS423 - SSI',
    room: '712B',
    group: 'All',
    validUntil: '2026-12-20'
  },

  // Sunday (Section G Theory + Lab G1)
  {
    id: 'sun-1',
    day: 'Sun',
    startTime: '10:00',
    endTime: '11:30',
    subject: 'Machine Learning Driven Data Applications (DS421)',
    code: 'DS421 - MRN',
    room: 'Annex - 108',
    group: 'All',
    validUntil: '2026-12-20'
  },
  {
    id: 'sun-2',
    day: 'Sun',
    startTime: '11:30',
    endTime: '13:00',
    subject: 'Machine Learning Driven Data Applications (DS421)',
    code: 'DS421 - MRN',
    room: 'Annex - 108',
    group: 'All',
    validUntil: '2026-12-20'
  },
  {
    id: 'sun-3',
    day: 'Sun',
    startTime: '13:00',
    endTime: '14:30',
    subject: 'Management Information Systems (SE442)',
    code: 'SE442 - MMN',
    room: '913',
    group: 'All',
    validUntil: '2026-12-20'
  },
  {
    id: 'sun-4',
    day: 'Sun',
    startTime: '14:30',
    endTime: '16:00',
    subject: 'Lab G1 Machine Learning Driven Data Applications (DS422)',
    code: 'DS422 - MRN',
    room: '601',
    group: 'G1',
    validUntil: '2026-12-20'
  },

  // Monday (Section G Theory + Lab G1)
  {
    id: 'mon-1',
    day: 'Mon',
    startTime: '13:00',
    endTime: '14:30',
    subject: 'Management Information Systems (SE442)',
    code: 'SE442 - MMN',
    room: '712A',
    group: 'All',
    validUntil: '2026-12-20'
  },
  {
    id: 'mon-2',
    day: 'Mon',
    startTime: '14:30',
    endTime: '16:00',
    subject: 'Lab G1 Machine Learning Driven Data Applications (DS424)',
    code: 'DS424 - SSA',
    room: '601',
    group: 'G1',
    validUntil: '2026-12-20'
  },

  // Wednesday (Lab G1 Online)
  {
    id: 'wed-1',
    day: 'Wed',
    startTime: '10:00',
    endTime: '11:30',
    subject: 'Lab G1 Software Engineering (SE331)',
    code: 'SE331 - RA',
    room: 'ONLINE',
    group: 'G1',
    validUntil: '2026-12-20'
  },

  // Thursday (Lab G1 in 616)
  {
    id: 'thu-1',
    day: 'Thu',
    startTime: '08:30',
    endTime: '10:00',
    subject: 'Lab G1 Software Engineering (SE331)',
    code: 'SE331 - RA',
    room: '616',
    group: 'G1',
    validUntil: '2026-12-20'
  },
  {
    id: 'thu-2',
    day: 'Thu',
    startTime: '10:00',
    endTime: '11:30',
    subject: 'Lab G1 Software Engineering (SE331)',
    code: 'SE331 - RA',
    room: '616',
    group: 'G1',
    validUntil: '2026-12-20'
  }
];

export function seed() {
  getDb();
  setSetting('classSchedule', JSON.stringify(SECTION_DS_G_ROUTINE));
  console.log(`[Sheuli] Successfully seeded ${SECTION_DS_G_ROUTINE.length} slots for Section DS-G (G1 and All)!`);
}

seed();
