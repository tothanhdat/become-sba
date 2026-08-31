import Link from "next/link";

import { getCertification, listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { DECKS, type Deck } from "@/lib/domain";
import { getDeckStats, getDueCards } from "@/lib/srs/decks";
import { grade } from "../actions";

export const dynamic = "force-dynamic";

const BUTTONS = [
  { key: "forgot", label: "Quên" },
  { key: "hard", label: "Khó" },
  { key: "good", label: "Tốt" },
  { key: "easy", label: "Dễ" },
] as const;

export default async function Flashcards({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string; cert?: string }>;
}) {
  const params = await searchParams;
  const deck = DECKS.includes(params.deck as Deck) ? (params.deck as Deck) : undefined;

  const all = listCertifications(db);
  const cert = (params.cert && getCertification(db, params.cert)) || all[all.length - 1];
  const frameworkId = cert.framework.id;

  const stats = getDeckStats(db, frameworkId);
  const due = getDueCards(db, { frameworkId, deck, limit: 1 });
  const remaining = getDueCards(db, { frameworkId, deck }).length;

  return (
    <main>
      <p>
        <Link href={`/debug?cert=${cert.code}`}>← Trang chủ</Link>
      </p>
      <h1>
        Flashcard — {cert.framework.name} {deck ? `· ${deck}` : "· tất cả"}
      </h1>

      <p>
        Bộ thẻ:{" "}
        {DECKS.map((d) => (
          <span key={d}>
            <Link href={`/debug/flashcards?cert=${cert.code}&deck=${d}`}>
              {d} ({stats[d].due}/{stats[d].total})
            </Link>{" "}
          </span>
        ))}
        <Link href={`/debug/flashcards?cert=${cert.code}`}>tất cả</Link>
      </p>

      <p>Còn {remaining} thẻ đến hạn.</p>

      {due.length === 0 ? (
        <p>Hết thẻ đến hạn. Quay lại sau nhé.</p>
      ) : (
        <section>
          <h2>{due[0].front}</h2>
          <details>
            <summary>Xem mặt sau</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{due[0].back}</pre>
            {due[0].sourceRef && <p>{cert.framework.name} {due[0].sourceRef}</p>}
          </details>
          <p>
            {BUTTONS.map((b) => (
              <form
                key={b.key}
                action={grade}
                style={{ display: "inline-block", marginRight: "0.5rem" }}
              >
                <input type="hidden" name="cardId" value={due[0].id} />
                <input type="hidden" name="button" value={b.key} />
                <button type="submit">{b.label}</button>
              </form>
            ))}
          </p>
          <p>
            <small>
              đã ôn {due[0].repetitions} lần · deck {due[0].deck}
            </small>
          </p>
        </section>
      )}
    </main>
  );
}
