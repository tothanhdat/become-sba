# BA Prep

App luyện thi chứng chỉ phân tích nghiệp vụ (IIBA). Chạy local, dữ liệu nằm trong
SQLite trên máy bạn.

Hỗ trợ **nhiều chứng chỉ**. Hiện có CBAP (đầy đủ nội dung), CCBA và ECBA
(blueprint thật, chưa có nội dung — xem [Vì sao](#vì-sao-ccba-và-ecba-chưa-có-nội-dung)).

## Chạy lần đầu

```bash
npm install
npm run seed      # nạp catalog chứng chỉ + ngân hàng câu hỏi + flashcard
npm run dev       # http://localhost:3000
```

Hiện giao diện là trang `/debug` — HTML thô, đủ để dùng thật. Giao diện chính thức
được dựng từ `docs/UI-SPEC.md` và [file Figma](https://www.figma.com/design/yT3XNK1Vro1ndhMRW2X3gr).

## Đăng nhập Google

App yêu cầu đăng nhập Google cho mọi thứ đụng tới tiến độ cá nhân — làm bài thi,
ghi chú, bookmark, ôn flashcard. Xem Dashboard/Library và chọn bộ flashcard vẫn
dùng được mà không cần đăng nhập.

Cần 4 biến môi trường trong `.env.local` (không commit):

| Biến | Ý nghĩa |
|---|---|
| `AUTH_SECRET` | Sinh bằng `npx auth secret`, hoặc bất kỳ giá trị ngẫu nhiên ≥ 32 byte |
| `AUTH_GOOGLE_ID` | OAuth 2.0 Client ID từ Google Cloud Console |
| `AUTH_GOOGLE_SECRET` | Client secret đi kèm |
| `AUTH_URL` | Gốc URL của app, vd `http://localhost:3000` khi chạy local |

Lấy `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`: tạo OAuth 2.0 Client ID loại **Web
application** trong Google Cloud Console, khai báo authorized redirect URI là
`{AUTH_URL}/api/auth/callback/google` (vd `http://localhost:3000/api/auth/callback/google`
khi chạy local).

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy app |
| `npm test` | 177 test — catalog, sinh đề, chấm điểm, SM-2, import, API |
| `npm run typecheck` | Kiểm tra kiểu |
| `npm run seed` | Nạp/cập nhật nội dung. Chạy lại được nhiều lần |
| `npm run reset` | Xoá tiến độ học, **giữ nguyên** ngân hàng câu hỏi |
| `npm run babok:extract` | Trích BABOK PDF → text (cần khi thay file PDF) |
| `npm run decks:build` | Sinh lại 3 bộ flashcard từ BABOK text |

Làm lại từ đầu hoàn toàn: `rm data/cbap.db && npm run seed`.
Có `data/cbap.db` từ trước tính năng đăng nhập Google: chạy lệnh trên một lần sau khi
pull — schema đổi (thêm bảng Auth.js) và migration được sinh lại từ đầu thay vì nối tiếp.

## Kiến trúc multi-certification

Không có gì riêng cho CBAP nằm trong code. Số câu, thời gian, danh sách domain, tỷ
trọng — tất cả là **dữ liệu** trong `content/catalog/`.

```
frameworks              Một body of knowledge, vd BABOK v3, The BA Standard
  └─ domains            Phân vùng của framework (Knowledge Area / Performance Domain)
certifications          Trỏ tới 1 framework + số câu, thời gian, ngưỡng, cấp độ
  └─ certification_domains   Tỷ trọng riêng của chứng chỉ cho từng domain
questions.domain_id  →  domain của framework, không gắn vào chứng chỉ
flashcards.framework_id →  bộ thẻ thuộc framework, mọi chứng chỉ trên đó dùng chung
```

**Câu hỏi thuộc framework, không thuộc chứng chỉ.** Nhờ vậy hai chứng chỉ cùng thi
trên BABOK dùng chung một kho, không nhân bản.

### Luật đủ điều kiện

Một câu hỏi chỉ được phục vụ cho một chứng chỉ khi thoả **tất cả**:

```
cùng framework
AND difficulty <= certification.proficiency_level
AND (certification.allows_case_studies OR câu không thuộc case study)
AND status = 'active'
```

Đây là chỗ hệ thống tự trung thực thay vì để người viết tự phán. Cùng một kho 100 câu:

| Chứng chỉ | Đủ điều kiện | Vì sao |
|---|---|---|
| CBAP | 100 | Level 3, cho phép case-study |
| CCBA | 36 | Level 2 loại 63 câu difficulty 3; không case-study loại thêm |
| ECBA | 0 | Framework khác hoàn toàn |

### Thêm một chứng chỉ mới

Không cần sửa code:

1. Nếu là body of knowledge mới → thêm framework + domains vào `content/catalog/frameworks.json`
2. Thêm chứng chỉ vào `content/catalog/certifications.json` (số câu, thời gian, cấp độ,
   có case-study không, tỷ trọng từng domain)
3. Viết pack câu hỏi trỏ tới `frameworkCode` đó
4. `npm run seed`

Seed sẽ từ chối nếu tỷ trọng không cộng đủ 100, thiếu domain, hoặc trỏ tới domain
không thuộc framework.

## Vì sao CCBA và ECBA chưa có nội dung

Không phải vì lười. Theo **handbook chính thức của IIBA**:

| | CBAP | CCBA | ECBA |
|---|---|---|---|
| Câu / thời gian | 120 / 210′ | 130 / **180′** | 50 / 75′ |
| IIBA mô tả loại câu | "multiple-choice, **case-study** and scenario-based" | "multiple-choice, scenario-based" | "situation-based and standard multiple-choice" |
| Cấp độ | Level 3 — Expert | **Level 2 — Skilled** | Level 1 — Foundational |
| Framework | BABOK v3 | BABOK v3 | **BA Standard + BABOK** |
| Tỷ trọng | 14·12·15·15·30·14 | 12·**20**·18·12·32·**6** | 9 domain khác hẳn |

- **ECBA** thi trên The Business Analysis Standard với 9 performance domain
  (Understanding BA 20%, Mindset 14%, Implementing BA 6%, và 6 khái niệm BACCM mỗi
  cái 10%). Từ 7/2025 nó không còn dùng 6 Knowledge Area. Kho BABOK không dùng lại được.
- **CCBA** cùng BABOK nhưng thi ở Level 2 và không có case-study. 100 câu hiện có
  viết cho Level 3, 63 câu là difficulty 3 và 13 câu gắn case study — chỉ 36 câu đủ
  điều kiện, trong khi CCBA cần 130. Đưa 36 câu Level 3 ra làm "đề CCBA" là sai lệch.

Blueprint của cả hai **đã cấu hình đúng theo handbook**. Khi có người viết câu hỏi
đúng cấp độ, chúng hoạt động ngay mà không cần sửa code.

## Nội dung

| Thành phần | Số lượng | Nguồn |
|---|---|---|
| Câu hỏi BABOK | 100 (RADD 30 · SA 15 · RLCM 15 · BAPM 14 · SE 14 · EC 12) | `content/packs/*.json` — viết tay, mỗi đáp án có rationale riêng |
| Case study | 2 | Trong pack `sa.json` và `radd.json` |
| Flashcard — techniques | 50 | Sinh từ BABOK chương 10 |
| Flashcard — tasks | 30 | Sinh từ BABOK chương 3–8: Purpose / Inputs / Elements / Outputs |
| Flashcard — glossary | 206 | Sinh từ BABOK Appendix A |

**BABOK v3 PDF nằm ở `content/babok/` và không được commit** — tài liệu có bản quyền IIBA.
Không có file đó thì `npm run seed` vẫn chạy (deck JSON đã sinh sẵn và được commit);
chỉ `babok:extract` và `decks:build` mới cần nó.

### Cổng chất lượng tham chiếu

Mỗi câu hỏi khai báo `sourceRef` + `sourceTask`. Khi seed, `src/lib/babok.ts` đối chiếu
với 30 task thật đã trích từ PDF. Câu nào sai số mục, sai tên task, hoặc xếp nhầm domain
sẽ bị **giữ ở trạng thái `draft` và không bao giờ vào đề**, kèm lý do khi seed.
Hiện 100/100 câu qua cổng này.

Framework chưa có registry tham chiếu (BA Standard) thì bỏ qua bước này — thêm registry
vào `FRAMEWORK_TASKS` là bật cổng lên.

## Cấu trúc

```
content/catalog/   frameworks.json + certifications.json — dữ liệu chứng chỉ
content/packs/     Ngân hàng câu hỏi (JSON) — nguồn sự thật
content/decks/     3 bộ flashcard (sinh ra từ BABOK, có commit)
src/lib/catalog.ts Nạp & truy vấn catalog chứng chỉ
src/lib/exam/      blueprint · generator · scoring · sessions
src/lib/srs/       sm2 (thuần) · decks (tầng DB)
src/lib/content/   Zod schema + importer idempotent
src/lib/babok.ts   30 task BABOK v3 + validator tham chiếu theo framework
src/app/api/       Route handlers
src/app/debug/     Giao diện thô hiện tại
docs/UI-SPEC.md    Đặc tả giao diện chính thức
```

`src/lib/exam/{blueprint,generator,scoring}.ts` và `src/lib/srs/sm2.ts` là **hàm thuần** —
không chạm DB, không chạm Next.js, không biết chứng chỉ nào tồn tại. Chúng nhận domain
và tỷ trọng làm tham số. Toàn bộ độ khó nằm ở đó và được test kỹ nhất.
