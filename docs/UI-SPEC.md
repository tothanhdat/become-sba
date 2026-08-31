# UI Specification — BA Prep

Nguồn để dựng Figma và để code frontend. Backend đã chạy; mọi dữ liệu dưới đây đều
đã có endpoint tương ứng (xem cột **Nguồn dữ liệu**).

Figma: https://www.figma.com/design/yT3XNK1Vro1ndhMRW2X3gr

## Multi-certification — đọc phần này trước

App phục vụ **nhiều chứng chỉ**, không riêng CBAP. Ba thứ sau **không được hard-code**
ở frontend, phải lấy từ API:

| Thứ | Vì sao |
|---|---|
| Danh sách domain và tên gọi | CBAP/CCBA có **6 Knowledge Area**; ECBA có **9 performance domain** khác hẳn |
| Nhãn gọi domain | `framework.domainLabel` — "Knowledge Area" với BABOK, "Performance Domain" với BA Standard. Đừng viết cứng chữ "KA" |
| Số câu, thời gian, ngưỡng đạt, tỷ trọng | CBAP 120/210′ · CCBA 130/180′ · ECBA 50/75′, tỷ trọng mỗi chứng chỉ một khác |

Mỗi chứng chỉ có **màu nhận diện** riêng (`accent`): CBAP indigo · CCBA teal · ECBA amber.
Màu này dùng ở tab chọn chứng chỉ và dải context, **không** dùng cho đúng/sai.

**Chứng chỉ chưa có dữ liệu vẫn chọn được**, và hiện empty state giải thích lý do —
xem màn 7. Không ẩn đi, không khoá.

## Nguyên tắc chung

| Hạng mục | Quy ước |
|---|---|
| Ngôn ngữ | Nhãn/nút/điều hướng: **tiếng Việt**. Nội dung câu hỏi, đáp án, giải thích, flashcard: **giữ nguyên tiếng Anh** (đề thi thật là tiếng Anh) |
| Thiết bị | Laptop là chính. Responsive tới ~768px cho flashcard và xem lại; màn làm bài không cần tối ưu mobile |
| Nền trang | Gradient dọc `ground/top #E7ECF4` → `ground/bottom #FBFBFA`, chuyển hết ở khoảng 50% chiều cao trang. Dồn sắc về phía trên để cảm nhận được ngay màn hình đầu, rồi lắng xuống gần trắng. **Lưu ý:** phần lớn trang bị các thẻ trắng che, nên gradient chỉ đọc được ở lề và phía sau tiêu đề mục — đó là chủ đích, không phải lỗi. Nếu muốn rõ hơn thì tăng `ground/top`, đừng đổi hướng |
| Bảng màu | Trung tính, dùng lâu không mỏi mắt. Màu ngữ nghĩa chỉ ở 3 chỗ: **đúng** (xanh lá), **sai** (đỏ), **đánh dấu** (hổ phách). Ngoài ra có màu nhận diện chứng chỉ và sắc độ theo chế độ thi (xem dưới) |
| Sắc độ 4 chế độ thi | Mock indigo · Luyện theo domain tím · Quick quiz xanh lá · Ôn câu sai đỏ nhạt. Nền `mode/*/bg`, viền `mode/*/border`, **nút dùng `mode/*/text`** |
| Chữ | Câu hỏi CBAP dài 3–6 câu. Thân bài ≥16px, dài dòng tối đa ~75 ký tự, giãn dòng 1.6 |
| Trạng thái | Mỗi màn cần 3 trạng thái: có dữ liệu · rỗng · lỗi |
| 6 KA | Luôn hiện theo thứ tự tỷ trọng giảm dần: RADD 30% · SA 15% · RLCM 15% · BAPM 14% · SE 14% · EC 12% |

## Bản đồ màn hình

```
Dashboard ──┬─> Chọn chế độ (inline trên Dashboard)
            │        └─> Màn làm bài ──> Màn kết quả ──> Xem lại từng câu
            ├─> Flashcard
            └─> Thư viện câu hỏi (bookmark / câu sai)
```

---

## 1. Dashboard

**Mục đích:** trả lời một câu duy nhất — *"hôm nay tôi nên học gì?"*

**Nguồn dữ liệu:** `GET /api/stats?certification=<code>` →
`{ certification, readiness, history, decks, coverage, reviewPoolSize }`

Mọi số liệu **phạm vi trong một chứng chỉ**. Tiến độ CBAP không cộng vào CCBA:
kho câu sai, readiness, lịch sử đều tách riêng.

### Thành phần

1. **Thẻ Readiness** (nổi bật nhất trên trang)
   - Số lớn: `readiness.overallPercent`%
   - Nhãn dưới: `readiness.correct`/`readiness.answered` câu đúng
   - Trạng thái: `readiness.onTrack` → "Đang trên đà đạt" / "Chưa đạt ngưỡng 70%"
   - Ghi chú nhỏ: *"Ngưỡng 70% là ước tính của cộng đồng — IIBA không công bố điểm đậu."*

2. **Biểu đồ domain** — thanh ngang, một dòng mỗi domain, **số dòng thay đổi theo chứng chỉ** (6 với CBAP/CCBA, 9 với ECBA)
   - Tiêu đề: `Độ chính xác theo {certification.framework.domainLabel}`
   - Nhãn: `domain.code` + `domain.nameVi`
   - Thanh: `readiness.byDomain[code].percent`, vạch mốc `passThresholdPercent`
   - Phụ: `correct/total`, tỷ trọng đề (`weight`%), và **số câu khả dụng** (`coverage.byDomain[code]`)
   - Domain trong `readiness.weakestDomains` được đánh dấu rõ
   - **Rỗng:** chưa làm bài nào → thanh xám + "Làm bài đầu tiên để thấy điểm mạnh yếu"

3. **Bốn thẻ bắt đầu làm bài** (`POST /api/sessions`)
   | Thẻ | Body gửi đi | Ghi trên thẻ |
   |---|---|---|
   | Mock exam | `{mode:"mock"}` | 120 câu · 210 phút · đúng tỷ trọng đề thật |
   | Luyện theo KA | `{mode:"ka", ka, total}` | Chọn KA + số câu (mặc định 20) |
   | Quick quiz | `{mode:"quick", total}` | 15 câu · ~15 phút |
   | Ôn câu sai | `{mode:"review", total}` | Hiện `reviewPoolSize` câu đang chờ ôn |
   - Thẻ "Ôn câu sai" **disabled** khi `reviewPoolSize === 0`, kèm giải thích tại sao

4. **Flashcard** — một dòng mỗi bộ thẻ từ `decks`
   - `techniques` (50) · `tasks` (30) · `glossary` (206)
   - Hiện `due` đến hạn / `total`, badge số khi `due > 0`
   - **Bộ thẻ thuộc framework, không thuộc chứng chỉ.** CBAP và CCBA thấy chung
     3 bộ BABOK; ECBA thấy 0 vì thi trên framework khác

5. **Lịch sử** — bảng, mới nhất trước, tối đa 15 dòng
   - Cột: chế độ · số câu · điểm · % · Đạt/Chưa đạt · thời gian làm · link "Xem lại"

---

## 2. Màn làm bài

**Mục đích:** mô phỏng phòng thi. Không có gì gây phân tâm.

**Nguồn dữ liệu:** `GET /api/sessions/:id` → `TakingView`
**Ghi:** `PATCH /api/sessions/:id/answers` với `{questionId, selectedOptionId?, flagged?, timeSpentSec?}`

> **Ràng buộc quan trọng cho người code:** payload màn này **không chứa** `isCorrect`,
> `rationale`, `explanation`. Đây là chủ đích, và có test tự động canh. Đừng gọi
> endpoint result để "tiện" lấy thêm dữ liệu.

### Bố cục — 3 vùng

**Thanh trên (dính, cao ~56px)**
- Trái: "Câu 12 / 120"
- Giữa: **đồng hồ đếm ngược** — chỉ hiện khi `session.timeLimitSec !== null`
  - Tính từ `startedAt + timeLimitSec` so với đồng hồ máy khách
  - Bình thường trung tính → **còn 15 phút**: đổi màu cảnh báo → **còn 5 phút**: nhấn mạnh hơn
  - Hết giờ: tự động nộp bài
- Phải: nút "Nộp bài" (có hộp thoại xác nhận, nêu rõ số câu chưa trả lời)

**Thân (cột giữa, rộng tối đa ~760px)**
- Nếu `caseStudy !== null`: khối case study đặt trên đầu, nền khác, có thể thu gọn.
  Nhiều câu dùng chung một case → **giữ mở khi chuyển giữa các câu cùng case**
- Đề bài (`stem`) — cỡ chữ thân bài, không in đậm cả khối
- 4 đáp án — nút chọn cả dòng (click đâu cũng được), nhãn A/B/C/D. Trạng thái: chưa chọn / đang chọn / hover
- Dưới cùng: nút "Đánh dấu để xem lại" (toggle `flagged`)

**Bảng câu hỏi (cột phải, ~200px — thu vào drawer khi hẹp)**
- Lưới ô vuông, một ô mỗi câu, số bên trong
- 4 trạng thái ô: chưa trả lời · đã trả lời · đã đánh dấu · đang xem
- Click để nhảy tới câu
- Dưới lưới: bộ đếm "Đã trả lời 84 · Đánh dấu 7 · Chưa làm 29"

**Điều hướng:** nút Trước/Sau, phím tắt `←` `→`, phím `1-4` chọn đáp án, `F` đánh dấu.

### Chế độ luyện tập (`mode !== "mock"`)
Khác biệt duy nhất: sau khi chọn đáp án, hiện ngay đúng/sai + rationale của đáp án đã chọn.
> **Lưu ý kỹ thuật:** dữ liệu này chỉ có sau khi nộp. Cách làm: session luyện tập nộp
> ngay khi trả lời hết, hoặc bổ sung endpoint riêng cho chế độ luyện tập. **Cần chốt
> trước khi code frontend** — hiện backend chưa hỗ trợ hiện đáp án giữa chừng.

---

## 3. Màn kết quả

**Nguồn dữ liệu:** `GET /api/sessions/:id/result` → `ResultView`

### Thành phần

1. **Khối điểm**
   - Số lớn: `score.correct`/`score.total` và `score.percent`%
   - Huy hiệu Đạt/Chưa đạt theo `score.passed` (ngưỡng 70%)
   - Phụ: bỏ trống `score.unanswered` câu · thời gian làm bài
   - Nếu là mock: so sánh với ngưỡng và với lần thi trước

2. **Bảng phân tích theo KA** — cùng dạng thanh ngang với Dashboard
   - Mỗi KA: `byKa[ka].correct`/`total` và `percent`, có vạch 70%
   - Mỗi dòng có nút "Luyện KA này" → tạo session `{mode:"ka", ka}`

3. **Bộ lọc danh sách câu:** Tất cả · Chỉ câu sai (mặc định) · Chỉ câu đánh dấu · Chỉ câu bỏ trống

4. **Danh sách câu** — mỗi câu là một khối (xem mục 4)

5. Nút cuối trang: "Ôn lại các câu vừa sai" → `{mode:"review"}`

---

## 4. Khối xem lại một câu

Dùng chung ở màn kết quả và thư viện câu hỏi. Đây là **màn quan trọng nhất để học** —
đầu tư thiết kế nhiều nhất ở đây.

```
┌─────────────────────────────────────────────────────────┐
│ Câu 12 · RADD · SAI       [BABOK v3 7.1] [🔖] [Ghi chú] │
├─────────────────────────────────────────────────────────┤
│ ▸ Case study: Northbank lending origination  (thu gọn)  │
├─────────────────────────────────────────────────────────┤
│ <stem — nguyên văn tiếng Anh>                            │
├─────────────────────────────────────────────────────────┤
│ ✓ A. <text>                              ← ĐÁP ÁN ĐÚNG   │
│      <rationale — vì sao đúng>                           │
│                                                          │
│ ✗ B. <text>                               ← BẠN CHỌN     │
│      <rationale — vì sao sai>                            │
│                                                          │
│   C. <text>                                              │
│      <rationale — vì sao sai>                            │
│                                                          │
│   D. <text>                                              │
│      <rationale — vì sao sai>                            │
├─────────────────────────────────────────────────────────┤
│ Giải thích: <explanation>                                │
├─────────────────────────────────────────────────────────┤
│ Ghi chú của bạn: [textarea, tự lưu khi blur]             │
└─────────────────────────────────────────────────────────┘
```

**Quy tắc trình bày:**
- **Rationale của cả 4 đáp án luôn hiện**, không giấu sau nút "xem thêm". Đây là lý do
  chính người dùng vào màn này — CBAP luôn có 2 đáp án "gần đúng", và việc đọc vì sao
  đáp án gần đúng lại sai chính là chỗ học được nhiều nhất
- Đáp án đúng: viền/nền xanh nhạt. Đáp án đã chọn mà sai: viền/nền đỏ nhạt. Hai cái
  còn lại: trung tính. **Không dùng riêng màu để phân biệt** — luôn kèm icon ✓/✗ và
  nhãn chữ, để người mù màu vẫn đọc được
- Chip nguồn hiện `certification.framework.name` + `sourceRef`, tooltip là `sourceTask`.
  Với framework chưa có registry tham chiếu (ECBA), chip vẫn hiện nhưng không click được

**Tương tác:**
- `POST /api/questions/:id/bookmark` → trả `{bookmarked}`, cập nhật icon ngay
- `POST /api/questions/:id/note` với `{body}` → tự lưu khi blur; body rỗng = xoá ghi chú

---

## 5. Flashcard

**Nguồn dữ liệu:** `GET /api/flashcards/due?deck=&limit=`
**Ghi:** `POST /api/flashcards/:id/review` với `{button: "forgot"|"hard"|"good"|"easy"}`
→ trả về `CardState` mới (`intervalDays`, `repetitions`, `lapses`, `dueAt`)

### Bố cục

**Màn chọn bộ thẻ**
- 3 thẻ: `techniques` (50) · `tasks` (30) · `glossary` (206)
- Mỗi thẻ: `due` đến hạn · `new` chưa học · `learning` đang học · `total`
- Nút "Ôn tất cả" gộp cả 3 bộ

**Màn ôn thẻ** — một thẻ chiếm gần hết màn hình
1. *Mặt trước:* nội dung `front` căn giữa, cỡ chữ lớn. Một nút duy nhất: **"Lật thẻ"** (hoặc `Space`)
2. *Mặt sau:* `back` hiện ra dưới `front` (front vẫn ở nguyên chỗ, không nhảy layout).
   Thẻ deck `tasks` có `back` nhiều dòng — Purpose / Inputs / Elements / Outputs — **trình bày thành 4 mục có nhãn, không đổ thành một đoạn**
3. Bốn nút chấm điểm, luôn cùng thứ tự:

   | Nút | Phím | Ý nghĩa | Hiện dưới nút |
   |---|---|---|---|
   | Quên | 1 | không nhớ gì | "hôm nay" |
   | Khó | 2 | nhớ chật vật | khoảng cách mới |
   | Tốt | 3 | nhớ được | khoảng cách mới |
   | Dễ | 4 | nhớ ngay | khoảng cách mới |

   Hiện trước khoảng cách sẽ nhận được giúp người học chấm trung thực hơn.
4. Thanh tiến độ: "còn 23 thẻ đến hạn"
5. **Rỗng:** hết thẻ đến hạn → hiện ngày có thẻ tiếp theo, không phải màn trắng

**Ghi chú về SM-2:** chấm "Quên" đặt thẻ đến hạn **ngay lập tức** (interval 0) để học lại
trong cùng phiên. Ba nút còn lại đẩy thẻ ra 1 → 6 → interval × ease.

---

## 7. Chứng chỉ chưa có dữ liệu

**Khi nào:** `certification.availableQuestions === 0` (hoặc `ready === false`).

**Không** ẩn chứng chỉ và **không** khoá tab. Thay vào đó hiện:

1. Dải context bình thường, đầy đủ thông tin đề thi thật
2. Khối giải thích **lý do cụ thể**, không phải "chưa có dữ liệu" chung chung:
   - Khác framework (ECBA): "ECBA thi trên The Business Analysis Standard với 9
     performance domain, không phải 6 Knowledge Area của BABOK. Kho câu hỏi BABOK
     hiện có không dùng lại được cho ECBA."
   - Cùng framework nhưng lọc hết (trường hợp CCBA nếu bank chỉ có câu Level 3):
     nêu rõ số câu bị loại và vì sao (cấp độ, hoặc case-study)
3. **Blueprint đầy đủ vẫn hiện**, mỗi domain kèm "0 câu" — cho thấy hệ thống đã sẵn sàng
4. Bốn thẻ chế độ thi ở trạng thái disabled

## 6. Thư viện câu hỏi

**Mục đích:** duyệt lại kho câu đã gặp ngoài ngữ cảnh một bài thi.

Bộ lọc: theo KA · theo BABOK task · chỉ bookmark · chỉ câu đang sai · chỉ câu có ghi chú.
Mỗi kết quả hiển thị bằng **khối xem lại ở mục 4**.

> **Chưa có endpoint.** Cần bổ sung `GET /api/questions` có filter trước khi code màn này.
> Không chặn các màn khác.

---

## Tổng kết những gì cần chốt trước khi code frontend

1. **Chế độ luyện tập hiện đáp án ngay** — backend hiện chỉ trả đáp án sau khi nộp.
   Cần chọn: (a) tự nộp khi trả lời hết, hay (b) thêm endpoint riêng cho practice mode.
2. **Thư viện câu hỏi** cần `GET /api/questions` có filter.
3. **Đồng hồ đếm ngược** hiện tính ở client. Nếu muốn chống gian lận thời gian thì cần
   server tính — với app cá nhân thì không cần.
