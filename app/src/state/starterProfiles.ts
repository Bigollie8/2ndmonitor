import type { Profile } from '../types';
import type { BuiltinTileType, TileType } from './layout';
import { ALL_TILE_TYPES, migrateLegacyProfileToOrientations, newId } from './layout';

/** Accent colors assigned to profiles in creation order (seeded three first,
 *  then user-created ones cycle through the rest). */
export const PROFILE_DEFAULT_COLORS = ['#a78bfa', '#f59e0b', '#22d3ee', '#22c55e', '#f472b6', '#60a5fa', '#facc15', '#f97316'];

/** The tiles a fresh install starts with, per seeded profile. Deliberately a
 *  small subset of the catalog: seeding every tile type (28 as of 0.6.0) fills
 *  the screen with overlapping tiles because only the core eight have a
 *  designed non-overlapping layout — everything later shares fallback rects.
 *  Kept to subsets of that designed core so the default rects never collide.
 *  Order must follow ALL_TILE_TYPES (the canonical render order). */
export const STARTER_TILE_SETS: Record<'work' | 'gaming' | 'chill', BuiltinTileType[]> = {
  work:   ['viz', 'spotify', 'discord', 'claude', 'mixer', 'notes', 'sysmon', 'clock'],
  gaming: ['viz', 'spotify', 'mixer', 'sysmon', 'clock'],
  chill:  ['viz', 'spotify', 'clock'],
};

function hiddenAllExcept(keep: BuiltinTileType[]): Partial<Record<TileType, boolean>> {
  const hidden: Partial<Record<TileType, boolean>> = {};
  for (const type of ALL_TILE_TYPES) {
    if (!keep.includes(type)) hidden[type] = true;
  }
  return hidden;
}

/** Build the three profiles a first-ever launch starts with. Each gets a
 *  curated starter set (see STARTER_TILE_SETS) matching what the onboarding
 *  profile cards advertise, placed at the designed default rects. */
export function seedStarterProfiles(): Profile[] {
  const seeds: { name: string; set: BuiltinTileType[] }[] = [
    { name: 'Work',   set: STARTER_TILE_SETS.work },
    { name: 'Gaming', set: STARTER_TILE_SETS.gaming },
    { name: 'Chill',  set: STARTER_TILE_SETS.chill },
  ];
  return seeds.map(({ name, set }, i) =>
    migrateLegacyProfileToOrientations({
      id: newId(),
      name,
      color: PROFILE_DEFAULT_COLORS[i]!,
      layout: {},
      hidden: hiddenAllExcept(set),
    }),
  );
}
