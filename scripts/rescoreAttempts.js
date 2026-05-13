/**
 * One-time migration: rescore all completed attempts using corrected correct_answer values.
 *
 * Run AFTER the correct_answer UPDATE has been applied to assessment_question_tbl.
 * Usage: node scripts/rescoreAttempts.js
 */
import { getPool } from "../config/getPool.js";

const pool = getPool();

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fetch all completed attempts with their assessment's passing_score
    const { rows: attempts } = await client.query(`
      SELECT
        at.attempt_id,
        at.assessment_id,
        at.answers,
        a.passing_score
      FROM v4.assessment_attempt_tbl at
      JOIN v4.assessment_tbl a USING (assessment_id)
      WHERE at.status = 'completed'
    `);

    console.log(`Found ${attempts.length} completed attempts to rescore.`);

    let updated = 0;
    let skipped = 0;

    for (const attempt of attempts) {
      // Fetch current (corrected) questions for this assessment
      const { rows: questions } = await client.query(`
        SELECT question_id, question_type, correct_answer, points
        FROM v4.assessment_question_tbl
        WHERE assessment_id = $1
      `, [attempt.assessment_id]);

      if (questions.length === 0) {
        skipped++;
        continue;
      }

      const storedAnswers = attempt.answers ?? {};
      let earnedPoints = 0;
      let totalPoints = 0;
      const rescored = {};

      for (const q of questions) {
        totalPoints += q.points;
        const entry = storedAnswers[q.question_id];
        const userAnswer = entry?.response ?? null;

        rescored[q.question_id] = {
          response: userAnswer,
          isCorrect: false,
          pointsEarned: 0,
        };

        if (!userAnswer || !q.correct_answer) continue;

        const isCorrect =
          q.question_type === "text"
            ? userAnswer.trim().toLowerCase() === q.correct_answer.trim().toLowerCase()
            : userAnswer.trim() === q.correct_answer.trim();

        if (isCorrect) {
          earnedPoints += q.points;
          rescored[q.question_id].isCorrect = true;
          rescored[q.question_id].pointsEarned = q.points;
        }
      }

      const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
      const passed = score >= (attempt.passing_score ?? 70);

      await client.query(`
        UPDATE v4.assessment_attempt_tbl
        SET score = $1, passed = $2, answers = $3
        WHERE attempt_id = $4
      `, [score, passed, JSON.stringify(rescored), attempt.attempt_id]);

      updated++;
      console.log(`  attempt ${attempt.attempt_id}: score=${score}% passed=${passed}`);
    }

    await client.query("COMMIT");
    console.log(`\nDone. Updated: ${updated}, Skipped (no questions): ${skipped}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Rescoring failed, rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
