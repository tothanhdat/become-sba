import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getReadiness, getSessionHistory } from "@/lib/analytics";
import { getCertification, listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage, loadReviewPool } from "@/lib/exam/sessions";
import { getDeckStats } from "@/lib/srs/decks";
import { startSession } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Unstyled harness for exercising the backend end to end. It is deliberately
 * plain: the real interface is built from docs/UI-SPEC.md in a later phase.
 */
export default async function DebugHome({
  searchParams,
}: {
  searchParams: Promise<{ cert?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/debug")}`);
  }
  const userId = session.user.id;

  const all = listCertifications(db);
  const requested = (await searchParams).cert;
  const cert = (requested && getCertification(db, requested)) || all[all.length - 1];

  const readiness = getReadiness(db, userId, cert);
  const history = getSessionHistory(db, userId, cert, 15);
  const decks = getDeckStats(db, userId, cert.framework.id);
  const coverage = getBankCoverage(db, cert);
  const reviewPool = loadReviewPool(db, userId, cert).length;

  return (
    <main>
      <h1>CBAP Prep — debug</h1>

      <h2>Chứng chỉ đang học</h2>
      <p>
        {all.map((c) => (
          <span key={c.code}>
            <Link href={`/debug?cert=${c.code}`}>
              {c.code === cert.code ? <strong>[{c.code}]</strong> : c.code}
            </Link>{" "}
          </span>
        ))}
      </p>
      <table border={1} cellPadding={4}>
        <tbody>
          <tr>
            <td>Chứng chỉ</td>
            <td>
              {cert.name} ({cert.tier}, {cert.body})
            </td>
          </tr>
          <tr>
            <td>Nguồn kiến thức</td>
            <td>{cert.framework.name}</td>
          </tr>
          <tr>
            <td>Đề thi thật</td>
            <td>
              {cert.questionCount} câu / {cert.timeLimitSec / 60} phút · {cert.questionTypes}
            </td>
          </tr>
          <tr>
            <td>Cấp độ</td>
            <td>{cert.proficiencyLabel}</td>
          </tr>
          <tr>
            <td>Ngưỡng đạt</td>
            <td>
              {cert.passThresholdPercent}% — {cert.passThresholdSource}
            </td>
          </tr>
          <tr>
            <td>Câu hỏi khả dụng</td>
            <td>
              {coverage.total} / {cert.questionCount} cần cho một đề đầy đủ
            </td>
          </tr>
        </tbody>
      </table>

      {coverage.total === 0 && (
        <p>
          <strong>Chưa có dữ liệu cho {cert.code}.</strong> Blueprint đã cấu hình đầy đủ và sẵn
          sàng khi có câu hỏi. {cert.code} thi trên {cert.framework.name}
          {cert.framework.code !== "babok-v3" && " — khác framework nên không dùng chung kho BABOK"}.
        </p>
      )}

      <h2>Readiness</h2>
      <p>
        Đã trả lời {readiness.answered} câu, đúng {readiness.correct} ({readiness.overallPercent}%) —{" "}
        {readiness.onTrack
          ? "đang trên đà đạt"
          : `chưa đạt ngưỡng ${cert.passThresholdPercent}%`}
      </p>
      <table border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>{cert.framework.domainLabel}</th>
            <th>Tỷ trọng đề</th>
            <th>Câu khả dụng</th>
            <th>Đã làm</th>
            <th>Đúng</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {cert.domains.map((d) => (
            <tr key={d.code}>
              <td>
                {d.code} — {d.nameVi}
              </td>
              <td>{d.weight}%</td>
              <td>{coverage.byDomain[d.code] ?? 0}</td>
              <td>{readiness.byDomain[d.code].total}</td>
              <td>{readiness.byDomain[d.code].correct}</td>
              <td>{readiness.byDomain[d.code].percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {readiness.weakestDomains.length > 0 && (
        <p>Yếu nhất: {readiness.weakestDomains.join(", ")}</p>
      )}

      <h2>Bắt đầu làm bài</h2>
      {coverage.total === 0 ? (
        <p>Không có câu hỏi nào cho {cert.code}.</p>
      ) : (
        <>
          <form action={startSession}>
            <input type="hidden" name="certification" value={cert.code} />
            <input type="hidden" name="mode" value="mock" />
            <button type="submit">
              Mock exam — {cert.questionCount} câu / {cert.timeLimitSec / 60} phút
            </button>
          </form>
          <form action={startSession}>
            <input type="hidden" name="certification" value={cert.code} />
            <input type="hidden" name="mode" value="quick" />
            <label>
              Quick quiz, số câu: <input type="number" name="total" defaultValue={15} min={1} max={50} />
            </label>
            <button type="submit">Bắt đầu</button>
          </form>
          <form action={startSession}>
            <input type="hidden" name="certification" value={cert.code} />
            <input type="hidden" name="mode" value="domain" />
            <label>
              Luyện theo {cert.framework.domainLabel}:{" "}
              <select name="domain" defaultValue={cert.domains[0].code}>
                {cert.domains.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.nameVi}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {" "}số câu: <input type="number" name="total" defaultValue={20} min={1} max={60} />
            </label>
            <button type="submit">Bắt đầu</button>
          </form>
          <form action={startSession}>
            <input type="hidden" name="certification" value={cert.code} />
            <input type="hidden" name="mode" value="review" />
            <label>
              Ôn câu sai / bookmark ({reviewPool} câu trong kho), lấy:{" "}
              <input type="number" name="total" defaultValue={20} min={1} max={100} />
            </label>
            <button type="submit" disabled={reviewPool === 0}>
              Bắt đầu
            </button>
          </form>
        </>
      )}

      <h2>Flashcard — {cert.framework.name}</h2>
      <ul>
        {Object.entries(decks).map(([deck, s]) => (
          <li key={deck}>
            <Link href={`/debug/flashcards?cert=${cert.code}&deck=${deck}`}>{deck}</Link>: {s.total}{" "}
            thẻ, {s.due} đến hạn, {s.new} chưa học
          </li>
        ))}
        <li>
          <Link href={`/debug/flashcards?cert=${cert.code}`}>Tất cả bộ thẻ</Link>
        </li>
      </ul>

      <h2>Lịch sử {cert.code} ({history.length})</h2>
      {history.length === 0 ? (
        <p>Chưa có bài nào được nộp.</p>
      ) : (
        <table border={1} cellPadding={4}>
          <thead>
            <tr>
              <th>#</th>
              <th>Chế độ</th>
              <th>Số câu</th>
              <th>Điểm</th>
              <th>%</th>
              <th>Kết quả</th>
              <th>Thời gian</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{h.id}</td>
                <td>
                  {h.mode}
                  {h.domain ? ` (${h.domain})` : ""}
                </td>
                <td>{h.questionCount}</td>
                <td>{h.score}</td>
                <td>{h.percent}%</td>
                <td>{h.passed ? "Đạt" : "Chưa đạt"}</td>
                <td>{Math.round(h.durationSec / 60)} phút</td>
                <td>
                  <Link href={`/debug/result/${h.id}`}>Xem lại</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
