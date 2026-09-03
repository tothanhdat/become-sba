import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSessionResult } from "@/lib/exam/sessions";
import { bookmark, note } from "../../actions";

export const dynamic = "force-dynamic";

export default async function Result({ params }: { params: Promise<{ id: string }> }) {
  const sessionId = Number((await params).id);
  if (!Number.isInteger(sessionId)) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/debug/result/${sessionId}`)}`);
  }
  const userId = session.user.id;

  let result;
  try {
    result = getSessionResult(db, userId, sessionId);
  } catch (error) {
    return (
      <main>
        <p>{error instanceof Error ? error.message : "Không mở được kết quả."}</p>
        <p>
          <Link href="/debug">← Trang chủ</Link>
        </p>
      </main>
    );
  }

  const wrong = result.questions.filter((q) => !q.isCorrect);
  const returnTo = `/debug/result/${sessionId}`;

  return (
    <main>
      <p>
        <Link href="/debug">← Trang chủ</Link>
      </p>
      <h1>
        Kết quả session {result.session.id} — {result.session.certificationCode}
      </h1>
      <p>
        <strong>
          {result.score.correct}/{result.score.total} = {result.score.percent}% —{" "}
          {result.score.passed ? "ĐẠT" : "CHƯA ĐẠT"}
        </strong>{" "}
        (ngưỡng {result.certification.passThresholdPercent}%) · bỏ trống {result.score.unanswered} câu
      </p>

      <h2>Theo {result.certification.framework.domainLabel}</h2>
      <table border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>{result.certification.framework.domainLabel}</th>
            <th>Đúng</th>
            <th>Tổng</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {result.certification.domains.map((d) => (
            <tr key={d.code}>
              <td>
                {d.code} — {d.nameVi}
              </td>
              <td>{result.score.byDomain[d.code].correct}</td>
              <td>{result.score.byDomain[d.code].total}</td>
              <td>{result.score.byDomain[d.code].percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Xem lại ({wrong.length} câu sai)</h2>
      {result.questions.map((q) => (
        <section key={q.questionId}>
          <h3>
            Câu {q.position} · {q.domain} · {result.certification.framework.name}{" "}
            {q.sourceRef} {q.sourceTask} ·{" "}
            {q.isCorrect ? "ĐÚNG" : "SAI"}
          </h3>

          {q.caseStudy && (
            <blockquote>
              <strong>{q.caseStudy.title}</strong>
              <p>{q.caseStudy.body}</p>
            </blockquote>
          )}

          <p>{q.stem}</p>

          <ul>
            {q.options.map((o) => (
              <li key={o.id}>
                <strong>
                  {o.label}. {o.text}
                </strong>
                {o.isCorrect ? " ← ĐÁP ÁN ĐÚNG" : ""}
                {q.selectedOptionId === o.id ? " ← BẠN CHỌN" : ""}
                <br />
                <em>{o.rationale}</em>
              </li>
            ))}
          </ul>

          <p>
            <strong>Giải thích:</strong> {q.explanation}
          </p>

          <form action={note}>
            <input type="hidden" name="questionId" value={q.questionId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label>
              Ghi chú của bạn:{" "}
              <textarea name="body" rows={2} cols={70} defaultValue={q.note ?? ""} />
            </label>
            <button type="submit">Lưu ghi chú</button>
          </form>

          <form action={bookmark}>
            <input type="hidden" name="questionId" value={q.questionId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit">{q.bookmarked ? "Bỏ bookmark" : "Bookmark câu này"}</button>
          </form>
          <hr />
        </section>
      ))}
    </main>
  );
}
