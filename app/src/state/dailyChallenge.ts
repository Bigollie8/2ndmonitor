/** LeetCode GraphQL — `activeDailyCodingChallengeQuestion` returns the day's
 *  problem. Public endpoint, no auth required for read. CORS friendly when
 *  called from a desktop app context. */

export interface DailyChallenge {
  date: string;        // YYYY-MM-DD
  title: string;
  titleSlug: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  questionId: string;
  /** Acceptance rate as a percentage. */
  acRate: number;
  /** Plain-text problem statement (HTML stripped). Truncated for display. */
  preview: string;
  url: string;
  topics: string[];
}

const QUERY = `query questionOfToday {
  activeDailyCodingChallengeQuestion {
    date
    link
    question {
      questionId
      titleSlug
      title
      difficulty
      acRate
      content
      topicTags { name }
    }
  }
}`;

interface RawResponse {
  data?: {
    activeDailyCodingChallengeQuestion?: {
      date?: string;
      link?: string;
      question?: {
        questionId?: string;
        titleSlug?: string;
        title?: string;
        difficulty?: string;
        acRate?: number;
        content?: string;
        topicTags?: Array<{ name?: string }>;
      };
    };
  };
}

export async function fetchDailyChallenge(): Promise<DailyChallenge | null> {
  try {
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, operationName: 'questionOfToday' }),
    });
    if (!res.ok) return null;
    const data = await res.json() as RawResponse;
    const q = data.data?.activeDailyCodingChallengeQuestion;
    const inner = q?.question;
    if (!q || !inner || !inner.titleSlug || !inner.title) return null;
    const link = q.link ?? `/problems/${inner.titleSlug}/`;
    return {
      date: q.date ?? new Date().toISOString().slice(0, 10),
      title: inner.title,
      titleSlug: inner.titleSlug,
      difficulty: (inner.difficulty as DailyChallenge['difficulty']) ?? 'Medium',
      questionId: inner.questionId ?? '',
      acRate: typeof inner.acRate === 'number' ? inner.acRate : 0,
      preview: stripHtml(inner.content ?? '').slice(0, 280),
      url: link.startsWith('http') ? link : `https://leetcode.com${link}`,
      topics: Array.isArray(inner.topicTags)
        ? inner.topicTags.map((t) => t.name ?? '').filter((n) => n.length > 0)
        : [],
    };
  } catch (err) {
    console.warn('daily-challenge fetch failed', err);
    return null;
  }
}

/** Strip HTML to plain text. Naive — fine for LeetCode's bounded markup. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
