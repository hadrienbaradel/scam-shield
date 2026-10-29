// Micro-learning (_product/specs/micro-learning.md): the lessons, public so
// the demo, the video and a judge open them without signing in, and the
// signed-in person's progress (best stars per lesson, badges, days in a
// row), one row per person in lesson_progress, erased with the account
// (ON DELETE CASCADE).

import { relative } from "node:path";
import { requireUser } from "../auth.js";
import { one, q } from "../db/pool.js";
import { applyLessonResult, daysBetween, emptyProgress, isDay, loadLessons, resultProblem, summarize, utcDay } from "../../lib/lessons.js";

// Loaded once at start. A broken file is logged and left out, never a crash
// (make lessons-check and the tests fail on it instead).
const { lessons: LESSONS, problems } = loadLessons();
for (const p of problems) console.warn(`lessons: ${relative(process.cwd(), p.file)}: ${p.problem}`);
const SHIPPED = new Set([...LESSONS.en, ...LESSONS.fr].map((l) => l.id));

// The person's own day when they send one (within two days of UTC's), else UTC's.
const ownDay = (day) => (isDay(day) && Math.abs(daysBetween(utcDay(), day)) <= 2 ? day : utcDay());

async function progressOf(userId) {
  return (await one("SELECT progress FROM lesson_progress WHERE user_id = $1", [userId]))?.progress || emptyProgress();
}

export default async function lessonRoutes(app) {
  app.get("/api/lessons", async (request) => ({ lessons: LESSONS[request.query.lang === "fr" ? "fr" : "en"] }));

  app.register(async (priv) => {
    priv.addHook("preHandler", requireUser);

    // ?day=YYYY-MM-DD, the person's own day: "days in a row" follows their
    // evening rather than UTC's.
    priv.get("/api/learn/progress", async (request) => {
      const progress = await progressOf(request.user.id);
      return { progress, summary: summarize(progress, LESSONS.en, ownDay(request.query.day)) };
    });

    priv.put("/api/learn/progress/:lessonId", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
      const { lessonId } = request.params;
      if (!SHIPPED.has(lessonId)) return reply.code(404).send({ error: "There is no lesson with that name." });
      const problem = resultProblem(request.body);
      if (problem) return reply.code(400).send({ error: problem });
      const { stars, day } = request.body;
      const progress = applyLessonResult(await progressOf(request.user.id), { lessonId, stars, day });
      await q(`INSERT INTO lesson_progress (user_id, progress) VALUES ($1, $2)
               ON CONFLICT (user_id) DO UPDATE SET progress = EXCLUDED.progress, updated_at = now()`, [request.user.id, progress]);
      return { progress, summary: summarize(progress, LESSONS.en, day) };
    });
  });
}
