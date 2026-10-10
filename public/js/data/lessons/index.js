// All lessons by level. Later slices add Pro and Grand Master tracks.
import { NOVICE_LESSONS } from './novice.js';
import { AMATEUR_LESSONS } from './amateur.js';

export const LESSON_TRACKS = [
  { level: 'novice', label: 'Novice', blurb: 'How the game works: the pieces, special moves, check and checkmate.', lessons: NOVICE_LESSONS },
  { level: 'amateur', label: 'Amateur', blurb: 'Tactics that win games: forks, pins, skewers and mating patterns.', lessons: AMATEUR_LESSONS },
];

export const ALL_LESSONS = LESSON_TRACKS.flatMap((t) => t.lessons);
export const lessonById = (id) => ALL_LESSONS.find((l) => l.id === id) ?? null;
