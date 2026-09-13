# Ứng dụng web chấm điểm bài thi trắc nghiệm

Ứng dụng web Next.js tự động chấm điểm bài thi trắc nghiệm theo định dạng THPT Việt Nam, sử dụng OpenCV.js để nhận dạng ảnh.

## Tính năng

- **Cấu hình đề thi**: Thiết lập đáp án cho ba dạng câu hỏi:
  - Phần I: Trắc nghiệm nhiều phương án lựa chọn (A, B, C, D)
  - Phần II: Trắc nghiệm đúng/sai, có các ý nhỏ
  - Phần III: Trắc nghiệm trả lời ngắn (dạng số)

- **Xử lý ảnh**:
  - Tải ảnh lên bằng cách kéo và thả
  - Tự động giảm kích thước với ảnh lớn (ảnh từ điện thoại 12MP trở lên)
  - Ngưỡng tô thích ứng (lấy mốc từ các ô trống của chính ảnh đó)
  - Kiểm tra chất lượng ảnh trước khi xử lý (phát hiện ảnh mờ, độ phân giải, dấu định vị góc)
  - Nhận dạng ô tô bằng OpenCV.js
  - Nhận dạng số báo danh và mã đề
  - Nhận dạng đáp án cho cả ba dạng câu hỏi

- **Sửa đáp án thủ công**:
  - Nhấp để đổi đáp án ngay trên bảng có thể chỉnh sửa
  - Làm nổi bật những đáp án có độ tin cậy thấp để rà soát
  - Xem trước điểm ngay trong lúc sửa

- **Quản lý phiên**:
  - Tạo, xem danh sách, xóa phiên chấm thi
  - Dữ liệu tách biệt theo từng phiên (cấu hình và kết quả riêng cho mỗi phiên)
  - Xuất/nhập phiên (tệp `.chambai.json`)
  - Tự động chuyển dữ liệu từ localStorage sang IndexedDB

- **Kết quả và phân tích**:
  - Tự động tính điểm
  - Phân tích từng câu hỏi (tỷ lệ đúng, tỷ lệ sai, tỷ lệ bỏ trống, độ khó)
  - Biểu đồ phân phối điểm với số khoảng điểm tùy chỉnh
  - Thống kê toàn lớp (trung bình, trung vị, thấp nhất, cao nhất)
  - Xem chi tiết kết quả của từng học sinh
  - Xuất kết quả ra tệp CSV
  - Bố cục tối ưu cho việc in
  - Lưu dữ liệu bằng IndexedDB

## Công nghệ sử dụng

- **Giao diện**: Next.js 16 (App Router), React 19
- **Kiểu dáng**: Tailwind CSS
- **Xử lý ảnh**: OpenCV.js 4.10 (tải từ CDN jsDelivr, có kiểm tra toàn vẹn SRI)
- **Xuất dữ liệu**: Tạo tệp CSV, xuất phiên dạng JSON
- **Lưu trữ**: IndexedDB (phiên, kết quả, ảnh gỡ lỗi)

## Bắt đầu

1. **Cài đặt các gói phụ thuộc**:
   ```bash
   npm install
   ```

2. **Chạy máy chủ phát triển**:
   ```bash
   npm run dev
   ```

3. **Mở trình duyệt** và truy cập `http://localhost:3000`

## Hướng dẫn sử dụng

### 1. Tạo phiên
- Nhấn "Tạo phiên mới" ở trang chủ
- Đặt tên cho phiên chấm thi

### 2. Cấu hình đề thi
- Nhập số câu hỏi cho từng phần
- Nhập đáp án đúng (nhập tay, dán từ Excel, hoặc nhập từ tệp CSV)
- Lưu cấu hình

### 3. Tải và xử lý ảnh
- Kéo và thả hoặc chọn tệp ảnh (JPG, PNG)
- Nhấn "Xử lý ảnh" để bắt đầu xử lý
- Xem các cảnh báo chất lượng với ảnh bị mờ hoặc có độ phân giải thấp
- Chờ quá trình nhận dạng tự động hoàn tất

### 4. Rà soát và sửa đáp án
- Nhấn "Xem" ở kết quả của học sinh cần kiểm tra
- Nhấn "Sửa đáp án" để sửa thủ công các đáp án đã nhận dạng
- Những đáp án có độ tin cậy thấp được làm nổi bật bằng màu vàng

### 5. Xem kết quả
- Xem điểm trong bảng kết quả
- Chuyển sang "Phân tích câu hỏi" để xem phân tích từng câu
- Chuyển sang "Phân phối điểm" để xem phân phối điểm
- Xuất kết quả ra tệp CSV hoặc in

## Cấu trúc dự án

```
src/
├── app/
│   ├── layout.jsx              # Layout gốc, tích hợp OpenCV.js
│   ├── page.jsx                # Ứng dụng chính: quản lý phiên + điều hướng trang
│   └── globals.css             # Kiểu dáng toàn cục + CSS cho bản in
├── components/
│   ├── Navigation.jsx          # Điều hướng giữa các trang
│   ├── ConfigurationPage.jsx   # Cấu hình đề thi + cách tính điểm + nhập từ CSV
│   ├── UploadPage.jsx          # Tải ảnh lên, kèm tiến trình + cảnh báo chất lượng
│   ├── ResultsPage.jsx         # Bảng kết quả + các tab (phân tích, phân phối)
│   ├── ImageProcessor.jsx      # Lớp bọc mỏng, gọi vào luồng nhận dạng
│   ├── session-list.jsx        # Danh sách phiên, kèm tạo/xóa/xuất/nhập
│   ├── session-header.jsx      # Thanh tiêu đề của phiên đang mở
│   ├── student-detail-modal.jsx # Chi tiết từng học sinh + nút sửa đáp án
│   ├── manual-correction-modal.jsx # Bảng đáp án chỉnh sửa được, tính điểm trực tiếp
│   ├── item-analysis-view.jsx  # Bảng phân tích từng câu hỏi
│   ├── score-distribution-chart.jsx # Biểu đồ phân phối kèm trung bình/trung vị
│   ├── phan-i-answer-grid.jsx  # Bảng nhập đáp án, điều hướng được bằng bàn phím
│   └── image-processor-error-boundary.jsx # Ranh giới lỗi cho luồng nhận dạng
└── lib/
    ├── detection-pipeline.js   # Toàn bộ luồng OMR (đã tách riêng, hàm thuần)
    ├── image-preprocessing.js  # Ảnh xám, phân ngưỡng, đổi kích thước, ngưỡng thích ứng
    ├── image-quality-check.js  # Kiểm tra độ mờ/độ phân giải/biên phiếu
    ├── marker-detection.js     # Phát hiện phiếu theo đường biên + hiệu chỉnh phối cảnh
    ├── corner-marker-fallback.js # Phương án dự phòng: phát hiện dấu định vị góc (cũ)
    ├── bubble-grid-generator.js # Bố cục phiếu trả lời THPT Việt Nam
    ├── answer-detection.js     # Nhận dạng số báo danh, mã đề, đáp án
    ├── debug-visualization.js  # Vẽ lớp phủ gỡ lỗi
    ├── scoring.js              # Tính điểm có trọng số (Phần I/II/III)
    ├── statistics.js           # Thống kê ở mức toàn lớp
    ├── item-analysis.js        # Phân tích từng câu hỏi
    ├── indexed-db-store.js     # IndexedDB lõi (openDB, ảnh gỡ lỗi)
    ├── indexed-db-sessions.js  # Thao tác CRUD với phiên
    ├── indexed-db-results.js   # Thao tác CRUD với kết quả (theo từng phiên)
    ├── local-storage-migration.js # Chuyển dữ liệu từ localStorage, chạy một lần
    ├── session-export-import.js # Xuất/nhập phiên dưới dạng JSON
    └── types.js                # Định nghĩa kiểu bằng JSDoc
```

## Xử lý ảnh

Ứng dụng dùng OpenCV.js để:
- Chuyển ảnh sang ảnh xám và phân ngưỡng thích ứng
- Tự động giảm kích thước ảnh lớn (rộng hơn 2000px) để xử lý ổn định hơn
- Tính ngưỡng tô thích ứng dựa trên mốc từ các ô trống
- Kiểm tra chất lượng ảnh (độ mờ, độ phân giải, biên phiếu)
- Phát hiện biên phiếu theo đường biên (hình chữ nhật lớn nhất), dự phòng bằng dấu định vị góc
- Luôn hiệu chỉnh phối cảnh khi đã phát hiện được biên phiếu
- Phân ngưỡng nhị phân + đếm điểm ảnh để đo mức độ tô của ô một cách đáng tin cậy
- Trích xuất vùng quan tâm (ROI) kèm phân ngưỡng Otsu
- Trực quan hóa gỡ lỗi bằng lớp phủ có mã màu

Luồng nhận dạng tuân theo bố cục phiếu trả lời THPT Việt Nam (Công văn 1239/BGDĐT 2025):
1. Giảm kích thước ảnh về tối đa 2000px chiều rộng
2. Tiền xử lý (ảnh xám + làm mờ Gauss + phân ngưỡng thích ứng)
3. Phát hiện biên phiếu bằng cách tìm đường biên (dự phòng: dấu định vị góc)
4. Kiểm tra chất lượng ảnh (độ mờ, độ phân giải, khả năng phát hiện biên)
5. Hiệu chỉnh phối cảnh (luôn thực hiện khi phát hiện đủ 4 góc)
6. Sinh lưới ô tô theo tỷ lệ bố cục tương ứng
7. Tính ngưỡng tô thích ứng từ các vùng ô còn trống
8. Đo mức độ tô của ô bằng phân ngưỡng nhị phân + đếm điểm ảnh tối
9. Trả về kết quả kèm bản đồ độ tin cậy để rà soát thủ công

## Giấy phép

Giấy phép MIT
