/**
 * Integration tests for the HTTP layer.
 *
 * These exercise the real route handlers against a real in-memory database, so
 * they cover the thing unit tests cannot: status codes, request parsing, and
 * that a mock exam in progress never ships the answer key to the browser.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

import { seedCatalogAndBank } from "@/test-support/bank";

process.env.CBAP_DB_PATH = ":memory:";

type Ctx = { params: Promise<{ id: string }> };

const ctx = (id: number | string): Ctx => ({ params: Promise.resolve({ id: String(id) }) });

function post(body?: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Fresh module graph — and therefore a fresh in-memory database — per test. */
async function boot(questionsPerKa = 4) {
  vi.resetModules();
  // The db module caches its handle on globalThis to survive Next.js hot
  // reloads, which also makes it survive resetModules. Drop it so each test
  // really does start from an empty database.
  delete (globalThis as { cbapDb?: unknown }).cbapDb;

  const { db } = await import("@/lib/db");
  const { importFlashcardDeck } = await import("@/lib/content/importer");

  seedCatalogAndBank(db, questionsPerKa);
  importFlashcardDeck(db, {
    version: 1,
    frameworkCode: "babok-v3",
    deck: "techniques",
    cards: [{ code: "T-1", front: "Document Analysis", back: "Study existing documentation." }],
  });

  return {
    db,
    certifications: await import("@/app/api/certifications/route"),
    sessions: await import("@/app/api/sessions/route"),
    session: await import("@/app/api/sessions/[id]/route"),
    answers: await import("@/app/api/sessions/[id]/answers/route"),
    submit: await import("@/app/api/sessions/[id]/submit/route"),
    result: await import("@/app/api/sessions/[id]/result/route"),
    note: await import("@/app/api/questions/[id]/note/route"),
    bookmark: await import("@/app/api/questions/[id]/bookmark/route"),
    due: await import("@/app/api/flashcards/due/route"),
    review: await import("@/app/api/flashcards/[id]/review/route"),
    stats: await import("@/app/api/stats/route"),
  };
}

beforeEach(() => {
  vi.resetModules();
  delete (globalThis as { cbapDb?: unknown }).cbapDb;
});

describe("POST /api/sessions", () => {
  test("creates a session and returns its id", async () => {
    const app = await boot();
    const res = await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 10 }));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ sessionId: expect.any(Number) });
  });

  test("rejects an unknown mode with 400", async () => {
    const app = await boot();
    const res = await app.sessions.POST(post({ certificationCode: "CBAP", mode: "nonsense" }));
    expect(res.status).toBe(400);
  });

  test("rejects a domain session with no domain given", async () => {
    const app = await boot();
    const res = await app.sessions.POST(post({ certificationCode: "CBAP", mode: "domain" }));
    expect(res.status).toBe(400);
  });

  test("rejects a certification that does not exist", async () => {
    const app = await boot();
    const res = await app.sessions.POST(post({ certificationCode: "PMP", mode: "quick" }));
    expect(res.status).toBe(404);
  });

  test("refuses a certification that has no content yet", async () => {
    const app = await boot();
    const res = await app.sessions.POST(post({ certificationCode: "ECBA", mode: "quick" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sessions/[id]", () => {
  test("serves the questions without the answer key", async () => {
    const app = await boot();
    const { sessionId } = await (await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 5 }))).json();

    const res = await app.session.GET(new Request("http://localhost"), ctx(sessionId));
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).not.toContain("isCorrect");
    expect(body).not.toContain("rationale");
    expect(JSON.parse(body).questions).toHaveLength(5);
  });

  test("returns 404 for a session that does not exist", async () => {
    const app = await boot();
    const res = await app.session.GET(new Request("http://localhost"), ctx(9999));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/sessions/[id]/answers", () => {
  test("saves an answer and reflects it on reload", async () => {
    const app = await boot();
    const { sessionId } = await (await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 5 }))).json();
    const view = await (await app.session.GET(new Request("http://localhost"), ctx(sessionId))).json();
    const first = view.questions[0];

    const patch = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: first.questionId, selectedOptionId: first.options[1].id }),
    });
    expect((await app.answers.PATCH(patch, ctx(sessionId))).status).toBe(200);

    const reloaded = await (await app.session.GET(new Request("http://localhost"), ctx(sessionId))).json();
    expect(reloaded.questions[0].selectedOptionId).toBe(first.options[1].id);
  });

  test("rejects an option that belongs to another question", async () => {
    const app = await boot();
    const { sessionId } = await (await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 5 }))).json();
    const view = await (await app.session.GET(new Request("http://localhost"), ctx(sessionId))).json();

    const patch = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questionId: view.questions[0].questionId,
        selectedOptionId: view.questions[1].options[0].id,
      }),
    });
    expect((await app.answers.PATCH(patch, ctx(sessionId))).status).toBe(400);
  });
});

describe("submit and result", () => {
  test("submitting returns a score and unlocks the result", async () => {
    const app = await boot();
    const { sessionId } = await (await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 6 }))).json();

    const submitted = await app.submit.POST(post(), ctx(sessionId));
    expect(submitted.status).toBe(200);
    await expect(submitted.json()).resolves.toMatchObject({ total: 6, unanswered: 6 });

    const result = await app.result.GET(new Request("http://localhost"), ctx(sessionId));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.questions[0].explanation).toBeTruthy();
    expect(body.questions[0].options[0].rationale).toBeTruthy();
  });

  test("the result is locked until the session is submitted", async () => {
    const app = await boot();
    const { sessionId } = await (await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 6 }))).json();
    const res = await app.result.GET(new Request("http://localhost"), ctx(sessionId));
    expect(res.status).toBe(409);
  });

  test("a session cannot be submitted twice", async () => {
    const app = await boot();
    const { sessionId } = await (await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 6 }))).json();
    await app.submit.POST(post(), ctx(sessionId));
    expect((await app.submit.POST(post(), ctx(sessionId))).status).toBe(409);
  });
});

describe("notes and bookmarks", () => {
  test("saves a note against a question", async () => {
    const app = await boot();
    const { sessionId } = await (await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 5 }))).json();
    const view = await (await app.session.GET(new Request("http://localhost"), ctx(sessionId))).json();
    const questionId = view.questions[0].questionId;

    const res = await app.note.POST(post({ body: "Elicitation results are unconfirmed." }), ctx(questionId));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ note: "Elicitation results are unconfirmed." });
  });

  test("toggles a bookmark on and off", async () => {
    const app = await boot();
    const { sessionId } = await (await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 5 }))).json();
    const view = await (await app.session.GET(new Request("http://localhost"), ctx(sessionId))).json();
    const questionId = view.questions[0].questionId;

    await expect((await app.bookmark.POST(post(), ctx(questionId))).json()).resolves.toEqual({
      bookmarked: true,
    });
    await expect((await app.bookmark.POST(post(), ctx(questionId))).json()).resolves.toEqual({
      bookmarked: false,
    });
  });

  test("returns 404 for a question that does not exist", async () => {
    const app = await boot();
    expect((await app.bookmark.POST(post(), ctx(9999))).status).toBe(404);
  });
});

describe("flashcards", () => {
  test("lists due cards and schedules a review", async () => {
    const app = await boot();
    const dueRes = await app.due.GET(new Request("http://localhost/api/flashcards/due"));
    const cards = await dueRes.json();
    expect(cards).toHaveLength(1);

    const res = await app.review.POST(post({ button: "good" }), ctx(cards[0].id));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ intervalDays: 1, repetitions: 1 });
  });

  test("rejects an unknown review button", async () => {
    const app = await boot();
    const cards = await (await app.due.GET(new Request("http://localhost/api/flashcards/due"))).json();
    expect((await app.review.POST(post({ button: "sort-of" }), ctx(cards[0].id))).status).toBe(400);
  });
});

describe("GET /api/certifications", () => {
  test("lists every certification with its real blueprint", async () => {
    const app = await boot();
    const { certifications } = await (await app.certifications.GET()).json();

    expect(certifications.map((c: { code: string }) => c.code)).toEqual(["ECBA", "CCBA", "CBAP"]);

    const cbap = certifications.find((c: { code: string }) => c.code === "CBAP");
    expect(cbap).toMatchObject({ questionCount: 120, timeLimitSec: 12600, ready: true });
    expect(cbap.domains).toHaveLength(6);

    const ccba = certifications.find((c: { code: string }) => c.code === "CCBA");
    expect(ccba).toMatchObject({ questionCount: 130, timeLimitSec: 10800 });

    const ecba = certifications.find((c: { code: string }) => c.code === "ECBA");
    expect(ecba).toMatchObject({ questionCount: 50, availableQuestions: 0, ready: false });
    expect(ecba.domains).toHaveLength(2);
  });

  test("reports how many questions each certification can actually serve", async () => {
    const app = await boot(4);
    const { certifications } = await (await app.certifications.GET()).json();
    const by = Object.fromEntries(
      certifications.map((c: { code: string; availableQuestions: number }) => [
        c.code,
        c.availableQuestions,
      ]),
    );
    // One bank of 24 level-2 BABOK questions: both BABOK certifications can use
    // it, ECBA examines a different framework and sees none of it.
    expect(by).toEqual({ CBAP: 24, CCBA: 24, ECBA: 0 });
  });
});

describe("GET /api/stats", () => {
  test("reports readiness, history and deck progress for one certification", async () => {
    const app = await boot();
    const res = await app.stats.GET(new Request("http://localhost/api/stats?certification=CBAP"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      certification: { code: "CBAP" },
      readiness: { answered: 0 },
      history: [],
      decks: { techniques: { total: 1 } },
    });
  });

  test("requires a certification", async () => {
    const app = await boot();
    expect((await app.stats.GET(new Request("http://localhost/api/stats"))).status).toBe(400);
  });

  test("returns 404 for an unknown certification", async () => {
    const app = await boot();
    const res = await app.stats.GET(new Request("http://localhost/api/stats?certification=PMP"));
    expect(res.status).toBe(404);
  });
});
