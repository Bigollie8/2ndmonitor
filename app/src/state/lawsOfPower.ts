// The 48 Laws of Power tile's data + rotation logic (0.9.8).
//
// Each law is paraphrased CONCISELY in our own words (number + short title +
// one-line gist) — brief original summaries, not the book's text.
//
// Rotation is pure and testable: the component feeds (state, now) in and
// persists what comes back, so which law shows and when it changes survives
// reloads instead of reshuffling per render. Math.random() is fine here —
// this is app runtime, not a workflow script (that constraint applies only
// to workflow orchestration code).

export interface Law {
  n: number;
  title: string;
  gist: string;
}

export const LAWS: Law[] = [
  { n: 1, title: 'Outshine no master', gist: 'Make those above you feel secure and superior; hide the full extent of your talent around them.' },
  { n: 2, title: 'Rely warily on friends', gist: 'Friends grow entitled and envious; a former rival you win over often serves you more loyally.' },
  { n: 3, title: 'Mask your intentions', gist: 'Keep others guessing about your plans — announced goals hand people the tools to block them.' },
  { n: 4, title: 'Say less than needed', gist: 'The more you talk, the more ordinary and exposed you appear. Brevity unsettles and impresses.' },
  { n: 5, title: 'Guard your reputation', gist: 'Reputation is a shield and a weapon; defend yours fiercely and never let attacks on it stand.' },
  { n: 6, title: 'Court attention', gist: 'Being ignored is worse than being criticized — stand out, cultivate an image people notice.' },
  { n: 7, title: 'Let others do the work', gist: 'Use the skill and effort of others, then take the credit gracefully; efficiency reads as brilliance.' },
  { n: 8, title: 'Make others come to you', gist: 'The one who forces the other to act surrenders control. Bait patiently; never chase.' },
  { n: 9, title: 'Win by actions, not argument', gist: 'Arguments breed resentment even when you win. Demonstrate; let results argue for you.' },
  { n: 10, title: 'Avoid the unlucky and unhappy', gist: 'Misery spreads by association. Choose the company of the fortunate and the positive.' },
  { n: 11, title: 'Keep others dependent', gist: 'The more someone needs you, the more freedom you have. Never teach them enough to do without you.' },
  { n: 12, title: 'Disarm with selective honesty', gist: 'One sincere gesture covers a dozen maneuvers. Generosity lowers guards.' },
  { n: 13, title: 'Appeal to self-interest', gist: 'When asking for help, show what the other side gains — never lean on mercy or gratitude.' },
  { n: 14, title: 'Befriend to gather, pose as a friend', gist: 'Learn what you need through warmth; people reveal everything to a sympathetic listener.' },
  { n: 15, title: 'Crush your enemy totally', gist: 'A wounded rival recovers and seeks revenge. Finish what you start — half-measures cost more later.' },
  { n: 16, title: 'Use absence to build respect', gist: 'Too much presence cheapens you. Withdraw at the right moment and value rises with scarcity.' },
  { n: 17, title: 'Cultivate unpredictability', gist: 'Patterns hand others control. Deliberate inconsistency keeps rivals off balance and defensive.' },
  { n: 18, title: 'Never isolate yourself', gist: 'Walls protect nothing and cut you off from information. Danger is better met in the crowd.' },
  { n: 19, title: 'Know who you’re dealing with', gist: 'The same move lands differently on different people; offend the wrong one and pay for years.' },
  { n: 20, title: 'Commit to no one', gist: 'Stay above the fray. The uncommitted are courted by every side; the committed are taken for granted.' },
  { n: 21, title: 'Play dumber than your mark', gist: 'Make others feel intelligent and they will never suspect your real agenda.' },
  { n: 22, title: 'Surrender to win', gist: 'When weaker, yield rather than fight for honor. Surrender buys time for the tide to turn.' },
  { n: 23, title: 'Concentrate your forces', gist: 'Intensity beats extensity: one rich mine outproduces a dozen shallow ones.' },
  { n: 24, title: 'Play the courtier', gist: 'Master indirection: flatter upward, assert subtly, and make grace look effortless.' },
  { n: 25, title: 'Re-create yourself', gist: 'Refuse the roles others assign. Author a persona commanding enough to hold the audience.' },
  { n: 26, title: 'Keep your hands clean', gist: 'Let others carry out the unpleasant work; keep mistakes and cruelty at arm’s length from your name.' },
  { n: 27, title: 'Harness the need to believe', gist: 'People crave something to follow. Offer a cause and they will hand you devotion.' },
  { n: 28, title: 'Act with boldness', gist: 'Hesitation infects everything it touches; audacity carries its own authority and is forgiven faster.' },
  { n: 29, title: 'Plan to the very end', gist: 'The ending is everything. Account for every consequence before the first step, then surprises can’t derail you.' },
  { n: 30, title: 'Make mastery look effortless', gist: 'Conceal the sweat behind your results; visible effort shrinks the achievement.' },
  { n: 31, title: 'Control the options', gist: 'Offer choices where every road serves you — people feel free while moving your way.' },
  { n: 32, title: 'Play to fantasies', gist: 'Truth is unwelcome when it disenchants. The one who conjures romance amid the routine holds power.' },
  { n: 33, title: 'Find the thumbscrew', gist: 'Everyone has a weakness — insecurity, pleasure, fear. Found, it is leverage.' },
  { n: 34, title: 'Act royal to be treated royally', gist: 'Your bearing sets your price. Carry yourself as if destined for the crown.' },
  { n: 35, title: 'Master timing', gist: 'Never look hurried. Sense the moment ripening, and strike only when it has.' },
  { n: 36, title: 'Disdain what you can’t have', gist: 'Acknowledging a petty problem gives it reality. The unobtainable is best ignored.' },
  { n: 37, title: 'Stage compelling spectacles', gist: 'Striking imagery and symbolic gestures build an aura that argument never will.' },
  { n: 38, title: 'Think as you like, behave like others', gist: 'Flaunting unconventional ideas invites quiet revenge. Save originality for those who can hear it.' },
  { n: 39, title: 'Stir waters to catch fish', gist: 'Stay calm while making rivals angry; the one who loses composure loses the advantage.' },
  { n: 40, title: 'Despise the free lunch', gist: 'What comes free carries hidden obligation. Pay your own way, and pay well where it counts.' },
  { n: 41, title: 'Avoid stepping into great shoes', gist: 'Following a legend traps you in comparison. Change direction and shine by your own light.' },
  { n: 42, title: 'Strike the shepherd', gist: 'Trouble usually traces to one instigator. Remove the source and the flock scatters.' },
  { n: 43, title: 'Work on hearts and minds', gist: 'Coercion breeds backlash. Seduce people into wanting to move your way.' },
  { n: 44, title: 'Mirror to disarm', gist: 'Reflect people’s behavior back at them and they cannot read you — while their own moves mock them.' },
  { n: 45, title: 'Preach change, move slowly', gist: 'People honor novelty but live by habit. Reform wears best dressed as tradition.' },
  { n: 46, title: 'Never appear too perfect', gist: 'Envy is quiet and dangerous. Admit harmless flaws and remain approachable.' },
  { n: 47, title: 'Stop at the goal', gist: 'Victory tempts you past the objective, where new enemies wait. When you win, stop.' },
  { n: 48, title: 'Assume formlessness', gist: 'Fixed shapes are attackable. Stay fluid and adaptable, and there is nothing to strike.' },
];

export interface LawRotationState {
  /** Index into LAWS (0-based). */
  lawIndex: number;
  /** Epoch ms of the last rotation. */
  rotatedAt: number;
}

/** Allowed cadences, hours. */
export const LAW_INTERVALS_H = [3, 4, 6, 12, 24] as const;
export const DEFAULT_LAW_INTERVAL_H = 4;

export function parseLawsConfig(raw: unknown): { intervalHours: number } {
  if (raw && typeof raw === 'object') {
    const v = (raw as Record<string, unknown>).intervalHours;
    if (typeof v === 'number' && (LAW_INTERVALS_H as readonly number[]).includes(v)) {
      return { intervalHours: v };
    }
  }
  return { intervalHours: DEFAULT_LAW_INTERVAL_H };
}

/** Advance (or initialize) the rotation. Persisted state that is corrupt or
 *  from the future re-seeds cleanly; before the interval elapses the same
 *  state comes back by reference (no re-render churn). A rotation always
 *  moves to a DIFFERENT law so the tile can't get stuck. */
export function rotateLaw(
  state: LawRotationState | null,
  nowMs: number,
  intervalMs: number,
  rand: () => number = Math.random,
): LawRotationState {
  const valid = state
    && Number.isInteger(state.lawIndex) && state.lawIndex >= 0 && state.lawIndex < LAWS.length
    && typeof state.rotatedAt === 'number' && state.rotatedAt <= nowMs;
  if (!valid) {
    return { lawIndex: Math.floor(rand() * LAWS.length), rotatedAt: nowMs };
  }
  if (nowMs - state.rotatedAt < intervalMs) return state;
  let next = Math.floor(rand() * (LAWS.length - 1));
  if (next >= state.lawIndex) next++; // uniform over the other 47
  return { lawIndex: next, rotatedAt: nowMs };
}
