import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSessionForTaking } from "@/lib/exam/sessions";
import { answer, flag, submit } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TakeSession({ params }: { params: Promise<{ id: string }> }) {
  const sessionId = Number((await params).id);
  if (!Number.isInteger(sessionId)) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/debug/session/${sessionId}`)}`);
  }
  const userId = session.user.id;

  let view;
  try {
    view = getSessionForTaking(db, userId, sessionId);
  } catch {
    notFound();
  }

  if (view.session.submittedAt !== null) {
    return (
      <main>
        <p>
          Bài này đã nộp. <Link href={`/debug/result/${sessionId}`}>Xem kết quả</Link>
        </p>
      </main>
    );
  }

  const answered = view.questions.filter((q) => q.selectedOptionId !== null).length;
  const flagged = view.questions.filter((q) => q.flagged).length;

  return (
    <main>
      <p>
        <Link href="/debug">← Trang chủ</Link>
      </p>
      <h1>
        {view.session.certificationCode} · session {view.session.id} — {view.session.mode}
        {view.session.domain ? ` (${view.session.domain})` : ""}
      </h1>
      <p>
        {view.questions.length} câu · đã trả lời {answered} · đánh dấu {flagged} ·{" "}
        {view.session.timeLimitSec === null
          ? "không giới hạn thời gian"
          : `giới hạn ${view.session.timeLimitSec / 60} phút`}
      </p>

      <form action={submit}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <button type="submit">Nộp bài</button>
      </form>

      <hr />

      {view.questions.map((q) => (
        <section key={q.questionId} id={`q${q.position}`}>
          <h3>
            Câu {q.position} · {q.domain} — {q.domainName}
            {q.flagged ? " · ĐÃ ĐÁNH DẤU" : ""}
          </h3>

          {q.caseStudy && (
            <blockquote>
              <strong>{q.caseStudy.title}</strong>
              <p>{q.caseStudy.body}</p>
            </blockquote>
          )}

          <p>{q.stem}</p>

          {q.options.map((o) => (
            <form key={o.id} action={answer}>
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="questionId" value={q.questionId} />
              <input type="hidden" name="optionId" value={o.id} />
              <button type="submit">
                {q.selectedOptionId === o.id ? "● " : "○ "}
                {o.label}. {o.text}
              </button>
            </form>
          ))}

          <form action={flag}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="questionId" value={q.questionId} />
            <input type="hidden" name="flagged" value={q.flagged ? "0" : "1"} />
            <button type="submit">{q.flagged ? "Bỏ đánh dấu" : "Đánh dấu để xem lại"}</button>
          </form>
          <hr />
        </section>
      ))}

      <form action={submit}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <button type="submit">Nộp bài</button>
      </form>
    </main>
  );
}
